import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import ExtractionLog from '../models/ExtractionLog'

const extractionLogs = database.get<ExtractionLog>('extraction_logs')

export const extractionLogStore = {
  async create(data: {
    pluginId: string
    conversationId: string
    sessionId?: string
    inputText: string
    output: Record<string, unknown>
    llmPrompt?: string
    llmResponse?: string
    llmModel?: string
    tokensUsed?: number
    processingTimeMs: number
    success: boolean
    error?: string
  }): Promise<ExtractionLog> {
    const now = Date.now()
    return await database.write(async () => {
      return await extractionLogs.create((l) => {
        l.pluginId = data.pluginId
        l.conversationId = data.conversationId
        l.sessionId = data.sessionId
        l.inputText = data.inputText
        l.outputJson = JSON.stringify(data.output)
        l.llmPrompt = data.llmPrompt
        l.llmResponse = data.llmResponse
        l.llmModel = data.llmModel
        l.tokensUsed = data.tokensUsed
        l.processingTimeMs = data.processingTimeMs
        l.success = data.success
        l.error = data.error
        l.createdAt = now
      })
    })
  },

  async getById(id: string): Promise<ExtractionLog | null> {
    try {
      return await extractionLogs.find(id)
    } catch {
      return null
    }
  },

  async getByPlugin(pluginId: string, limit = 50): Promise<ExtractionLog[]> {
    return await extractionLogs
      .query(
        Q.where('pluginId', pluginId),
        Q.sortBy('createdAt', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async getByConversation(conversationId: string): Promise<ExtractionLog[]> {
    return await extractionLogs
      .query(
        Q.where('conversationId', conversationId),
        Q.sortBy('createdAt', Q.asc)
      )
      .fetch()
  },

  async getBySession(sessionId: string, limit = 100): Promise<ExtractionLog[]> {
    return await extractionLogs
      .query(
        Q.where('sessionId', sessionId),
        Q.sortBy('createdAt', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async getRecent(limit = 50): Promise<ExtractionLog[]> {
    return await extractionLogs
      .query(Q.sortBy('createdAt', Q.desc), Q.take(limit))
      .fetch()
  },

  async getErrors(limit = 50): Promise<ExtractionLog[]> {
    return await extractionLogs
      .query(
        Q.where('success', false),
        Q.sortBy('createdAt', Q.desc),
        Q.take(limit)
      )
      .fetch()
  },

  async getStats(): Promise<{
    totalRuns: number
    successCount: number
    errorCount: number
    avgProcessingTimeMs: number
    totalTokensUsed: number
  }> {
    const all = await extractionLogs.query().fetch()

    let successCount = 0
    let totalTime = 0
    let totalTokens = 0

    for (const log of all) {
      if (log.success) successCount++
      totalTime += log.processingTimeMs
      totalTokens += log.tokensUsed ?? 0
    }

    return {
      totalRuns: all.length,
      successCount,
      errorCount: all.length - successCount,
      avgProcessingTimeMs: all.length > 0 ? totalTime / all.length : 0,
      totalTokensUsed: totalTokens,
    }
  },

  async cleanup(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - olderThanMs
    const old = await extractionLogs
      .query(Q.where('createdAt', Q.lt(cutoff)))
      .fetch()

    await database.write(async () => {
      for (const log of old) {
        await log.destroyPermanently()
      }
    })

    return old.length
  },
}
