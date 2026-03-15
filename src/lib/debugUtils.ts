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
 *   window.ramble.exportAll()             → combined JSON of everything
 *   window.ramble.exportAllText()         → human-readable text (IDs resolved to names)
 *   window.ramble.copyAll()               → copies JSON export to clipboard
 *   window.ramble.copyAllText()           → copies text export to clipboard
 */

import { dataStore } from '../graph/stores/dataStore'
import { settingsHelpers } from '../stores/settingsStore'
import { conversationStore } from '../graph/stores/conversationStore'
import { getEntityStore, getTopicStore, getMemoryStore, getGoalStore } from '../graph/stores/singletons'
import { workspaceStore } from '../stores/workspaceStore'
import { fullEntityMerge, renameEntity as renameEntityFn } from '../program/entityResolution/entityMerge'
import type { MergeResult } from '../program/entityResolution/types'
import type { GraphConversation, CognitiveProperties, EntityProperties, TopicProperties, GoalProperties } from '../graph/types'

// ============================================================================
// Graph store types — no serialization needed, stores return plain objects
// ============================================================================

type ExportedMemory = { id: string } & CognitiveProperties
type ExportedEntity = { id: string } & EntityProperties
type ExportedTopic = { id: string } & TopicProperties
type ExportedGoal = { id: string } & GoalProperties

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
  memories: ExportedMemory[]
  conversations: GraphConversation[]
  entities: ExportedEntity[]
  topics: ExportedTopic[]
  goals: ExportedGoal[]
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
    push(`  Mentions: ${t.mentionCount}  (${fmtDate(t.firstMentioned)} → ${fmtDate(t.lastMentioned)})`)
  }

  // ── Memories ──
  divider('MEMORIES', data.memories.length)
  for (const m of data.memories) {
    push(`\n• [${m.type}/${m.state}] ${m.content}`)
    if (m.subject) push(`  Subject: ${m.subject}`)
    const parts: string[] = []
    if (m.confidence != null) parts.push(`conf: ${m.confidence}`)
    if (m.importance != null) parts.push(`imp: ${m.importance}`)
    if (m.origin) parts.push(`origin: ${m.origin}`)
    if (m.reinforceCount > 0) parts.push(`reinforced: ${m.reinforceCount}x`)
    if (parts.length) push(`  ${parts.join(' | ')}`)
    push(`  Last reinforced: ${fmtDate(m.lastReinforced)}`)
    if (m.supersededBy) push(`  Superseded by: ${memoryMap.get(m.supersededBy) ?? m.supersededBy}`)
    if (m.contradictedBy?.length) push(`  Contradicted by: ${m.contradictedBy.map((id: string) => memoryMap.get(id) ?? id).join(', ')}`)
  }

  // ── Goals ──
  divider('GOALS', data.goals.length)
  for (const g of data.goals) {
    push(`\n• [${g.status}] ${g.statement}  (${g.progress}%)`)
    if (g.type) push(`  Type: ${g.type}`)
    if (g.entityIds.length) push(`  Entities: ${resolveIds(g.entityIds, entityMap)}`)
    if (g.topicIds.length) push(`  Topics: ${resolveIds(g.topicIds, topicMap)}`)
  }

  // ── Conversations ──
  divider('CONVERSATIONS', data.conversations.length)
  let lastSession = ''
  for (const c of data.conversations) {
    if (c.session_id !== lastSession) {
      push(`\n  ── Session: ${c.session_id.slice(0, 8)} ──`)
      lastSession = c.session_id
    }
    push(`  [${fmtDateTime(c.timestamp)}] (${c.speaker}/${c.source}) ${c.raw_text}`)
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

  // Entity resolution utilities
  mergeEntities: (targetIdOrName: string, sourceIdOrName: string, newName?: string) => Promise<MergeResult | null>
  renameEntity: (idOrName: string, newName: string) => Promise<void>

  // Data export (dev only) — returns data
  exportMemories: () => Promise<ExportedMemory[]>
  exportConversations: (limit?: number) => Promise<GraphConversation[]>
  exportEntities: () => Promise<ExportedEntity[]>
  exportTopics: () => Promise<ExportedTopic[]>
  exportGoals: () => Promise<ExportedGoal[]>
  exportAll: () => Promise<ExportData>
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
    dataStore.resetOnboarding()
    console.log('[ramble] Onboarding reset to initial state')
  },

  async getOnboardingStatus() {
    const status = dataStore.getOnboarding()
    console.log('[ramble] Onboarding status:', status)
    return status
  },

  // ============================================================================
  // User Profile
  // ============================================================================

  async getUserProfile() {
    const profile = dataStore.getUserProfile()
    console.log('[ramble] User profile:', profile)
    return profile
  },

  async clearUserProfile() {
    dataStore.delete('user_profile')
    console.log('[ramble] User profile cleared')
  },

  // ============================================================================
  // Combined (Profile-specific only - does NOT touch global settings/API keys)
  // ============================================================================

  async clearOnboardingData() {
    dataStore.resetOnboarding()
    dataStore.delete('user_profile')
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
    const data = dataStore.getValue(key)
    console.log(`[ramble] Data[${key}]:`, data)
    return data
  },

  async setData(key: string, type: string, value: unknown) {
    dataStore.set(key, type as 'custom', value)
    console.log(`[ramble] Data[${key}] set`)
  },

  async deleteData(key: string) {
    const result = dataStore.delete(key)
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
  // Entity Resolution Utilities
  // ============================================================================

  async mergeEntities(targetIdOrName: string, sourceIdOrName: string, newName?: string) {
    const store = await getEntityStore()

    // Resolve names to IDs
    const resolveId = async (idOrName: string): Promise<{ id: string; name: string } | null> => {
      // Try as ID first
      const byId = await store.getById(idOrName)
      if (byId) return { id: byId.id, name: byId.name }
      // Try as name
      const byName = await store.getByName(idOrName)
      if (byName) return { id: byName.id, name: byName.name }
      // Try case-insensitive search
      const all = await store.getAll()
      const match = all.find(e => e.name.toLowerCase() === idOrName.toLowerCase())
      if (match) return { id: match.id, name: match.name }
      return null
    }

    const target = await resolveId(targetIdOrName)
    if (!target) {
      console.error(`[ramble] Target entity not found: "${targetIdOrName}"`)
      return null
    }
    const source = await resolveId(sourceIdOrName)
    if (!source) {
      console.error(`[ramble] Source entity not found: "${sourceIdOrName}"`)
      return null
    }
    if (target.id === source.id) {
      console.error(`[ramble] Cannot merge entity with itself: "${target.name}"`)
      return null
    }

    console.log(`[ramble] Merging "${source.name}" → "${target.name}"${newName ? ` (rename to "${newName}")` : ''}`)
    const result = await fullEntityMerge(target.id, source.id, newName)
    console.log(`[ramble] Merge complete:`, result)
    return result
  },

  async renameEntity(idOrName: string, newName: string) {
    const store = await getEntityStore()

    // Resolve name to ID
    const byId = await store.getById(idOrName)
    if (byId) {
      await renameEntityFn(byId.id, newName)
      console.log(`[ramble] Renamed "${byId.name}" → "${newName}"`)
      return
    }
    const byName = await store.getByName(idOrName)
    if (byName) {
      await renameEntityFn(byName.id, newName)
      console.log(`[ramble] Renamed "${byName.name}" → "${newName}"`)
      return
    }
    // Case-insensitive fallback
    const all = await store.getAll()
    const match = all.find(e => e.name.toLowerCase() === idOrName.toLowerCase())
    if (match) {
      await renameEntityFn(match.id, newName)
      console.log(`[ramble] Renamed "${match.name}" → "${newName}"`)
      return
    }
    console.error(`[ramble] Entity not found: "${idOrName}"`)
  },

  // ============================================================================
  // Data Export (dev only) — graph stores return plain objects, no serialization
  // ============================================================================

  async exportMemories() {
    const store = await getMemoryStore()
    const all = await store.getAll()
    console.log(`[ramble] Exported ${all.length} memories`)
    return all
  },

  async exportConversations(limit = 500) {
    const all = await conversationStore.getRecent(limit)
    console.log(`[ramble] Exported ${all.length} conversations`)
    return all
  },

  async exportEntities() {
    const store = await getEntityStore()
    const all = await store.getAll()
    console.log(`[ramble] Exported ${all.length} entities`)
    return all
  },

  async exportTopics() {
    const store = await getTopicStore()
    const all = await store.getAll()
    console.log(`[ramble] Exported ${all.length} topics`)
    return all
  },

  async exportGoals() {
    const store = await getGoalStore()
    const all = await store.getAll()
    console.log(`[ramble] Exported ${all.length} goals`)
    return all
  },

  async exportAll() {
    const [memories, conversations, entities, topics, goals] = await Promise.all([
      this.exportMemories(),
      this.exportConversations(),
      this.exportEntities(),
      this.exportTopics(),
      this.exportGoals(),
    ])
    const data: ExportData = {
      exportedAt: new Date().toISOString(),
      memories,
      conversations,
      entities,
      topics,
      goals,
    }
    console.log('[ramble] Full export ready:', {
      memories: memories.length,
      conversations: conversations.length,
      entities: entities.length,
      topics: topics.length,
      goals: goals.length,
    })
    return data
  },

  async exportAllText() {
    const data = await this.exportAll() as ExportData
    const text = buildTextExport(data)
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
  mergeEntities:
    `Merge two entities into one, relinking ALL references across the graph DB.
Source entity is deleted after merge. Optional third argument renames the target.
Accepts entity IDs or names (case-insensitive lookup).
Params: targetIdOrName: string, sourceIdOrName: string, newName?: string
Returns: Promise<MergeResult | null> — counts of relinked records per table
Example: mergeEntities("Pravin", "Praveen")
Example: mergeEntities("CFR21", "CFR 21", "CFR 21")`,

  renameEntity:
    `Rename an entity. Old name is preserved as an alias for future matching.
Accepts entity ID or name (case-insensitive lookup).
Params: idOrName: string, newName: string
Returns: Promise<void>
Example: renameEntity("CFR21", "CFR 21")`,

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
API keys, settings, and all graph DB data (memories, conversations, etc.) are untouched.
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
    `DESTRUCTIVE — deletes every IndexedDB database (all profiles, all data) then reloads the page after 500ms.
There is no undo. All memories, conversations, entities, topics, goals, and data store entries are gone.
Params: none | Returns: Promise<void> (page reloads)`,

  getData:
    `Reads a single value from the generic key-value data store.
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
    `Returns the workspace store snapshot from localStorage.
Includes the active workspace ID and the full array of workspaces, each with id, name, layout tree, icon, theme, order, etc.
Params: none | Returns: { activeId: string, workspaces: Workspace[] }`,

  exportMemories:
    `Fetches all memories from the graph DB as plain objects.
Each memory has: id, content, type (fact|belief|goal|concern|preference|...), state (provisional|stable|contested|superseded), subject, confidence (0-1), importance (0-1), origin (speech|typed|meeting|pasted|document), reinforceCount, supersededBy, contradictedBy[], sourceConversationIds[], etc.
Params: none | Returns: Promise<ExportedMemory[]>`,

  exportConversations:
    `Fetches recent conversations ordered by timestamp descending.
Each entry is one speech/text turn: raw_text, speaker (user|agent), source (speech|typed|pasted|document|meeting), session_id to group turns.
Params: limit?: number (default 500) | Returns: Promise<GraphConversation[]>`,

  exportEntities:
    `Fetches all known entities (people, orgs, places, projects, concepts, etc.).
Each entity has: id, name, type, aliases[] (already parsed), description, mentionCount, firstMentioned/lastMentioned timestamps.
Params: none | Returns: Promise<ExportedEntity[]>`,

  exportTopics:
    `Fetches all topics (recurring themes/subjects across conversations).
Each topic has: id, name, category (work|personal|health|...), mentionCount, firstMentioned/lastMentioned timestamps.
Params: none | Returns: Promise<ExportedTopic[]>`,

  exportGoals:
    `Fetches all goals (active, achieved, abandoned).
Each goal has: id, statement, type, status, progress (0-100), entityIds[], topicIds[].
Params: none | Returns: Promise<ExportedGoal[]>`,

  exportAll:
    `Fetches everything in parallel and returns a single JSON-friendly object.
Shape: { exportedAt, memories, conversations, entities, topics, goals }
All fields are already plain objects/arrays — no JSON string parsing needed.
IDs are raw — use exportAllText() if you want names instead.
Params: none | Returns: Promise<ExportData>`,

  exportAllText:
    `Human-readable text version of exportAll(). Builds lookup maps so every entityId, topicId, and memoryId is replaced with its actual name/content.
Output is a single formatted string with sections:
  ENTITIES — name [type], aliases, description, mention stats
  TOPICS — name [category], mention stats
  MEMORIES — [type/state] content, subject, confidence/importance/origin, reinforcement count, supersession & contradiction chains
  GOALS — [status] statement (progress%), entity & topic names
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
