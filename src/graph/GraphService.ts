/**
 * GraphService — Singleton Main-Thread DuckDB Proxy
 *
 * Sends typed RPC messages to the DuckDB Web Worker and returns Promises.
 * All database operations are non-blocking from the UI thread's perspective.
 *
 * Usage:
 *   const graph = await GraphService.getInstance()
 *   await graph.createNode({ ... })
 *
 * Only one instance exists per profile. Multiple concurrent callers
 * share the same init promise — only one worker is ever created.
 */

import type {
  GraphNode,
  GraphEdge,
  WorkerRequest,
  WorkerResponse,
} from './types'

// DuckDB WASM prepared statements can't bind JS arrays to VARCHAR[]/FLOAT[] columns.
// We inline array literals in SQL with proper escaping instead.
function toSqlArray(arr: string[]): string {
  const escaped = arr.map(s => `'${s.replace(/'/g, "''")}'`)
  return `[${escaped.join(', ')}]`
}

export class GraphService {
  // ── Singleton ───────────────────────────────────────────────────────────
  private static instance: GraphService | null = null
  private static currentProfile: string | null = null
  private static initPromise: Promise<GraphService> | null = null

  static async getInstance(profileName = 'default'): Promise<GraphService> {
    // Fast path — already initialized for this profile
    if (GraphService.instance && GraphService.currentProfile === profileName) {
      return GraphService.instance
    }

    // Profile changed — close old instance
    if (GraphService.instance && GraphService.currentProfile !== profileName) {
      await GraphService.instance.close()
      GraphService.instance = null
      GraphService.currentProfile = null
      GraphService.initPromise = null
    }

    // All concurrent callers share one init promise — only one worker created
    if (!GraphService.initPromise) {
      GraphService.initPromise = (async () => {
        const svc = new GraphService(profileName)
        try {
          await svc.init()
        } catch (err) {
          GraphService.initPromise = null
          console.error('[GraphService] Init failed:', err)
          throw err
        }
        GraphService.instance = svc
        GraphService.currentProfile = profileName
        return svc
      })()
    }

    return GraphService.initPromise
  }

  static async closeInstance(): Promise<void> {
    if (GraphService.instance) {
      await GraphService.instance.close()
      GraphService.instance = null
      GraphService.currentProfile = null
      GraphService.initPromise = null
    }
  }

  /** Synchronous kill — for beforeunload where we can't await. */
  static terminateNow(): void {
    if (GraphService.instance?.worker) {
      GraphService.instance.worker.terminate()
      GraphService.instance.worker = null
      GraphService.instance = null
      GraphService.currentProfile = null
      GraphService.initPromise = null
    }
  }

  // ── Instance ────────────────────────────────────────────────────────────
  private worker: Worker | null = null
  private requestId = 0
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private profileName: string

  private constructor(profileName: string) {
    this.profileName = profileName
  }

  private async init(): Promise<void> {
    this.worker = new Worker(
      new URL('./worker/duckdb.worker.ts', import.meta.url),
      { type: 'module' }
    )

    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const { id, type, payload } = event.data
      const handler = this.pending.get(id)
      if (!handler) return

      this.pending.delete(id)
      if (type === 'error') {
        handler.reject(new Error(payload as string))
      } else {
        handler.resolve(payload)
      }
    }

    this.worker.onerror = (event) => {
      console.error('[GraphService] Worker error:', event)
    }

    await this.send('init', { profileName: this.profileName })
  }

  private async close(): Promise<void> {
    if (!this.worker) return
    try {
      await this.send('close', {})
    } catch {
      // Worker may already be dead (HMR, tab close)
    }
    this.worker.terminate()
    this.worker = null
  }

  // ==========================================================================
  // Low-Level RPC
  // ==========================================================================

  private send(type: WorkerRequest['type'], payload: unknown): Promise<unknown> {
    if (!this.worker) throw new Error('GraphService not initialized')

    const id = ++this.requestId
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, type, payload } satisfies WorkerRequest)
    })
  }

  /** Execute a write SQL statement (INSERT, UPDATE, DELETE, DDL) */
  async exec(sql: string, params?: unknown[]): Promise<void> {
    await this.send('exec', { sql, params })
  }

  /** Execute a read SQL query, returns array of row objects */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return (await this.send('query', { sql, params })) as T[]
  }

  /** Execute multiple statements atomically in a transaction */
  async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.send('batch', { statements })
  }

  /** Export the entire database as a binary blob */
  async exportBytes(): Promise<Uint8Array> {
    return (await this.send('export', {})) as Uint8Array
  }

  // ==========================================================================
  // Node Operations
  // ==========================================================================

  async createNode(node: {
    id: string
    branchId?: string
    labels: string[]
    properties: Record<string, unknown>
    embedding?: Float32Array | null
  }): Promise<GraphNode> {
    const now = Date.now()
    const branchId = node.branchId ?? 'global'

    const labelsLiteral = toSqlArray(node.labels)
    const embeddingLiteral = node.embedding
      ? `[${Array.from(node.embedding).join(', ')}]::FLOAT[]`
      : 'NULL'

    await this.exec(
      `INSERT INTO nodes (id, branch_id, labels, properties, embedding, created_at, updated_at)
       VALUES ($1, $2, ${labelsLiteral}, $3, ${embeddingLiteral}, $4, $5)`,
      [
        node.id,
        branchId,
        JSON.stringify(node.properties),
        now,
        now,
      ]
    )

    return {
      id: node.id,
      branch_id: branchId,
      labels: node.labels,
      properties: node.properties,
      embedding: node.embedding ?? null,
      created_at: now,
      updated_at: now,
    }
  }

  async updateNode(
    id: string,
    updates: {
      labels?: string[]
      properties?: Record<string, unknown>
      embedding?: Float32Array | null
    }
  ): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let paramIndex = 1

    if (updates.labels !== undefined) {
      sets.push(`labels = ${toSqlArray(updates.labels)}`)
    }
    if (updates.properties !== undefined) {
      sets.push(`properties = $${paramIndex++}`)
      params.push(JSON.stringify(updates.properties))
    }
    if (updates.embedding !== undefined) {
      const embLiteral = updates.embedding
        ? `[${Array.from(updates.embedding).join(', ')}]::FLOAT[]`
        : 'NULL'
      sets.push(`embedding = ${embLiteral}`)
    }

    sets.push(`updated_at = $${paramIndex++}`)
    params.push(Date.now())

    params.push(id)

    await this.exec(
      `UPDATE nodes SET ${sets.join(', ')} WHERE id = $${paramIndex}`,
      params
    )
  }

  async deleteNode(id: string): Promise<void> {
    await this.batch([
      { sql: `DELETE FROM edges WHERE start_id = $1 OR end_id = $1`, params: [id] },
      { sql: `DELETE FROM nodes WHERE id = $1`, params: [id] },
    ])
  }

  async getNode(id: string): Promise<GraphNode | null> {
    const rows = await this.query<GraphNode>(
      `SELECT * FROM nodes WHERE id = $1`,
      [id]
    )
    return rows[0] ?? null
  }

  async findNodesByLabel(label: string, branchId?: string): Promise<GraphNode[]> {
    if (branchId) {
      return this.query<GraphNode>(
        `SELECT * FROM nodes WHERE list_contains(labels, $1) AND branch_id = $2 ORDER BY updated_at DESC`,
        [label, branchId]
      )
    }
    return this.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, $1) ORDER BY updated_at DESC`,
      [label]
    )
  }

  // ==========================================================================
  // Edge Operations
  // ==========================================================================

  async createEdge(edge: {
    id: string
    branchId?: string
    startId: string
    endId: string
    type: string
    properties?: Record<string, unknown>
  }): Promise<GraphEdge> {
    const now = Date.now()
    const branchId = edge.branchId ?? 'global'
    const properties = edge.properties ?? {}

    await this.exec(
      `INSERT INTO edges (id, branch_id, start_id, end_id, type, properties, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        edge.id,
        branchId,
        edge.startId,
        edge.endId,
        edge.type,
        JSON.stringify(properties),
        now,
        now,
      ]
    )

    return {
      id: edge.id,
      branch_id: branchId,
      start_id: edge.startId,
      end_id: edge.endId,
      type: edge.type,
      properties,
      created_at: now,
      updated_at: now,
    }
  }

  async updateEdge(
    id: string,
    updates: { properties?: Record<string, unknown> }
  ): Promise<void> {
    if (updates.properties !== undefined) {
      await this.exec(
        `UPDATE edges SET properties = $1, updated_at = $2 WHERE id = $3`,
        [JSON.stringify(updates.properties), Date.now(), id]
      )
    }
  }

  async deleteEdge(id: string): Promise<void> {
    await this.exec(`DELETE FROM edges WHERE id = $1`, [id])
  }

  async getEdges(
    nodeId: string,
    type?: string,
    direction?: 'outgoing' | 'incoming' | 'both'
  ): Promise<GraphEdge[]> {
    const dir = direction ?? 'both'
    let sql: string
    const params: unknown[] = []

    if (type) {
      switch (dir) {
        case 'outgoing':
          sql = `SELECT * FROM edges WHERE start_id = $1 AND type = $2`
          params.push(nodeId, type)
          break
        case 'incoming':
          sql = `SELECT * FROM edges WHERE end_id = $1 AND type = $2`
          params.push(nodeId, type)
          break
        default:
          sql = `SELECT * FROM edges WHERE (start_id = $1 OR end_id = $1) AND type = $2`
          params.push(nodeId, type)
      }
    } else {
      switch (dir) {
        case 'outgoing':
          sql = `SELECT * FROM edges WHERE start_id = $1`
          params.push(nodeId)
          break
        case 'incoming':
          sql = `SELECT * FROM edges WHERE end_id = $1`
          params.push(nodeId)
          break
        default:
          sql = `SELECT * FROM edges WHERE start_id = $1 OR end_id = $1`
          params.push(nodeId)
      }
    }

    return this.query<GraphEdge>(sql, params)
  }
}
