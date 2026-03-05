/**
 * Debug Utilities - window.ramble object for testing and debugging
 *
 * Provides convenient functions accessible from browser console:
 *   window.ramble.resetOnboarding()
 *   window.ramble.getUserProfile()
 *   window.ramble.clearAllData()
 *
 * Data export (dev only):
 *   window.ramble.exportMemories()         → JSON of all memories
 *   window.ramble.exportConversations()   → JSON of all conversations
 *   window.ramble.exportEntities()        → JSON of all entities
 *   window.ramble.exportTopics()          → JSON of all topics
 *   window.ramble.exportGoals()           → JSON of all goals
 *   window.ramble.exportKnowledgeNodes()  → JSON of all knowledge tree nodes
 *   window.ramble.exportCooccurrences()   → JSON of all entity co-occurrence pairs
 *   window.ramble.exportTimelineEvents()  → JSON of all timeline events
 *   window.ramble.exportAll()             → combined JSON of everything
 *   window.ramble.exportAllText()         → human-readable text (IDs resolved to names)
 *   window.ramble.copyAll()               → copies JSON export to clipboard
 *   window.ramble.copyAllText()           → copies text export to clipboard
 */

import { dataStore } from '../db/stores/dataStore'
import { settingsHelpers } from '../stores/settingsStore'
import {
  memoryStore,
  entityStore,
  topicStore,
  goalStore,
  conversationStore,
  knowledgeNodeStore,
  cooccurrenceStore,
  timelineEventStore,
} from '../db/stores'
import { workspaceStore } from '../stores/workspaceStore'

// ============================================================================
// Export serializers — flatten WatermelonDB models to plain objects
// ============================================================================

function serializeMemory(m: { id: string; content: string; type: string; subject?: string; entityIds: string; topicIds: string; sourceConversationIds: string; confidence: number; importance: number; validFrom?: number; validUntil?: number; firstExpressed: number; lastReinforced: number; reinforcementCount: number; supersededBy?: string; supersedes?: string; metadata: string; createdAt: number; state: string; origin?: string; ownershipScore: number; activityScore: number; extractionVersion?: string; contradicts?: string }) {
  return {
    id: m.id,
    content: m.content,
    type: m.type,
    subject: m.subject,
    entityIds: JSON.parse(m.entityIds || '[]'),
    topicIds: JSON.parse(m.topicIds || '[]'),
    sourceConversationIds: JSON.parse(m.sourceConversationIds || '[]'),
    confidence: m.confidence,
    importance: m.importance,
    validFrom: m.validFrom,
    validUntil: m.validUntil,
    firstExpressed: m.firstExpressed,
    lastReinforced: m.lastReinforced,
    reinforcementCount: m.reinforcementCount,
    supersededBy: m.supersededBy,
    supersedes: m.supersedes,
    metadata: JSON.parse(m.metadata || '{}'),
    createdAt: m.createdAt,
    state: m.state,
    origin: m.origin,
    ownershipScore: m.ownershipScore,
    activityScore: m.activityScore,
    extractionVersion: m.extractionVersion,
    contradicts: JSON.parse(m.contradicts || '[]'),
  }
}

function serializeConversation(c: { id: string; sessionId: string; timestamp: number; rawText: string; sanitizedText: string; summary?: string; source: string; speaker: string; processed: boolean; createdAt: number; normalizedText?: string; sentences?: string }) {
  return {
    id: c.id,
    sessionId: c.sessionId,
    timestamp: c.timestamp,
    rawText: c.rawText,
    sanitizedText: c.sanitizedText,
    summary: c.summary,
    source: c.source,
    speaker: c.speaker,
    processed: c.processed,
    createdAt: c.createdAt,
    normalizedText: c.normalizedText,
    sentences: JSON.parse(c.sentences || '[]'),
  }
}

function serializeEntity(e: { id: string; name: string; type: string; aliases: string; description?: string; firstMentioned: number; lastMentioned: number; mentionCount: number; metadata: string; createdAt: number }) {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    aliases: JSON.parse(e.aliases || '[]'),
    description: e.description,
    firstMentioned: e.firstMentioned,
    lastMentioned: e.lastMentioned,
    mentionCount: e.mentionCount,
    metadata: JSON.parse(e.metadata || '{}'),
    createdAt: e.createdAt,
  }
}

function serializeTopic(t: { id: string; name: string; description?: string; category?: string; entityIds: string; firstMentioned: number; lastMentioned: number; mentionCount: number; metadata: string; createdAt: number }) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    entityIds: JSON.parse(t.entityIds || '[]'),
    firstMentioned: t.firstMentioned,
    lastMentioned: t.lastMentioned,
    mentionCount: t.mentionCount,
    metadata: JSON.parse(t.metadata || '{}'),
    createdAt: t.createdAt,
  }
}

function serializeGoal(g: { id: string; statement: string; type: string; status: string; progress: number; parentGoalId?: string; entityIds: string; topicIds: string; memoryIds: string; firstExpressed: number; lastReferenced: number; achievedAt?: number; deadline?: number; metadata: string; createdAt: number }) {
  return {
    id: g.id,
    statement: g.statement,
    type: g.type,
    status: g.status,
    progress: g.progress,
    parentGoalId: g.parentGoalId,
    entityIds: JSON.parse(g.entityIds || '[]'),
    topicIds: JSON.parse(g.topicIds || '[]'),
    memoryIds: JSON.parse(g.memoryIds || '[]'),
    firstExpressed: g.firstExpressed,
    lastReferenced: g.lastReferenced,
    achievedAt: g.achievedAt,
    deadline: g.deadline,
    metadata: JSON.parse(g.metadata || '{}'),
    createdAt: g.createdAt,
  }
}

function serializeKnowledgeNode(n: { id: string; entityId: string; parentId: string | null; depth: number; sortOrder: number; label: string; summary: string | null; content: string | null; nodeType: string; source: string; verification: string; memoryIds: string; childCount: number; templateKey: string | null; metadata: string; modifiedAt: number; createdAt: number }) {
  return {
    id: n.id,
    entityId: n.entityId,
    parentId: n.parentId,
    depth: n.depth,
    sortOrder: n.sortOrder,
    label: n.label,
    summary: n.summary,
    content: n.content,
    nodeType: n.nodeType,
    source: n.source,
    verification: n.verification,
    memoryIds: JSON.parse(n.memoryIds || '[]'),
    childCount: n.childCount,
    templateKey: n.templateKey,
    metadata: JSON.parse(n.metadata || '{}'),
    modifiedAt: n.modifiedAt,
    createdAt: n.createdAt,
  }
}

function serializeCooccurrence(c: { id: string; entityA: string; entityB: string; count: number; recentContexts: string; lastSeen: number; createdAt: number }) {
  return {
    id: c.id,
    entityA: c.entityA,
    entityB: c.entityB,
    count: c.count,
    recentContexts: JSON.parse(c.recentContexts || '[]'),
    lastSeen: c.lastSeen,
    createdAt: c.createdAt,
  }
}

function serializeTimelineEvent(t: { id: string; entityIds: string; eventTime: number; timeGranularity: string; timeConfidence: number; title: string; description: string; significance: string | null; memoryIds: string; source: string; metadata: string; createdAt: number }) {
  return {
    id: t.id,
    entityIds: JSON.parse(t.entityIds || '[]'),
    eventTime: t.eventTime,
    timeGranularity: t.timeGranularity,
    timeConfidence: t.timeConfidence,
    title: t.title,
    description: t.description,
    significance: t.significance,
    memoryIds: JSON.parse(t.memoryIds || '[]'),
    source: t.source,
    metadata: JSON.parse(t.metadata || '{}'),
    createdAt: t.createdAt,
  }
}

/** Copy JSON string to clipboard */
async function copyToClipboard(data: unknown, label: string) {
  const json = JSON.stringify(data, null, 2)
  await navigator.clipboard.writeText(json)
  console.log(`[ramble] ${label} copied to clipboard (${json.length} chars)`)
}

// ============================================================================
// Text export — human-readable, IDs resolved to names
// ============================================================================

function fmtDate(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(ts?: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function resolveIds(ids: string[], lookup: Map<string, string>): string {
  if (!ids.length) return '—'
  return ids.map(id => lookup.get(id) ?? id).join(', ')
}

interface ExportData {
  exportedAt: string
  memories: ReturnType<typeof serializeMemory>[]
  conversations: ReturnType<typeof serializeConversation>[]
  entities: ReturnType<typeof serializeEntity>[]
  topics: ReturnType<typeof serializeTopic>[]
  goals: ReturnType<typeof serializeGoal>[]
  knowledgeNodes: ReturnType<typeof serializeKnowledgeNode>[]
  cooccurrences: ReturnType<typeof serializeCooccurrence>[]
  timelineEvents: ReturnType<typeof serializeTimelineEvent>[]
}

function buildTextExport(data: ExportData): string {
  const entityMap = new Map(data.entities.map(e => [e.id, e.name]))
  const topicMap = new Map(data.topics.map(t => [t.id, t.name]))
  const memoryMap = new Map(data.memories.map(m => [m.id, m.content.slice(0, 60)]))

  const lines: string[] = []
  const push = (s = '') => lines.push(s)
  const divider = (title: string, count: number) => {
    push(`\n${'─'.repeat(40)}`)
    push(`  ${title} (${count})`)
    push(`${'─'.repeat(40)}`)
  }

  push(`══════════════════════════════════════════`)
  push(`  RAMBLE EXPORT — ${data.exportedAt}`)
  push(`══════════════════════════════════════════`)
  push(`  Entities: ${data.entities.length} | Topics: ${data.topics.length} | Memories: ${data.memories.length} | Goals: ${data.goals.length} | Conversations: ${data.conversations.length}`)
  push(`  Knowledge Nodes: ${data.knowledgeNodes.length} | Co-occurrences: ${data.cooccurrences.length} | Timeline Events: ${data.timelineEvents.length}`)

  // ── Entities ──
  divider('ENTITIES', data.entities.length)
  for (const e of data.entities) {
    push(`\n• ${e.name}  [${e.type}]`)
    if (e.description) push(`  ${e.description}`)
    if (e.aliases.length) push(`  Aliases: ${e.aliases.join(', ')}`)
    push(`  Mentions: ${e.mentionCount}  (${fmtDate(e.firstMentioned)} → ${fmtDate(e.lastMentioned)})`)
  }

  // ── Topics ──
  divider('TOPICS', data.topics.length)
  for (const t of data.topics) {
    push(`\n• ${t.name}${t.category ? `  [${t.category}]` : ''}`)
    if (t.description) push(`  ${t.description}`)
    if (t.entityIds.length) push(`  Entities: ${resolveIds(t.entityIds, entityMap)}`)
    push(`  Mentions: ${t.mentionCount}  (${fmtDate(t.firstMentioned)} → ${fmtDate(t.lastMentioned)})`)
  }

  // ── Memories ──
  divider('MEMORIES', data.memories.length)
  for (const m of data.memories) {
    push(`\n• [${m.type}/${m.state}] ${m.content}`)
    if (m.subject) push(`  Subject: ${m.subject}`)
    if (m.entityIds.length) push(`  Entities: ${resolveIds(m.entityIds, entityMap)}`)
    if (m.topicIds.length) push(`  Topics: ${resolveIds(m.topicIds, topicMap)}`)
    const parts: string[] = []
    if (m.confidence != null) parts.push(`conf: ${m.confidence}`)
    if (m.importance != null) parts.push(`imp: ${m.importance}`)
    if (m.origin) parts.push(`origin: ${m.origin}`)
    if (m.reinforcementCount > 0) parts.push(`reinforced: ${m.reinforcementCount}x`)
    if (parts.length) push(`  ${parts.join(' | ')}`)
    push(`  ${fmtDate(m.firstExpressed)} → ${fmtDate(m.lastReinforced)}`)
    if (m.supersededBy) push(`  Superseded by: ${memoryMap.get(m.supersededBy) ?? m.supersededBy}`)
    if (m.contradicts.length) push(`  Contradicts: ${m.contradicts.map((id: string) => memoryMap.get(id) ?? id).join(', ')}`)
  }

  // ── Goals ──
  divider('GOALS', data.goals.length)
  for (const g of data.goals) {
    push(`\n• [${g.status}] ${g.statement}  (${g.progress}%)`)
    if (g.type) push(`  Type: ${g.type}`)
    if (g.entityIds.length) push(`  Entities: ${resolveIds(g.entityIds, entityMap)}`)
    if (g.topicIds.length) push(`  Topics: ${resolveIds(g.topicIds, topicMap)}`)
    if (g.memoryIds.length) push(`  Memories: ${g.memoryIds.map((id: string) => memoryMap.get(id) ?? id).join(', ')}`)
    if (g.parentGoalId) push(`  Parent: ${g.parentGoalId}`)
    if (g.deadline) push(`  Deadline: ${fmtDate(g.deadline)}`)
    push(`  ${fmtDate(g.firstExpressed)} → ${fmtDate(g.lastReferenced)}`)
  }

  // ── Knowledge Trees ──
  if (data.knowledgeNodes.length > 0) {
    // Group nodes by entityId to show per-entity trees
    const nodesByEntity = new Map<string, ReturnType<typeof serializeKnowledgeNode>[]>()
    for (const n of data.knowledgeNodes) {
      if (!nodesByEntity.has(n.entityId)) nodesByEntity.set(n.entityId, [])
      nodesByEntity.get(n.entityId)!.push(n)
    }

    divider(`KNOWLEDGE TREES — ${nodesByEntity.size} entities`, data.knowledgeNodes.length)
    for (const [entityId, nodes] of nodesByEntity) {
      const entityName = entityMap.get(entityId) ?? entityId
      push(`\n  ── ${entityName} (${nodes.length} nodes) ──`)

      // Build indented tree
      const childrenMap = new Map<string | null, typeof nodes>()
      for (const n of nodes) {
        const pid = n.parentId
        if (!childrenMap.has(pid)) childrenMap.set(pid, [])
        childrenMap.get(pid)!.push(n)
      }
      for (const [, kids] of childrenMap) kids.sort((a, b) => a.sortOrder - b.sortOrder)

      const printNode = (n: ReturnType<typeof serializeKnowledgeNode>, indent: string) => {
        const vMark = n.verification === 'contradicted' ? ' ✗' : n.verification === 'unverified' ? ' ?' : ''
        const content = n.content ? `: ${n.content.slice(0, 80)}` : n.summary ? `: ${n.summary}` : ''
        push(`${indent}${n.nodeType === 'group' ? '▼' : '•'} ${n.label}${content}${vMark}  [${n.nodeType}/${n.source}]`)
        const kids = childrenMap.get(n.id) ?? []
        for (const kid of kids) printNode(kid, indent + '  ')
      }

      const roots = childrenMap.get(null) ?? []
      for (const root of roots) printNode(root, '  ')
    }
  }

  // ── Co-occurrences ──
  if (data.cooccurrences.length > 0) {
    divider('CO-OCCURRENCES', data.cooccurrences.length)
    for (const c of data.cooccurrences) {
      const nameA = entityMap.get(c.entityA) ?? c.entityA
      const nameB = entityMap.get(c.entityB) ?? c.entityB
      push(`\n• ${nameA} ↔ ${nameB}  (${c.count}×, last: ${fmtDate(c.lastSeen)})`)
      if (c.recentContexts.length) {
        for (const ctx of c.recentContexts.slice(0, 3)) {
          push(`  "${String(ctx).slice(0, 80)}"`)
        }
      }
    }
  }

  // ── Timeline Events ──
  if (data.timelineEvents.length > 0) {
    divider('TIMELINE EVENTS', data.timelineEvents.length)
    for (const t of data.timelineEvents) {
      const entities = resolveIds(t.entityIds, entityMap)
      push(`\n• [${fmtDateTime(t.eventTime)}] ${t.title}`)
      push(`  Entities: ${entities}`)
      if (t.description) push(`  ${t.description.slice(0, 120)}`)
      if (t.significance) push(`  Significance: ${t.significance}`)
      const parts: string[] = []
      parts.push(`granularity: ${t.timeGranularity}`)
      parts.push(`confidence: ${t.timeConfidence}`)
      parts.push(`source: ${t.source}`)
      push(`  ${parts.join(' | ')}`)
    }
  }

  // ── Conversations ──
  divider('CONVERSATIONS', data.conversations.length)
  let lastSession = ''
  for (const c of data.conversations) {
    if (c.sessionId !== lastSession) {
      push(`\n  ── Session: ${c.sessionId.slice(0, 8)} ──`)
      lastSession = c.sessionId
    }
    const text = c.sanitizedText || c.rawText
    push(`  [${fmtDateTime(c.timestamp)}] (${c.speaker}/${c.source}) ${text}`)
  }

  push('')
  return lines.join('\n')
}

// Define the ramble debug interface
interface RambleDebug {
  // Onboarding
  resetOnboarding: () => Promise<void>
  getOnboardingStatus: () => Promise<unknown>

  // User Profile
  getUserProfile: () => Promise<unknown>
  clearUserProfile: () => Promise<void>

  // Combined
  clearOnboardingData: () => Promise<void>

  // Settings
  getSettings: () => unknown
  clearApiKeys: () => void

  // Database
  resetDatabase: () => Promise<void>

  // Data store
  getData: (key: string) => Promise<unknown>
  setData: (key: string, type: string, value: unknown) => Promise<void>
  deleteData: (key: string) => Promise<boolean>

  // Workspace export
  exportWorkspaces: () => unknown

  // Data export (dev only) — returns data and copies to clipboard
  exportMemories: () => Promise<unknown[]>
  exportConversations: (limit?: number) => Promise<unknown[]>
  exportEntities: () => Promise<unknown[]>
  exportTopics: () => Promise<unknown[]>
  exportGoals: () => Promise<unknown[]>
  exportKnowledgeNodes: () => Promise<unknown[]>
  exportCooccurrences: () => Promise<unknown[]>
  exportTimelineEvents: () => Promise<unknown[]>
  exportAll: () => Promise<Record<string, unknown>>
  exportAllText: () => Promise<string>
  copyAll: () => Promise<void>
  copyAllText: () => Promise<void>
}

// Create the ramble debug object
const rambleDebug: RambleDebug = {
  // ============================================================================
  // Onboarding
  // ============================================================================

  async resetOnboarding() {
    await dataStore.resetOnboarding()
    console.log('[ramble] Onboarding reset to initial state')
  },

  async getOnboardingStatus() {
    const status = await dataStore.getOnboarding()
    console.log('[ramble] Onboarding status:', status)
    return status
  },

  // ============================================================================
  // User Profile
  // ============================================================================

  async getUserProfile() {
    const profile = await dataStore.getUserProfile()
    console.log('[ramble] User profile:', profile)
    return profile
  },

  async clearUserProfile() {
    await dataStore.delete('user_profile')
    console.log('[ramble] User profile cleared')
  },

  // ============================================================================
  // Combined (Profile-specific only - does NOT touch global settings/API keys)
  // ============================================================================

  async clearOnboardingData() {
    await dataStore.resetOnboarding()
    await dataStore.delete('user_profile')
    console.log('[ramble] Onboarding data cleared for current profile:')
    console.log('[ramble]   - Onboarding status reset')
    console.log('[ramble]   - User profile deleted')
    console.log('[ramble] Note: API keys and settings are NOT affected (they are global)')
    console.log('[ramble] Reload the page to restart onboarding')
  },

  // ============================================================================
  // Settings
  // ============================================================================

  getSettings() {
    const settings = settingsHelpers.getSettings()
    console.log('[ramble] Settings:', settings)
    return settings
  },

  clearApiKeys() {
    settingsHelpers.setApiKey('gemini', '')
    settingsHelpers.setApiKey('anthropic', '')
    settingsHelpers.setApiKey('openai', '')
    settingsHelpers.setApiKey('groq', '')
    settingsHelpers.setApiKey('deepgram', '')
    console.log('[ramble] All API keys cleared')
  },

  // ============================================================================
  // Database Management
  // ============================================================================

  async resetDatabase() {
    console.log('[ramble] Clearing all IndexedDB databases...')
    const dbs = await indexedDB.databases()
    for (const db of dbs) {
      if (db.name) {
        console.log('[ramble] Deleting:', db.name)
        indexedDB.deleteDatabase(db.name)
      }
    }
    console.log('[ramble] Done! Reloading in 500ms...')
    setTimeout(() => location.reload(), 500)
  },

  // ============================================================================
  // Generic Data Store Access
  // ============================================================================

  async getData(key: string) {
    const data = await dataStore.getValue(key)
    console.log(`[ramble] Data[${key}]:`, data)
    return data
  },

  async setData(key: string, type: string, value: unknown) {
    await dataStore.set(key, type as 'custom', value)
    console.log(`[ramble] Data[${key}] set`)
  },

  async deleteData(key: string) {
    const result = await dataStore.delete(key)
    console.log(`[ramble] Data[${key}] deleted:`, result)
    return result
  },

  // ============================================================================
  // Workspace Export
  // ============================================================================

  exportWorkspaces() {
    const state = workspaceStore.getState()
    console.log(`[ramble] Exported ${state.workspaces.length} workspaces`)
    return state
  },

  // ============================================================================
  // Data Export (dev only)
  // ============================================================================

  async exportMemories() {
    const all = await memoryStore.getAll()
    const serialized = all.map(serializeMemory)
    console.log(`[ramble] Exported ${serialized.length} memories`)
    return serialized
  },

  async exportConversations(limit = 500) {
    const all = await conversationStore.getRecent(limit)
    const serialized = all.map(serializeConversation)
    console.log(`[ramble] Exported ${serialized.length} conversations`)
    return serialized
  },

  async exportEntities() {
    const all = await entityStore.getAll()
    const serialized = all.map(serializeEntity)
    console.log(`[ramble] Exported ${serialized.length} entities`)
    return serialized
  },

  async exportTopics() {
    const all = await topicStore.getAll()
    const serialized = all.map(serializeTopic)
    console.log(`[ramble] Exported ${serialized.length} topics`)
    return serialized
  },

  async exportGoals() {
    const all = await goalStore.getAll()
    const serialized = all.map(serializeGoal)
    console.log(`[ramble] Exported ${serialized.length} goals`)
    return serialized
  },

  async exportKnowledgeNodes() {
    const all = await knowledgeNodeStore.getAll()
    const serialized = all.map(serializeKnowledgeNode)
    console.log(`[ramble] Exported ${serialized.length} knowledge nodes`)
    return serialized
  },

  async exportCooccurrences() {
    const all = await cooccurrenceStore.getAll()
    const serialized = all.map(serializeCooccurrence)
    console.log(`[ramble] Exported ${serialized.length} co-occurrences`)
    return serialized
  },

  async exportTimelineEvents() {
    const all = await timelineEventStore.getAll()
    const serialized = all.map(serializeTimelineEvent)
    console.log(`[ramble] Exported ${serialized.length} timeline events`)
    return serialized
  },

  async exportAll() {
    const [memories, conversations, entities, topics, goals, knowledgeNodes, cooccurrences, timelineEvents] = await Promise.all([
      this.exportMemories(),
      this.exportConversations(),
      this.exportEntities(),
      this.exportTopics(),
      this.exportGoals(),
      this.exportKnowledgeNodes(),
      this.exportCooccurrences(),
      this.exportTimelineEvents(),
    ])
    const data = {
      exportedAt: new Date().toISOString(),
      memories,
      conversations,
      entities,
      topics,
      goals,
      knowledgeNodes,
      cooccurrences,
      timelineEvents,
    }
    console.log('[ramble] Full export ready:', {
      memories: memories.length,
      conversations: conversations.length,
      entities: entities.length,
      topics: topics.length,
      goals: goals.length,
      knowledgeNodes: knowledgeNodes.length,
      cooccurrences: cooccurrences.length,
      timelineEvents: timelineEvents.length,
    })
    return data
  },

  async exportAllText() {
    const [memories, conversations, entities, topics, goals, knowledgeNodes, cooccurrences, timelineEvents] = await Promise.all([
      this.exportMemories(),
      this.exportConversations(),
      this.exportEntities(),
      this.exportTopics(),
      this.exportGoals(),
      this.exportKnowledgeNodes(),
      this.exportCooccurrences(),
      this.exportTimelineEvents(),
    ]) as [
      ReturnType<typeof serializeMemory>[],
      ReturnType<typeof serializeConversation>[],
      ReturnType<typeof serializeEntity>[],
      ReturnType<typeof serializeTopic>[],
      ReturnType<typeof serializeGoal>[],
      ReturnType<typeof serializeKnowledgeNode>[],
      ReturnType<typeof serializeCooccurrence>[],
      ReturnType<typeof serializeTimelineEvent>[],
    ]
    const text = buildTextExport({
      exportedAt: new Date().toISOString(),
      memories,
      conversations,
      entities,
      topics,
      goals,
      knowledgeNodes,
      cooccurrences,
      timelineEvents,
    })
    console.log(`[ramble] Text export ready (${text.length} chars)`)
    return text
  },

  async copyAllText() {
    const text = await this.exportAllText()
    await navigator.clipboard.writeText(text)
    console.log(`[ramble] Text export copied to clipboard (${text.length} chars)`)
  },

  async copyAll() {
    const data = await this.exportAll()
    await copyToClipboard(data, 'Full export')
  },
}

// ============================================================================
// Attach .doc to every method for console discoverability
// Usage: window.ramble.exportAllText.doc → description string
// ============================================================================

type DocFn = ((...args: unknown[]) => unknown) & { doc: string }

function attachDocs(obj: Record<string, unknown>, docs: Record<string, string>) {
  for (const [key, doc] of Object.entries(docs)) {
    if (typeof obj[key] === 'function') {
      (obj[key] as DocFn).doc = doc
    }
  }
}

attachDocs(rambleDebug as unknown as Record<string, unknown>, {
  resetOnboarding:
    `Wipes onboarding progress so the welcome flow replays on next reload.
Only touches the onboarding state in the data store — user profile, API keys, and DB data are untouched.
Params: none | Returns: Promise<void>`,

  getOnboardingStatus:
    `Reads the onboarding state for the current profile.
Returns an object like { step: "welcome", completed: false, skippedSteps: [] }.
Params: none | Returns: Promise<object | null>`,

  getUserProfile:
    `Reads the user profile built during onboarding (name, preferences, etc.).
Returns null if onboarding hasn't completed yet.
Params: none | Returns: Promise<object | null>`,

  clearUserProfile:
    `Deletes the user profile so onboarding will re-ask profile questions.
Does NOT reset the onboarding step — combine with resetOnboarding() for a full redo.
Params: none | Returns: Promise<void>`,

  clearOnboardingData:
    `Resets both onboarding status AND user profile in one call. Scoped to the current profile only.
API keys, settings, and all WatermelonDB data (memories, conversations, etc.) are untouched.
Reload the page after calling to restart the onboarding flow.
Params: none | Returns: Promise<void>`,

  getSettings:
    `Returns the full settings object from localStorage (synchronous).
Includes all API keys (gemini, anthropic, openai, groq, deepgram), LLM tier config, and UI preferences.
Params: none | Returns: Settings object`,

  clearApiKeys:
    `Sets all five API key slots (gemini, anthropic, openai, groq, deepgram) to empty strings.
Settings are global — not scoped to a profile. Other settings are untouched.
Params: none | Returns: void`,

  resetDatabase:
    `⚠️ DESTRUCTIVE — deletes every IndexedDB database (all profiles, all data) then reloads the page after 500ms.
There is no undo. All memories, conversations, entities, topics, goals, and data store entries are gone.
Params: none | Returns: Promise<void> (page reloads)`,

  getData:
    `Reads a single value from the generic key-value data store (WatermelonDB).
Used internally for onboarding state, user profile, feature flags, etc.
Params: key: string | Returns: Promise<unknown>
Example: getData("user_profile"), getData("onboarding")`,

  setData:
    `Writes a value to the generic key-value data store. Creates or overwrites.
Params: key: string, type: string (e.g. "custom"), value: any JSON-serializable value
Returns: Promise<void>
Example: setData("my_flag", "custom", { enabled: true })`,

  deleteData:
    `Removes a key from the data store.
Params: key: string | Returns: Promise<boolean> — true if the key existed, false if it was already absent`,

  exportWorkspaces:
    `Returns the workspace store snapshot from localStorage (not WatermelonDB).
Includes the active workspace ID and the full array of workspaces, each with id, name, layout tree, icon, theme, order, etc.
Params: none | Returns: { activeId: string, workspaces: Workspace[] }`,

  exportMemories:
    `Fetches all memories from WatermelonDB and serializes them to plain objects.
JSON string fields (entityIds, topicIds, sourceConversationIds, metadata, contradicts) are parsed into arrays/objects.
Each memory has: id, content, type (fact|belief|goal|concern|preference|...), state (provisional|stable|contested|superseded), subject, confidence (0-1), importance (0-1), origin (speech|typed|pasted|...), reinforcementCount, supersededBy, contradicts[], etc.
Params: none | Returns: Promise<SerializedMemory[]>`,

  exportConversations:
    `Fetches recent conversations ordered by timestamp descending.
Each entry is one speech/text turn: rawText, sanitizedText, speaker (user|agent), source (speech|typed|pasted|document|meeting), sessionId to group turns, and parsed sentences[] array.
Params: limit?: number (default 500) | Returns: Promise<SerializedConversation[]>`,

  exportEntities:
    `Fetches all known entities (people, orgs, places, projects, concepts, etc.).
Each entity has: id, name, type, aliases[] (parsed from JSON), description, mentionCount, firstMentioned/lastMentioned timestamps, and parsed metadata.
Params: none | Returns: Promise<SerializedEntity[]>`,

  exportTopics:
    `Fetches all topics (recurring themes/subjects across conversations).
Each topic has: id, name, category (work|personal|health|...), description, entityIds[] resolved from JSON, mentionCount, and first/lastMentioned timestamps.
Params: none | Returns: Promise<SerializedTopic[]>`,

  exportGoals:
    `Fetches all goals (active, achieved, abandoned, blocked).
Each goal has: id, statement, type, status, progress (0-100), parentGoalId for hierarchy, entityIds[], topicIds[], memoryIds[] (all parsed from JSON), deadline, achievedAt, etc.
Params: none | Returns: Promise<SerializedGoal[]>`,

  exportKnowledgeNodes:
    `Fetches all knowledge tree nodes from WatermelonDB and serializes them to plain objects.
Each node has: id, entityId, parentId, depth, sortOrder, label, summary, content, nodeType (text|group|keyvalue|table|reference), source (template|user|inferred|document), verification (confirmed|mentioned|unverified|contradicted), memoryIds[], childCount, templateKey, metadata, modifiedAt.
Nodes form per-entity trees — use parentId to reconstruct hierarchy.
Params: none | Returns: Promise<SerializedKnowledgeNode[]>`,

  exportCooccurrences:
    `Fetches all entity co-occurrence pairs. Tracks which entities appear together in conversations.
Each entry has: entityIdA, entityIdB (canonical order: smaller ID first), count (times seen together), recentContexts[] (last few conversation snippets), lastSeen timestamp.
Params: none | Returns: Promise<SerializedCooccurrence[]>`,

  exportTimelineEvents:
    `Fetches all timeline events extracted during knowledge tree curation.
Each event has: entityIds[], eventTime (interpreted timestamp), timeGranularity (exact|day|week|month|approximate), timeConfidence (0-1), title, description, significance, memoryIds[], source.
Events represent user-referenced happenings (meetings, milestones, etc.), not system events.
Params: none | Returns: Promise<SerializedTimelineEvent[]>`,

  exportAll:
    `Fetches everything in parallel and returns a single JSON-friendly object.
Shape: { exportedAt, memories, conversations, entities, topics, goals, knowledgeNodes, cooccurrences, timelineEvents }
All JSON string fields are already parsed. IDs are raw UUIDs — use exportAllText() if you want names instead.
Params: none | Returns: Promise<object>`,

  exportAllText:
    `Human-readable text version of exportAll(). Builds lookup maps so every entityId, topicId, and memoryId is replaced with its actual name/content.
Output is a single formatted string with sections:
  ENTITIES — name [type], aliases, description, mention stats
  TOPICS — name [category], linked entity names, mention stats
  MEMORIES — [type/state] content, subject, entity & topic names, confidence/importance/origin, reinforcement count, supersession & contradiction chains
  GOALS — [status] statement (progress%), entity & topic names, memory previews
  KNOWLEDGE TREES — per-entity indented tree structure with node types, verification status
  CO-OCCURRENCES — entity pairs with count, recent context snippets
  TIMELINE EVENTS — [datetime] title, entities, significance, granularity
  CONVERSATIONS — grouped by session, each line: [date time] (speaker/source) text
Params: none | Returns: Promise<string>`,

  copyAll:
    `Runs exportAll(), JSON.stringify's the result with 2-space indent, and writes it to the clipboard.
Logs the character count to console. Useful for pasting into a file or sending to an LLM.
Params: none | Returns: Promise<void>`,

  copyAllText:
    `Runs exportAllText() and writes the formatted text string to the clipboard.
Logs the character count to console. The text is compact and readable — good for pasting into a doc or chat.
Params: none | Returns: Promise<void>`,
})

// Attach to window
declare global {
  interface Window {
    ramble: RambleDebug
  }
}

export function initDebugUtils() {
  if (typeof window !== 'undefined') {
    window.ramble = rambleDebug
    console.log('[ramble] Debug utilities loaded. Try: window.ramble.getOnboardingStatus()')
  }
}

// Auto-initialize
initDebugUtils()
