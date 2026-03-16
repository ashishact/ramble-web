/**
 * ExtractionEngine — SYS-II Knowledge Synthesis
 *
 * For each 6-hour period, synthesizes all user conversations into graph
 * nodes and edges. Nodes are written to a draft branch
 * (extraction/YYYY-MM-DD-p{n}) with low confidence and period tag.
 * They stay in draft until manually committed.
 *
 * Flow per period:
 *   1. Load conversations for the period from DuckDB
 *   2. Prepend previous period's compaction as context
 *   3. Send to ChatGPT (new session per run) with SYS-II prompt
 *   4. Handle search round-trips (up to MAX_SEARCH_ROUNDS)
 *   5. Write extracted nodes + edges to the draft branch
 *   6. Save compaction to profileStorage for next period
 *   7. Emit progress + completion events
 *
 * The engine is stateless between runs. PeriodScheduler drives it.
 */

import { profileStorage } from '../../lib/profileStorage'
import { createLogger } from '../../program/utils/logger'
import { callLLM } from '../../program/llmClient'
import { rambleExt } from '../chrome-extension'
import { buildSys2Prompt } from './prompt'
import { periodMs, periodKey, dateStr } from './periodUtils'
import type {
  PeriodSlot,
  PeriodExtractionState,
  ExtractionLLMResponse,
  ExtractionSearchRequest,
  ExtractionSummary,
  ExtractionStatus,
} from './types'

const log = createLogger('ExtractionEngine')

const MAX_SEARCH_ROUNDS = 5

// ── DuckDB helpers ──────────────────────────────────────────────────

async function getGraph() {
  const { getGraphService } = await import('../../graph')
  return getGraphService()
}

/** Row shape returned by SELECT * FROM extraction_runs */
interface ExtRunRow {
  period_key: string
  date: string
  slot: string
  status: string
  branch_id: string | null
  conversation_count: number
  extracted_at: number | null
  compaction: string | null
  chat_session_id: string | null
  chat_url: string | null
  error: string | null
  entity_count: number
  memory_count: number
  goal_count: number
  topic_count: number
  relationship_count: number
}

function rowToState(row: ExtRunRow): PeriodExtractionState {
  return {
    periodKey: row.period_key,
    date: row.date,
    slot: row.slot as PeriodSlot,
    status: row.status as ExtractionStatus,
    branchId: row.branch_id,
    conversationCount: row.conversation_count,
    extractedAt: row.extracted_at,
    compaction: row.compaction,
    chatSessionId: row.chat_session_id,
    chatUrl: row.chat_url,
    error: row.error,
    counts: {
      entities: row.entity_count,
      memories: row.memory_count,
      goals: row.goal_count,
      topics: row.topic_count,
      relationships: row.relationship_count ?? 0,
    },
  }
}

const UPSERT_SQL = `INSERT INTO extraction_runs
  (period_key, date, slot, status, branch_id, conversation_count,
   extracted_at, compaction, chat_session_id, chat_url, error,
   entity_count, memory_count, goal_count, topic_count, relationship_count,
   created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17)
  ON CONFLICT (period_key) DO UPDATE SET
    status=excluded.status, branch_id=excluded.branch_id,
    conversation_count=excluded.conversation_count, extracted_at=excluded.extracted_at,
    compaction=excluded.compaction, chat_session_id=excluded.chat_session_id,
    chat_url=excluded.chat_url, error=excluded.error,
    entity_count=excluded.entity_count, memory_count=excluded.memory_count,
    goal_count=excluded.goal_count, topic_count=excluded.topic_count,
    relationship_count=excluded.relationship_count,
    updated_at=excluded.updated_at`

// ── One-time migration from localStorage → DuckDB ───────────────────
// TODO(remove): Delete this block after confirming migration succeeded.
const LEGACY_KEY = 'synthesis-periods'
let migrationDone = false

async function migrateIfNeeded(): Promise<void> {
  if (migrationDone) return
  migrationDone = true

  const data = profileStorage.getJSON<Record<string, PeriodExtractionState>>(LEGACY_KEY)
  if (!data || Object.keys(data).length === 0) return

  const graph = await getGraph()
  const now = Date.now()

  for (const s of Object.values(data)) {
    await graph.exec(UPSERT_SQL, [
      s.periodKey, s.date, s.slot, s.status, s.branchId ?? null,
      s.conversationCount, s.extractedAt ?? null, s.compaction ?? null,
      s.chatSessionId ?? null, s.chatUrl ?? null, s.error ?? null,
      s.counts?.entities ?? 0, s.counts?.memories ?? 0,
      s.counts?.goals ?? 0, s.counts?.topics ?? 0,
      s.counts?.relationships ?? 0, now,
    ])
  }

  profileStorage.removeItem(LEGACY_KEY)
  log.info(`Migrated ${Object.keys(data).length} extraction states from localStorage → DuckDB`)
}
// ── End migration block ─────────────────────────────────────────────

// ── Storage helpers (DuckDB-backed) ─────────────────────────────────

export async function loadAllPeriodStates(): Promise<Record<string, PeriodExtractionState>> {
  await migrateIfNeeded()
  const graph = await getGraph()
  const rows = await graph.query<ExtRunRow>('SELECT * FROM extraction_runs ORDER BY date DESC, slot DESC')
  const map: Record<string, PeriodExtractionState> = {}
  for (const row of rows) map[row.period_key] = rowToState(row)
  return map
}

export async function loadPeriodState(pKey: string): Promise<PeriodExtractionState | null> {
  await migrateIfNeeded()
  const graph = await getGraph()
  const rows = await graph.query<ExtRunRow>(
    'SELECT * FROM extraction_runs WHERE period_key = $1', [pKey],
  )
  return rows.length > 0 ? rowToState(rows[0]) : null
}

async function savePeriodState(state: PeriodExtractionState): Promise<void> {
  const graph = await getGraph()
  await graph.exec(UPSERT_SQL, [
    state.periodKey, state.date, state.slot, state.status, state.branchId,
    state.conversationCount, state.extractedAt, state.compaction,
    state.chatSessionId, state.chatUrl, state.error,
    state.counts.entities, state.counts.memories, state.counts.goals, state.counts.topics,
    state.counts.relationships,
    Date.now(),
  ])
}

// ── JSON Parsing Helper ──────────────────────────────────────────────

function parseExtractionResponse(raw: string): ExtractionLLMResponse {
  const empty: ExtractionLLMResponse = {
    entities: [], memories: [], goals: [], topics: [], relationships: [],
    compaction: '', search: null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildResult = (parsed: any): ExtractionLLMResponse => ({
    entities:      Array.isArray(parsed.entities)       ? parsed.entities       : [],
    memories:      Array.isArray(parsed.memories)       ? parsed.memories       : [],
    goals:         Array.isArray(parsed.goals)          ? parsed.goals          : [],
    topics:        Array.isArray(parsed.topics)         ? parsed.topics         : [],
    relationships: Array.isArray(parsed.relationships)  ? parsed.relationships  : [],
    compaction:    typeof parsed.compaction === 'string' ? parsed.compaction     : '',
    search:        (parsed.search as ExtractionLLMResponse['search']) ?? null,
  })

  // Strategy 1 — parse the entire trimmed response as-is (plain JSON)
  try { return buildResult(JSON.parse(raw.trim())) } catch {}

  // Strategy 2 — extract content from a ```json ... ``` or ``` ... ``` block
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (codeBlock) {
    try { return buildResult(JSON.parse(codeBlock[1].trim())) } catch {}
  }

  // Strategy 3 — extract first { ... last } (handles prose before/after JSON)
  const firstBrace = raw.indexOf('{')
  const lastBrace  = raw.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try { return buildResult(JSON.parse(raw.slice(firstBrace, lastBrace + 1))) } catch {}
  }

  log.warn('Failed to parse SYS-II JSON response, preview:', raw.slice(0, 200))
  return empty
}

// ── Graph Search (same as SYS-I) ─────────────────────────────────────

async function runGraphSearch(req: ExtractionSearchRequest): Promise<string> {
  try {
    const [{ getGraphService }, { EmbeddingService }, { VectorSearch }] = await Promise.all([
      import('../../graph'),
      import('../../graph/embeddings/EmbeddingService'),
      import('../../graph/embeddings/VectorSearch'),
    ])

    const graph = await getGraphService()
    const embeddings = new EmbeddingService(graph)
    const vs = new VectorSearch(graph, embeddings)

    const labelFilter = req.type === 'entity' ? 'entity'
      : req.type === 'goal' ? 'goal'
      : 'memory'

    const results = await vs.searchByText(req.query, 8, labelFilter)

    if (results.length === 0) return `No ${req.type} results found for: "${req.query}"`

    return results.map(r => {
      const props = r.node.properties as Record<string, unknown>
      const content = props.content ?? props.name ?? props.title ?? r.node.id
      return `[${req.type}] ${String(content)} (relevance: ${r.similarity.toFixed(2)})`
    }).join('\n')
  } catch (err) {
    log.warn('Graph search failed:', err)
    return 'Search unavailable.'
  }
}

// ── Graph Write Helpers ──────────────────────────────────────────────

async function writeNodesToGraph(
  result: ExtractionLLMResponse,
  branchId: string,
  pKey: string,
  slot: PeriodSlot,
  conversationIds: string[],
): Promise<{ entities: number; memories: number; goals: number; topics: number; relationships: number }> {
  const { getGraphService } = await import('../../graph')
  const graph = await getGraphService()

  const now = Date.now()
  let entityCount = 0
  let memoryCount = 0
  let goalCount = 0
  let topicCount = 0
  let relationshipCount = 0

  // Case-insensitive entity name → node ID map (for resolving relationship edges)
  const entityNameToId = new Map<string, string>()

  // Write entities
  for (const e of result.entities) {
    const id = `ent_${now}_${++entityCount}_${Math.random().toString(36).slice(2, 5)}`
    const sourceCids = (e.sourceIndices ?? [])
      .map(i => conversationIds[i])
      .filter(Boolean)

    const props: Record<string, unknown> = {
      name: e.name,
      type: e.type,
      description: e.description ?? null,
      aliases: e.aliases ?? [],
      mentionCount: 1,
      firstMentioned: now,
      lastMentioned: now,
      confidence: e.confidence,
      sourceConversationIds: sourceCids,
      period: slot,
      extractionPeriodKey: pKey,
      state: 'draft',
    }
    if (e.qualifiers && Object.keys(e.qualifiers).length > 0) {
      props.qualifiers = e.qualifiers
    }
    await graph.createNode({
      id,
      branchId,
      labels: ['entity', e.type],
      properties: props,
    })

    // Register in name→id map (case-insensitive, first wins)
    const nameKey = e.name.toLowerCase()
    if (!entityNameToId.has(nameKey)) entityNameToId.set(nameKey, id)
    // Also register aliases
    for (const alias of e.aliases ?? []) {
      const aliasKey = alias.toLowerCase()
      if (!entityNameToId.has(aliasKey)) entityNameToId.set(aliasKey, id)
    }
  }

  // Write memories
  const memoryIds: Array<{ id: string; relatedEntityNames: string[] }> = []
  for (const m of result.memories) {
    const id = `mem_${now}_${++memoryCount}_${Math.random().toString(36).slice(2, 5)}`
    const sourceCids = (m.sourceIndices ?? [])
      .map(i => conversationIds[i])
      .filter(Boolean)

    const props = {
      content: m.content,
      type: m.type,
      importance: m.importance,
      confidence: m.confidence,
      activityScore: 1.0,
      ownership: 0.8,
      state: 'draft',
      origin: 'speech',
      extractionVersion: 'sys2-v1',
      sourceConversationIds: sourceCids,
      reinforceCount: 0,
      lastReinforced: now,
      period: slot,
      extractionPeriodKey: pKey,
      slots: m.slots,
      relatedEntityNames: m.relatedEntityNames,
    }
    await graph.createNode({
      id,
      branchId,
      labels: ['memory', m.type.toLowerCase()],
      properties: props,
    })

    if (m.relatedEntityNames?.length > 0) {
      memoryIds.push({ id, relatedEntityNames: m.relatedEntityNames })
    }
  }

  // Write goals
  for (const g of result.goals) {
    const id = `goal_${now}_${++goalCount}_${Math.random().toString(36).slice(2, 5)}`
    const sourceCids = (g.sourceIndices ?? [])
      .map(i => conversationIds[i])
      .filter(Boolean)

    const props = {
      statement: g.statement,
      type: g.type,
      motivation: g.motivation ?? null,
      deadline: g.deadline ?? null,
      status: 'active',
      progress: 0,
      confidence: g.confidence,
      firstExpressed: now,
      lastReferenced: now,
      sourceConversationIds: sourceCids,
      period: slot,
      extractionPeriodKey: pKey,
      state: 'draft',
      entityIds: [],
      topicIds: [],
    }
    await graph.createNode({
      id,
      branchId,
      labels: ['goal'],
      properties: props,
    })
  }

  // Write topics
  for (const t of result.topics) {
    const id = `topic_${now}_${++topicCount}_${Math.random().toString(36).slice(2, 5)}`
    const sourceCids = (t.sourceIndices ?? [])
      .map(i => conversationIds[i])
      .filter(Boolean)

    const props = {
      name: t.name,
      mentionCount: 1,
      firstMentioned: now,
      lastMentioned: now,
      confidence: t.confidence,
      sourceConversationIds: sourceCids,
      period: slot,
      extractionPeriodKey: pKey,
      state: 'draft',
    }
    await graph.createNode({
      id,
      branchId,
      labels: ['topic'],
      properties: props,
    })
  }

  // ── Write relationship edges ────────────────────────────────────────
  // Resolve entity names → node IDs and create edges

  for (const rel of result.relationships) {
    const startId = entityNameToId.get(rel.source.toLowerCase())
    const endId = entityNameToId.get(rel.target.toLowerCase())

    if (!startId || !endId) {
      log.warn(`Skipping relationship ${rel.source} → ${rel.target}: unresolved entity name`)
      continue
    }

    const edgeId = `edge_${now}_${++relationshipCount}_${Math.random().toString(36).slice(2, 5)}`
    await graph.createEdge({
      id: edgeId,
      branchId,
      startId,
      endId,
      type: rel.type,
      properties: {
        description: rel.description ?? null,
        confidence: rel.confidence,
        extractionPeriodKey: pKey,
      },
    })
  }

  // ── Write ABOUT edges from memory → related entities ───────────────
  for (const { id: memId, relatedEntityNames } of memoryIds) {
    for (const entityName of relatedEntityNames) {
      const entityId = entityNameToId.get(entityName.toLowerCase())
      if (!entityId) continue

      const edgeId = `edge_${now}_${++relationshipCount}_${Math.random().toString(36).slice(2, 5)}`
      await graph.createEdge({
        id: edgeId,
        branchId,
        startId: memId,
        endId: entityId,
        type: 'ABOUT',
        properties: {
          extractionPeriodKey: pKey,
        },
      })
    }
  }

  return {
    entities: entityCount,
    memories: memoryCount,
    goals: goalCount,
    topics: topicCount,
    relationships: relationshipCount,
  }
}

// ── Main Engine ──────────────────────────────────────────────────────

export class ExtractionEngine {

  /**
   * Run SYS-II extraction for a single period.
   * If a draft branch already exists for this period, it is deleted first
   * (re-run behaviour).
   *
   * @param date  "YYYY-MM-DD"
   * @param slot  "p1" | "p2" | "p3" | "p4"
   * @param onProgress  optional callback for live progress messages
   */
  async run(
    date: string,
    slot: PeriodSlot,
    onProgress?: (msg: string) => void,
  ): Promise<ExtractionSummary> {
    const pKey = periodKey(date, slot)
    const progress = (msg: string) => {
      log.info(msg)
      onProgress?.(msg)
    }

    // ── Singleton guard + resume detection ────────────────────────────
    const existingState = await loadPeriodState(pKey)

    if (existingState?.status === 'running') {
      progress(`Period ${pKey} is already running — aborting to prevent duplicate`)
      throw new Error(`Period ${pKey} is already running`)
    }

    // Preserve chatUrl/chatSessionId from a previous run so we can resume
    // instead of opening a new ChatGPT tab
    const resumeChatUrl = existingState?.chatUrl ?? null
    const resumeSessionId = existingState?.chatSessionId ?? null

    progress(`Starting extraction for ${pKey}${resumeChatUrl ? ' (will resume from previous ChatGPT session)' : ''}`)

    // ── Mark as running (preserve chatUrl for resume) ────────────────
    const state: PeriodExtractionState = {
      periodKey: pKey,
      date,
      slot,
      status: 'running',
      branchId: null,
      conversationCount: 0,
      extractedAt: null,
      compaction: null,
      chatSessionId: resumeSessionId,
      chatUrl: resumeChatUrl,
      error: null,
      counts: { entities: 0, memories: 0, goals: 0, topics: 0, relationships: 0 },
    }
    await savePeriodState(state)

    // Declared before try so both the happy path and catch can call it
    let unsubUrl: (() => void) = () => {}

    try {
      // ── Load conversations for this period ───────────────────────
      const { startMs, endMs } = periodMs(date, slot)
      const { getGraphService } = await import('../../graph')
      const graph = await getGraphService()

      const convRows = await graph.query<{
        id: string; raw_text: string; created_at: number; speaker: string
      }>(
        `SELECT id, raw_text, created_at, speaker FROM conversations
         WHERE created_at >= $1 AND created_at < $2
           AND speaker = 'user'
           AND length(trim(raw_text)) > 5
         ORDER BY created_at ASC`,
        [startMs, endMs]
      )

      if (convRows.length === 0) {
        progress('No conversations found for this period — skipping')
        state.status = 'done'
        state.conversationCount = 0
        state.extractedAt = Date.now()
        state.compaction = ''
        await savePeriodState(state)
        return { periodKey: pKey, branchId: '', entities: 0, memories: 0, goals: 0, topics: 0, relationships: 0, compaction: '' }
      }

      state.conversationCount = convRows.length
      progress(`Found ${convRows.length} conversations`)

      // ── Delete existing draft branch if re-running ───────────────
      const branchName = `extraction/${pKey}`
      const existingBranch = await graph.query<{ id: string }>(
        `SELECT id FROM branches WHERE name = $1 AND status = 'active'`,
        [branchName]
      )
      if (existingBranch.length > 0) {
        const oldBranchId = existingBranch[0].id
        await graph.exec(`DELETE FROM nodes WHERE branch_id = $1`, [oldBranchId])
        await graph.exec(`DELETE FROM edges WHERE branch_id = $1`, [oldBranchId])
        await graph.exec(`UPDATE branches SET status = 'archived' WHERE id = $1`, [oldBranchId])
        progress('Cleared previous draft branch')
      }

      // ── Create new draft branch ──────────────────────────────────
      const branchId = `branch_ext_${pKey}_${Date.now()}`
      await graph.exec(
        `INSERT INTO branches (id, name, parent_branch_id, created_at, status)
         VALUES ($1, $2, 'global', $3, 'active')`,
        [branchId, branchName, Date.now()]
      )
      state.branchId = branchId
      await savePeriodState(state)
      progress(`Created draft branch: ${branchName}`)

      // ── Build prompt ─────────────────────────────────────────────
      const currentDate = dateStr()
      const systemPrompt = buildSys2Prompt(currentDate)

      // Format conversations for the LLM
      const convLines = convRows.map((c, i) => {
        const t = new Date(c.created_at)
        const hhmm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
        return `[${i} · ${c.speaker} · ${hhmm}] ${c.raw_text}`
      }).join('\n\n')

      // Prepend previous period's compaction as context
      const previousCompaction = await findPreviousCompaction(date, slot)
      const prompt = previousCompaction
        ? `=== PREVIOUS PERIOD CONTEXT ===\n${previousCompaction}\n\n=== CONVERSATIONS ===\n\n${convLines}`
        : `=== CONVERSATIONS ===\n\n${convLines}`

      // ── Send to LLM (ChatGPT extension or direct API) ────────────
      const useChatGPT = rambleExt.isAvailable
      let extracted: ExtractionLLMResponse

      if (useChatGPT) {
        if (resumeChatUrl) {
          // ── Resume: read existing response from the ChatGPT DOM ──
          // The previous run already sent the full prompt and ChatGPT responded.
          // We just open the tab and scrape the last assistant message — zero LLM calls.
          progress(`Resuming from previous ChatGPT session: ${resumeChatUrl}`)

          const sessionId = resumeSessionId ?? `sys2-${pKey}-resume-${Date.now()}`
          state.chatSessionId = sessionId
          await savePeriodState(state)

          unsubUrl = rambleExt.onConversationUrl(sessionId, url => {
            if (url !== state.chatUrl) {
              state.chatUrl = url
              savePeriodState(state).catch(() => {})
              log.info(`[${pKey}] chatUrl updated via heartbeat:`, url)
            }
          })

          const response = await rambleExt.aiConversation({
            conversationId: sessionId,
            prompt: '',  // not used in readOnly mode
            chatUrl: resumeChatUrl,
            tabMode: 'reuse',
            readOnly: true,
          })

          if (response.chatUrl && response.chatUrl !== state.chatUrl) {
            state.chatUrl = response.chatUrl
            await savePeriodState(state)
          }

          extracted = parseExtractionResponse(response.answer)

        } else {
          // ── Normal: new ChatGPT session ──
          const sessionId = `sys2-${pKey}-${Date.now()}`
          state.chatSessionId = sessionId
          await savePeriodState(state)

          unsubUrl = rambleExt.onConversationUrl(sessionId, url => {
            if (url !== state.chatUrl) {
              state.chatUrl = url
              savePeriodState(state).catch(() => {})
              log.info(`[${pKey}] chatUrl updated via heartbeat:`, url)
            }
          })

          progress('Sending to ChatGPT...')
          let response = await rambleExt.aiConversation({
            conversationId: sessionId,
            prompt,
            systemPrompt,
            tabMode: 'new',
          })

          if (response.chatUrl) {
            state.chatUrl = response.chatUrl
            await savePeriodState(state)
          }

          extracted = parseExtractionResponse(response.answer)

          // Search round-trips
          let searchRounds = 0
          while (extracted.search && searchRounds < MAX_SEARCH_ROUNDS) {
            progress(`LLM requesting search: ${extracted.search.type} → "${extracted.search.query}"`)
            const searchText = await runGraphSearch(extracted.search)
            progress(`Search returned ${searchText.split('\n').length} results`)

            response = await rambleExt.aiConversation({
              conversationId: sessionId,
              prompt: `<search-res>\n${searchText}\n</search-res>`,
              chatUrl: state.chatUrl ?? undefined,
              tabMode: 'new',
            })

            if (response.chatUrl && response.chatUrl !== state.chatUrl) {
              state.chatUrl = response.chatUrl
              await savePeriodState(state)
            }

            extracted = parseExtractionResponse(response.answer)
            searchRounds++
          }
        }
      } else {
        // ── Direct LLM API (Cloudflare Gateway) ──
        progress('Sending to LLM API...')
        let llmResponse = await callLLM({
          tier: 'large',
          prompt,
          systemPrompt,
          category: 'sys2-extraction',
        })

        extracted = parseExtractionResponse(llmResponse.content)

        // Search round-trips
        let searchRounds = 0
        while (extracted.search && searchRounds < MAX_SEARCH_ROUNDS) {
          progress(`LLM requesting search: ${extracted.search.type} → "${extracted.search.query}"`)
          const searchText = await runGraphSearch(extracted.search)
          progress(`Search returned ${searchText.split('\n').length} results`)

          llmResponse = await callLLM({
            tier: 'large',
            prompt: `<search-res>\n${searchText}\n</search-res>`,
            systemPrompt,
            category: 'sys2-extraction-search',
          })

          extracted = parseExtractionResponse(llmResponse.content)
          searchRounds++
        }
      }

      progress(`Extraction complete — entities: ${extracted.entities.length}, memories: ${extracted.memories.length}, goals: ${extracted.goals.length}, topics: ${extracted.topics.length}, relationships: ${extracted.relationships.length}`)

      // ── Write nodes + edges to draft branch ────────────────────────
      const convIds = convRows.map(c => c.id)
      const counts = await writeNodesToGraph(extracted, branchId, pKey, slot, convIds)
      progress(`Wrote ${counts.entities}e ${counts.memories}m ${counts.goals}g ${counts.topics}t ${counts.relationships}r to draft branch`)

      // ── Save compaction ───────────────────────────────────────────
      // If the period hasn't ended yet (mid-period test run), mark as 'interim'
      // so the scheduler re-runs it automatically once the period closes.
      state.status = Date.now() < endMs ? 'interim' : 'done'
      state.extractedAt = Date.now()
      state.compaction = extracted.compaction
      state.counts = counts
      await savePeriodState(state)

      progress(`Extraction done for ${pKey}`)
      unsubUrl()

      // Close the ChatGPT tab after a short delay so streaming can finish.
      // The sidebar label ("SYS-II date-pN") is handled by the content script
      // based on the [RAMBLE:CONV:sys2-...] marker in the conversation.
      if (state.chatUrl) {
        const urlToClose = state.chatUrl
        setTimeout(() => rambleExt.closeTab(urlToClose), 60_000)
        log.info(`[${pKey}] Scheduled tab close:`, urlToClose)
      }

      return {
        periodKey: pKey,
        branchId,
        ...counts,
        compaction: extracted.compaction,
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Extraction failed for ${pKey}:`, err)
      state.status = 'error'
      state.error = msg
      await savePeriodState(state)
      unsubUrl()
      throw err
    }
  }

  /**
   * Commit a draft branch — merge all its nodes into global.
   * After commit, the period status becomes 'committed'.
   */
  async commit(pKey: string): Promise<void> {
    const state = await loadPeriodState(pKey)
    if (!state?.branchId) throw new Error(`No draft branch for ${pKey}`)

    const { getGraphService } = await import('../../graph')
    const { BranchManager } = await import('../../graph/branches/BranchManager')
    const graph = await getGraphService()
    const bm = new BranchManager(graph)

    await bm.mergeBranch(state.branchId)
    log.info(`Committed branch for ${pKey}`)

    state.status = 'committed'
    await savePeriodState(state)
  }

  /**
   * Discard a draft branch — archive it without merging.
   */
  async discard(pKey: string): Promise<void> {
    const state = await loadPeriodState(pKey)
    if (!state?.branchId) return

    const { getGraphService } = await import('../../graph')
    const graph = await getGraphService()

    await graph.exec(`DELETE FROM nodes WHERE branch_id = $1`, [state.branchId])
    await graph.exec(`DELETE FROM edges WHERE branch_id = $1`, [state.branchId])
    await graph.exec(`UPDATE branches SET status = 'archived' WHERE id = $1`, [state.branchId])

    state.status = 'pending'
    state.branchId = null
    state.extractedAt = null
    state.compaction = null
    state.chatSessionId = null
    state.chatUrl = null
    state.error = null
    state.counts = { entities: 0, memories: 0, goals: 0, topics: 0, relationships: 0 }
    await savePeriodState(state)

    log.info(`Discarded draft branch for ${pKey}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Find the compaction from the most recent completed period before this one.
 * Looks through DuckDB extraction_runs for the last done/committed period.
 */
async function findPreviousCompaction(date: string, slot: PeriodSlot): Promise<string | null> {
  const all = await loadAllPeriodStates()
  const slots: PeriodSlot[] = ['p1', 'p2', 'p3', 'p4']
  const slotIdx = slots.indexOf(slot)

  // Walk backwards: same day earlier slots, then prior days
  const candidates: Array<{ date: string; slot: PeriodSlot }> = []

  // Earlier slots same day
  for (let i = slotIdx - 1; i >= 0; i--) {
    candidates.push({ date, slot: slots[i] })
  }
  // Previous 2 days, all slots (newest first)
  for (let d = 1; d <= 2; d++) {
    const prevDate = dateStr(new Date(date + 'T12:00:00').getTime() - d * 86_400_000)
    for (let i = 3; i >= 0; i--) {
      candidates.push({ date: prevDate, slot: slots[i] })
    }
  }

  for (const c of candidates) {
    const state = all[periodKey(c.date, c.slot)]
    if (state?.compaction && (state.status === 'done' || state.status === 'committed')) {
      return state.compaction
    }
  }
  return null
}
