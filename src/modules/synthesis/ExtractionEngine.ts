/**
 * ExtractionEngine — SYS-II Knowledge Synthesis
 *
 * For each 6-hour period, synthesizes all user conversations into graph nodes.
 * Nodes are written to a draft branch (extraction/YYYY-MM-DD-p{n}) with low
 * confidence and period tag. They stay in draft until manually committed.
 *
 * Flow per period:
 *   1. Load conversations for the period from DuckDB
 *   2. Prepend previous period's compaction as context
 *   3. Send to ChatGPT (new session per run) with SYS-II prompt
 *   4. Handle search round-trips (up to MAX_SEARCH_ROUNDS)
 *   5. Write extracted nodes to the draft branch
 *   6. Save compaction to profileStorage for next period
 *   7. Emit progress + completion events
 *
 * The engine is stateless between runs. PeriodScheduler drives it.
 */

import { profileStorage } from '../../lib/profileStorage'
import { createLogger } from '../../program/utils/logger'
import { rambleExt } from '../chrome-extension'
import { buildSys2Prompt } from './prompt'
import { periodMs, periodKey, dateStr } from './periodUtils'
import type {
  PeriodSlot,
  PeriodExtractionState,
  ExtractionLLMResponse,
  ExtractionSearchRequest,
  ExtractionSummary,
} from './types'

const log = createLogger('ExtractionEngine')

const MAX_SEARCH_ROUNDS = 5
const STORAGE_KEY_PERIODS = 'synthesis-periods'

// ── Storage helpers ──────────────────────────────────────────────────

export function loadAllPeriodStates(): Record<string, PeriodExtractionState> {
  return profileStorage.getJSON<Record<string, PeriodExtractionState>>(STORAGE_KEY_PERIODS) ?? {}
}

export function loadPeriodState(pKey: string): PeriodExtractionState | null {
  return loadAllPeriodStates()[pKey] ?? null
}

function savePeriodState(state: PeriodExtractionState): void {
  const all = loadAllPeriodStates()
  all[state.periodKey] = state
  profileStorage.setJSON(STORAGE_KEY_PERIODS, all)
}

// ── JSON Parsing Helper ──────────────────────────────────────────────

function parseExtractionResponse(raw: string): ExtractionLLMResponse {
  const stripped = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(stripped)
    return {
      entities:   Array.isArray(parsed.entities)  ? parsed.entities  : [],
      memories:   Array.isArray(parsed.memories)  ? parsed.memories  : [],
      goals:      Array.isArray(parsed.goals)     ? parsed.goals     : [],
      topics:     Array.isArray(parsed.topics)    ? parsed.topics    : [],
      compaction: typeof parsed.compaction === 'string' ? parsed.compaction : '',
      search:     parsed.search ?? null,
    }
  } catch {
    log.warn('Failed to parse SYS-II JSON response')
    return { entities: [], memories: [], goals: [], topics: [], compaction: '', search: null }
  }
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
): Promise<{ entities: number; memories: number; goals: number; topics: number }> {
  const { getGraphService } = await import('../../graph')
  const graph = await getGraphService()

  const now = Date.now()
  let entityCount = 0
  let memoryCount = 0
  let goalCount = 0
  let topicCount = 0

  // Write entities
  for (const e of result.entities) {
    const id = `ent_${now}_${++entityCount}_${Math.random().toString(36).slice(2, 5)}`
    const props = {
      name: e.name,
      type: e.type,
      description: e.description ?? null,
      aliases: e.aliases ?? [],
      mentionCount: 1,
      firstMentioned: now,
      lastMentioned: now,
      confidence: e.confidence,
      period: slot,
      extractionPeriodKey: pKey,
      state: 'draft',
    }
    await graph.createNode({
      id,
      branchId,
      labels: ['entity', e.type],
      properties: props,
    })
  }

  // Write memories
  for (const m of result.memories) {
    const id = `mem_${now}_${++memoryCount}_${Math.random().toString(36).slice(2, 5)}`
    const sourceCids = m.sourceConversationIndices
      .map(i => conversationIds[i])
      .filter(Boolean)

    const props = {
      content: m.content,
      type: m.slotTemplate.type,
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
      slotTemplate: m.slotTemplate,
      relatedEntityNames: m.relatedEntityNames,
    }
    await graph.createNode({
      id,
      branchId,
      labels: ['memory', m.slotTemplate.type.toLowerCase()],
      properties: props,
    })
  }

  // Write goals
  for (const g of result.goals) {
    const id = `goal_${now}_${++goalCount}_${Math.random().toString(36).slice(2, 5)}`
    const props = {
      statement: g.statement,
      type: g.type,
      motivation: g.motivation ?? null,
      deadline: g.deadline ?? null,
      status: 'active',
      progress: 0,
      confidence: g.confidence,
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
    const props = {
      name: t.name,
      category: t.category ?? null,
      mentionCount: 1,
      firstMentioned: now,
      lastMentioned: now,
      confidence: t.confidence,
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

  return { entities: entityCount, memories: memoryCount, goals: goalCount, topics: topicCount }
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

    progress(`Starting extraction for ${pKey}`)

    // ── Mark as running ──────────────────────────────────────────────
    const state: PeriodExtractionState = {
      periodKey: pKey,
      date,
      slot,
      status: 'running',
      branchId: null,
      conversationCount: 0,
      extractedAt: null,
      compaction: null,
      chatSessionId: null,
      chatUrl: null,
      error: null,
      counts: { entities: 0, memories: 0, goals: 0, topics: 0 },
    }
    savePeriodState(state)

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
        savePeriodState(state)
        return { periodKey: pKey, branchId: '', entities: 0, memories: 0, goals: 0, topics: 0, compaction: '' }
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
      savePeriodState(state)
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
      const previousCompaction = findPreviousCompaction(date, slot)
      const prompt = previousCompaction
        ? `=== PREVIOUS PERIOD CONTEXT ===\n${previousCompaction}\n\n=== CONVERSATIONS ===\n\n${convLines}`
        : `=== CONVERSATIONS ===\n\n${convLines}`

      // ── Send to ChatGPT ──────────────────────────────────────────
      if (!rambleExt.isAvailable) {
        throw new Error('Chrome extension not available — cannot run SYS-II without ChatGPT transport')
      }

      const sessionId = `sys2-${pKey}-${Date.now()}`
      state.chatSessionId = sessionId
      savePeriodState(state)

      progress('Sending to ChatGPT...')
      let response = await rambleExt.aiConversation({
        conversationId: sessionId,
        prompt,
        systemPrompt,
      })

      if (response.chatUrl) {
        state.chatUrl = response.chatUrl
        savePeriodState(state)
      }

      let extracted = parseExtractionResponse(response.answer)

      // ── Search round-trips ────────────────────────────────────────
      let searchRounds = 0
      while (extracted.search && searchRounds < MAX_SEARCH_ROUNDS) {
        progress(`LLM requesting search: ${extracted.search.type} → "${extracted.search.query}"`)
        const searchText = await runGraphSearch(extracted.search)
        progress(`Search returned ${searchText.split('\n').length} results`)

        response = await rambleExt.aiConversation({
          conversationId: sessionId,
          prompt: `<search-res>\n${searchText}\n</search-res>`,
          chatUrl: state.chatUrl ?? undefined,
        })

        if (response.chatUrl && response.chatUrl !== state.chatUrl) {
          state.chatUrl = response.chatUrl
          savePeriodState(state)
        }

        extracted = parseExtractionResponse(response.answer)
        searchRounds++
      }

      progress(`Extraction complete — entities: ${extracted.entities.length}, memories: ${extracted.memories.length}, goals: ${extracted.goals.length}, topics: ${extracted.topics.length}`)

      // ── Write nodes to draft branch ──────────────────────────────
      const convIds = convRows.map(c => c.id)
      const counts = await writeNodesToGraph(extracted, branchId, pKey, slot, convIds)
      progress(`Wrote ${counts.entities} entities, ${counts.memories} memories, ${counts.goals} goals, ${counts.topics} topics to draft branch`)

      // ── Save compaction ───────────────────────────────────────────
      state.status = 'done'
      state.extractedAt = Date.now()
      state.compaction = extracted.compaction
      state.counts = counts
      savePeriodState(state)

      progress(`Extraction done for ${pKey}`)

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
      savePeriodState(state)
      throw err
    }
  }

  /**
   * Commit a draft branch — merge all its nodes into global.
   * After commit, the period status becomes 'committed'.
   */
  async commit(pKey: string): Promise<void> {
    const state = loadPeriodState(pKey)
    if (!state?.branchId) throw new Error(`No draft branch for ${pKey}`)

    const { getGraphService } = await import('../../graph')
    const { BranchManager } = await import('../../graph/branches/BranchManager')
    const graph = await getGraphService()
    const bm = new BranchManager(graph)

    await bm.mergeBranch(state.branchId)
    log.info(`Committed branch for ${pKey}`)

    state.status = 'committed'
    savePeriodState(state)
  }

  /**
   * Discard a draft branch — archive it without merging.
   */
  async discard(pKey: string): Promise<void> {
    const state = loadPeriodState(pKey)
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
    state.counts = { entities: 0, memories: 0, goals: 0, topics: 0 }
    savePeriodState(state)

    log.info(`Discarded draft branch for ${pKey}`)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Find the compaction from the most recent completed period before this one.
 * Looks through profileStorage for the last done/committed period.
 */
function findPreviousCompaction(date: string, slot: PeriodSlot): string | null {
  const all = loadAllPeriodStates()
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
