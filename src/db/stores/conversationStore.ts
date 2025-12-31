import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Conversation, { type ConversationSource, type Speaker } from '../models/Conversation'

const conversations = database.get<Conversation>('conversations')

export const conversationStore = {
  async create(data: {
    sessionId: string
    rawText: string
    sanitizedText?: string
    source: ConversationSource
    speaker: Speaker
  }): Promise<Conversation> {
    const now = Date.now()
    return await database.write(async () => {
      return await conversations.create((c) => {
        c.sessionId = data.sessionId
        c.timestamp = now
        c.rawText = data.rawText
        c.sanitizedText = data.sanitizedText ?? data.rawText
        c.source = data.source
        c.speaker = data.speaker
        c.processed = false
        c.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<Conversation | null> {
    try {
      return await conversations.find(id)
    } catch {
      return null
    }
  },

  async getBySession(sessionId: string): Promise<Conversation[]> {
    if (!sessionId) {
      console.warn('getBySession called with empty sessionId')
      return []
    }
    return await conversations
      .query(
        Q.where('sessionId', sessionId),
        Q.sortBy('timestamp', Q.asc)
      )
      .fetch()
  },

  async getUnprocessed(limit = 10): Promise<Conversation[]> {
    return await conversations
      .query(
        Q.where('processed', false),
        Q.sortBy('createdAt', Q.asc),
        Q.take(limit)
      )
      .fetch()
  },

  async getRecent(limit = 50): Promise<Conversation[]> {
    return await conversations
      .query(Q.sortBy('timestamp', Q.desc), Q.take(limit))
      .fetch()
  },

  async markProcessed(id: string): Promise<void> {
    try {
      const conv = await conversations.find(id)
      await database.write(async () => {
        await conv.update((c) => {
          c.processed = true
        })
      })
    } catch {
      // Not found
    }
  },

  async updateSanitizedText(id: string, sanitizedText: string): Promise<void> {
    try {
      const conv = await conversations.find(id)
      await database.write(async () => {
        await conv.update((c) => {
          c.sanitizedText = sanitizedText
        })
      })
    } catch {
      // Not found
    }
  },

  async search(query: string, limit = 20): Promise<Conversation[]> {
    // Simple text search - WatermelonDB doesn't have full-text search
    // For production, consider SQLite FTS or external search
    const all = await conversations
      .query(Q.sortBy('timestamp', Q.desc), Q.take(500))
      .fetch()

    const lowerQuery = query.toLowerCase()
    return all
      .filter(c => c.sanitizedText.toLowerCase().includes(lowerQuery))
      .slice(0, limit)
  },

  /**
   * Mark all unprocessed conversations as processed
   * Useful for recovery from errors
   */
  async markAllProcessed(): Promise<number> {
    const unprocessed = await this.getUnprocessed(100)
    for (const conv of unprocessed) {
      await this.markProcessed(conv.id)
    }
    return unprocessed.length
  },
}

// Expose for debugging in browser console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).fixStuckConversations = async () => {
    const count = await conversationStore.markAllProcessed()
    console.log(`Fixed ${count} stuck conversations`)
    return count
  }

  (window as unknown as Record<string, unknown>).debugStuckConversations = async () => {
    const unprocessed = await conversationStore.getUnprocessed(100)
    console.log('Unprocessed conversations:', unprocessed.length)
    for (const c of unprocessed) {
      console.log(`  - ${c.id}:`)
      console.log(`    sessionId: "${c.sessionId}" (type: ${typeof c.sessionId})`)
      console.log(`    source: "${c.source}"`)
      console.log(`    text: "${c.sanitizedText.slice(0, 50)}..."`)
    }
    return unprocessed
  }
}
