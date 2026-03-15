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
      recording_id: input.recordingId ?? null,
      batch_id: input.batchId ?? null,
      created_at: now,
    }

    await graph.exec(
      `INSERT INTO conversations (id, session_id, timestamp, raw_text, source, speaker, processed, intent, recording_id, batch_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        conv.id,
        conv.session_id,
        conv.timestamp,
        conv.raw_text,
        conv.source,
        conv.speaker,
        conv.processed,
        conv.intent,
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

}
