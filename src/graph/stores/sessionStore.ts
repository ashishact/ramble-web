/**
 * SessionStore — DuckDB-backed sessions (simple key-value in nodes)
 */

import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'

let idCounter = 0
function generateId(): string { return `sess_${Date.now()}_${++idCounter}` }

export class SessionStore {
  private graph: ReactiveGraphService

  constructor(graph: ReactiveGraphService) {
    this.graph = graph
  }

  async create(): Promise<{ id: string; startedAt: number }> {
    const id = generateId()
    const now = Date.now()
    await this.graph.createNode({
      id,
      labels: ['session'],
      properties: { startedAt: now, endedAt: null, unitCount: 0, status: 'active' },
    })
    return { id, startedAt: now }
  }

  async getActive(): Promise<{ id: string } | null> {
    const rows = await this.graph.query<{ id: string }>(
      `SELECT id FROM nodes WHERE list_contains(labels, 'session')
       AND json_extract_string(properties, '$.status') = 'active'
       ORDER BY created_at DESC LIMIT 1`
    )
    return rows[0] ?? null
  }

  async endSession(id: string): Promise<void> {
    const node = await this.graph.getNode(id)
    if (!node) return
    await this.graph.updateNode(id, {
      properties: { ...node.properties, status: 'ended', endedAt: Date.now() },
    })
  }
}
