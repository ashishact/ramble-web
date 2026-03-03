/**
 * Debug Utilities - window.ramble object for testing and debugging
 *
 * Provides convenient functions accessible from browser console:
 *   window.ramble.resetOnboarding()
 *   window.ramble.getUserProfile()
 *   window.ramble.clearAllData()
 *
 * Data export (dev only):
 *   window.ramble.exportMemories()       → JSON of all memories
 *   window.ramble.exportConversations()   → JSON of all conversations
 *   window.ramble.exportEntities()        → JSON of all entities
 *   window.ramble.exportTopics()          → JSON of all topics
 *   window.ramble.exportGoals()           → JSON of all goals
 *   window.ramble.exportAll()             → combined JSON of everything
 *   window.ramble.copyAll()              → copies full export to clipboard
 */

import { dataStore } from '../db/stores/dataStore'
import { settingsHelpers } from '../stores/settingsStore'
import {
  memoryStore,
  entityStore,
  topicStore,
  goalStore,
  conversationStore,
} from '../db/stores'

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

/** Copy JSON string to clipboard */
async function copyToClipboard(data: unknown, label: string) {
  const json = JSON.stringify(data, null, 2)
  await navigator.clipboard.writeText(json)
  console.log(`[ramble] ${label} copied to clipboard (${json.length} chars)`)
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

  // Data export (dev only) — returns data and copies to clipboard
  exportMemories: () => Promise<unknown[]>
  exportConversations: (limit?: number) => Promise<unknown[]>
  exportEntities: () => Promise<unknown[]>
  exportTopics: () => Promise<unknown[]>
  exportGoals: () => Promise<unknown[]>
  exportAll: () => Promise<Record<string, unknown>>
  copyAll: () => Promise<void>
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

  async exportAll() {
    const [memories, conversations, entities, topics, goals] = await Promise.all([
      this.exportMemories(),
      this.exportConversations(),
      this.exportEntities(),
      this.exportTopics(),
      this.exportGoals(),
    ])
    const data = {
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

  async copyAll() {
    const data = await this.exportAll()
    await copyToClipboard(data, 'Full export')
  },
}

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
