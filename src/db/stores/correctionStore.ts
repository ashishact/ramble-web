import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Correction from '../models/Correction'

const corrections = database.get<Correction>('corrections')

export const correctionStore = {
  async create(data: {
    wrongText: string
    correctText: string
    originalCase?: string
    sourceConversationId?: string
  }): Promise<Correction> {
    const now = Date.now()
    return await database.write(async () => {
      return await corrections.create((c) => {
        c.wrongText = data.wrongText.toLowerCase()
        c.correctText = data.correctText
        c.originalCase = data.originalCase ?? data.correctText
        c.usageCount = 0
        c.createdAt = now
        c.sourceConversationId = data.sourceConversationId
      })
    })
  },

  async getById(id: string): Promise<Correction | null> {
    try {
      return await corrections.find(id)
    } catch {
      return null
    }
  },

  async getByWrongText(wrongText: string): Promise<Correction | null> {
    const results = await corrections
      .query(Q.where('wrongText', wrongText.toLowerCase()), Q.take(1))
      .fetch()
    return results[0] ?? null
  },

  async getAll(): Promise<Correction[]> {
    return await corrections.query(Q.sortBy('usageCount', Q.desc)).fetch()
  },

  async getMostUsed(limit = 20): Promise<Correction[]> {
    return await corrections
      .query(Q.sortBy('usageCount', Q.desc), Q.take(limit))
      .fetch()
  },

  async getRecent(limit = 20): Promise<Correction[]> {
    return await corrections
      .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
      .fetch()
  },

  async recordUsage(id: string): Promise<void> {
    try {
      const correction = await corrections.find(id)
      await database.write(async () => {
        await correction.update((c) => {
          c.usageCount += 1
          c.lastUsed = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },

  async update(id: string, data: {
    correctText?: string
    originalCase?: string
  }): Promise<Correction | null> {
    try {
      const correction = await corrections.find(id)
      await database.write(async () => {
        await correction.update((c) => {
          if (data.correctText !== undefined) c.correctText = data.correctText
          if (data.originalCase !== undefined) c.originalCase = data.originalCase
        })
      })
      return correction
    } catch {
      return null
    }
  },

  async delete(id: string): Promise<boolean> {
    try {
      const correction = await corrections.find(id)
      await database.write(async () => {
        await correction.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },

  async applyCorrections(text: string): Promise<{
    corrected: string
    applied: Array<{ from: string; to: string }>
  }> {
    const all = await this.getAll()
    let corrected = text
    const applied: Array<{ from: string; to: string }> = []

    for (const c of all) {
      const regex = new RegExp(`\\b${c.wrongText}\\b`, 'gi')
      if (regex.test(corrected)) {
        corrected = corrected.replace(regex, c.correctText)
        applied.push({ from: c.wrongText, to: c.correctText })
        await this.recordUsage(c.id)
      }
    }

    return { corrected, applied }
  },

  async findOrCreate(wrongText: string, correctText: string): Promise<Correction> {
    const existing = await this.getByWrongText(wrongText)
    if (existing) {
      return existing
    }
    return await this.create({ wrongText, correctText })
  },
}
