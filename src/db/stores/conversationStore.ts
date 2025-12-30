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
}
