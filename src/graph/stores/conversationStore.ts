/**
 * ConversationStore — DuckDB-backed conversation storage
 *
 * Lazy-initialized via getGraphService(). Emits graph events on writes
 * so reactive hooks (useConversationData) re-query automatically.
 */

import { getGraphService } from '../index'
import { graphEventBus } from '../events'
import type { GraphConversation } from '../types'

async function getGraph() {
  return getGraphService()
}

function emitChange() {
  graphEventBus.emitTableChange(['conversations'])
}

export const conversationStore = {
  async create(input: {
    sessionId: string
    rawText: string
    source: string
    speaker?: string
    intent?: string
    topic?: string
    recordingId?: string | null
    batchId?: string
  }): Promise<GraphConversation> {
    const graph = await getGraph()
    const now = Date.now()
    const id = crypto.randomUUID()
    const conv: GraphConversation = {
      id,
      session_id: input.sessionId,
      timestamp: now,
      raw_text: input.rawText,
      source: input.source,
      speaker: input.speaker ?? 'user',
      processed: false,
      intent: input.intent ?? null,
      topic: input.topic ?? null,
      recording_id: input.recordingId ?? null,
      batch_id: input.batchId ?? null,
      created_at: now,
    }

    await graph.exec(
      `INSERT INTO conversations (id, session_id, timestamp, raw_text, source, speaker, processed, intent, topic, recording_id, batch_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        conv.id,
        conv.session_id,
        conv.timestamp,
        conv.raw_text,
        conv.source,
        conv.speaker,
        conv.processed,
        conv.intent,
        conv.topic,
        conv.recording_id,
        conv.batch_id,
        conv.created_at,
      ]
    )

    emitChange()
    return conv
  },

  async getRecent(limit = 50): Promise<GraphConversation[]> {
    const graph = await getGraph()
    return graph.query<GraphConversation>(
      `SELECT * FROM conversations ORDER BY created_at DESC LIMIT $1`,
      [limit]
    )
  },

  async getUnprocessed(limit = 100): Promise<GraphConversation[]> {
    const graph = await getGraph()
    return graph.query<GraphConversation>(
      `SELECT * FROM conversations WHERE processed = false ORDER BY created_at ASC LIMIT $1`,
      [limit]
    )
  },

  async markProcessed(id: string, batchId?: string): Promise<void> {
    const graph = await getGraph()
    if (batchId) {
      await graph.exec(
        `UPDATE conversations SET processed = true, batch_id = $1 WHERE id = $2`,
        [batchId, id]
      )
    } else {
      await graph.exec(
        `UPDATE conversations SET processed = true WHERE id = $1`,
        [id]
      )
    }
    emitChange()
  },

  async getById(id: string): Promise<GraphConversation | null> {
    const graph = await getGraph()
    const rows = await graph.query<GraphConversation>(
      `SELECT * FROM conversations WHERE id = $1`,
      [id]
    )
    return rows[0] ?? null
  },

  async getPendingBatch(batchId: string): Promise<GraphConversation[]> {
    const graph = await getGraph()
    return graph.query<GraphConversation>(
      `SELECT * FROM conversations WHERE batch_id = $1 ORDER BY created_at ASC`,
      [batchId]
    )
  },

  async getByRecording(recordingId: string): Promise<GraphConversation[]> {
    const graph = await getGraph()
    return graph.query<GraphConversation>(
      `SELECT * FROM conversations WHERE recording_id = $1 ORDER BY created_at ASC`,
      [recordingId]
    )
  },

  /**
   * Get daily conversation counts for the activity heatmap.
   * Only counts user speech with non-trivial text (matches getByTimeRange filter).
   * @param sinceMs — epoch ms lower bound (defaults to last 90 days)
   */
  async getDailyCounts(sinceMs?: number): Promise<Array<{ day: string; count: number }>> {
    const graph = await getGraph()
    const since = sinceMs ?? (Date.now() - 90 * 24 * 60 * 60 * 1000)
    return graph.query<{ day: string; count: number }>(
      `SELECT
        CAST(DATE_TRUNC('day', to_timestamp(created_at / 1000)) AS VARCHAR) AS day,
        COUNT(*) AS count
      FROM conversations
      WHERE speaker = 'user'
        AND length(trim(raw_text)) > 5
        AND created_at >= $1
      GROUP BY day
      ORDER BY day`,
      [since]
    )
  },

  /**
   * Get aggregate stats for a specific day (YYYY-MM-DD).
   * Counts conversations, entities, goals, memories, and topics created that day.
   */
  async getDayStats(dayStr: string): Promise<{
    conversations: number
    entities: number
    goals: number
    memories: number
    topics: number
  }> {
    const graph = await getGraph()
    const dayStart = new Date(dayStr + 'T00:00:00').getTime()
    const dayEnd = dayStart + 24 * 60 * 60 * 1000
    const rows = await graph.query<{
      conversations: number
      entities: number
      goals: number
      memories: number
      topics: number
    }>(
      `SELECT
        (SELECT COUNT(*) FROM conversations
         WHERE speaker = 'user' AND length(trim(raw_text)) > 5
           AND created_at >= $1 AND created_at < $2) AS conversations,
        (SELECT COUNT(*) FROM nodes
         WHERE list_contains(labels, 'entity')
           AND created_at >= $1 AND created_at < $2) AS entities,
        (SELECT COUNT(*) FROM nodes
         WHERE list_contains(labels, 'goal')
           AND created_at >= $1 AND created_at < $2) AS goals,
        (SELECT COUNT(*) FROM nodes
         WHERE list_contains(labels, 'memory')
           AND created_at >= $1 AND created_at < $2) AS memories,
        (SELECT COUNT(*) FROM nodes
         WHERE list_contains(labels, 'topic')
           AND created_at >= $1 AND created_at < $2) AS topics`,
      [dayStart, dayEnd]
    )
    return rows[0] ?? { conversations: 0, entities: 0, goals: 0, memories: 0, topics: 0 }
  },

  /**
   * Get unique non-null topics from SYS-I conversations since a given timestamp.
   * Used by Knowledge Map to reconstruct live coverage on mount.
   */
  async getUniqueTopicsSince(sinceMs: number): Promise<string[]> {
    const graph = await getGraph()
    const rows = await graph.query<{ topic: string }>(
      `SELECT DISTINCT topic FROM conversations
       WHERE topic IS NOT NULL
         AND topic != 'general'
         AND speaker = 'sys1'
         AND created_at >= $1
       ORDER BY topic`,
      [sinceMs]
    )
    return rows.map(r => r.topic)
  },

  /**
   * Get user conversations within a time range (for SYS-II period extraction).
   * Only returns speaker='user' entries with non-trivial text.
   */
  async getByTimeRange(startMs: number, endMs: number): Promise<GraphConversation[]> {
    const graph = await getGraph()
    return graph.query<GraphConversation>(
      `SELECT * FROM conversations
       WHERE created_at >= $1 AND created_at < $2
         AND speaker = 'user'
         AND length(trim(raw_text)) > 5
       ORDER BY created_at ASC`,
      [startMs, endMs]
    )
  },

}
