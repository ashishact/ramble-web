/**
 * Working Context Window — LRU + Relevance Decay
 *
 * Manages a fixed-size window of the most relevant graph entities
 * for the current LLM conversation. Replaces WorkingMemory.ts.
 *
 * Key behaviors:
 * - Fixed capacity (default 25 entities)
 * - Relevance boosting on mention/search (touch)
 * - Exponential decay over time (7-day half-life)
 * - LRU eviction when over capacity
 * - Topic shift detection (>50% new entities)
 * - Formatted context block for LLM prompts
 */

import type { GraphService } from '../GraphService'
import type { GraphNode } from '../types'

export interface ContextEntry {
  nodeId: string
  relevance: number
  lastAccessed: number
  addedAt: number
}

export interface WorkingContextConfig {
  maxSize: number
  halfLifeMs: number
}

const DEFAULT_CONFIG: WorkingContextConfig = {
  maxSize: 25,
  halfLifeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
}

export class WorkingContextWindow {
  private entries = new Map<string, ContextEntry>()
  private config: WorkingContextConfig
  private graph: GraphService

  constructor(graph: GraphService, config?: Partial<WorkingContextConfig>) {
    this.graph = graph
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  // ==========================================================================
  // Core Operations
  // ==========================================================================

  /**
   * Boost relevance of a node (on mention, search hit, etc.).
   * If not in window, add it. If over capacity, evict lowest.
   */
  touch(nodeId: string, boost = 0.3): void {
    const now = Date.now()
    const existing = this.entries.get(nodeId)

    if (existing) {
      existing.relevance = Math.min(1.0, existing.relevance + boost)
      existing.lastAccessed = now
    } else {
      this.entries.set(nodeId, {
        nodeId,
        relevance: Math.min(1.0, 0.5 + boost),
        lastAccessed: now,
        addedAt: now,
      })
    }

    this.evict()
  }

  /**
   * Apply exponential decay to all entries.
   * relevance = relevance * exp(-age / halfLife)
   */
  decay(): void {
    const now = Date.now()

    for (const [id, entry] of this.entries) {
      const ageMs = now - entry.lastAccessed
      const decayed = entry.relevance * Math.exp(-ageMs / this.config.halfLifeMs)

      if (decayed < 0.01) {
        this.entries.delete(id)
      } else {
        entry.relevance = decayed
      }
    }
  }

  /**
   * Remove lowest-relevance entries when over capacity.
   */
  private evict(): void {
    if (this.entries.size <= this.config.maxSize) return

    // Sort by relevance ascending, remove the lowest
    const sorted = Array.from(this.entries.entries())
      .sort((a, b) => a[1].relevance - b[1].relevance)

    const toRemove = sorted.slice(0, this.entries.size - this.config.maxSize)
    for (const [id] of toRemove) {
      this.entries.delete(id)
    }
  }

  // ==========================================================================
  // Context Building
  // ==========================================================================

  /**
   * Get a formatted context block for the LLM prompt.
   * Fetches node data from DuckDB and formats with relevance scores.
   *
   * Format:
   *   [relevance: 0.95] John Chen — CTO at Acme, works on Project Atlas
   *   [relevance: 0.72] Project Atlas — AI initiative, Q3 deadline
   */
  async getContextBlock(): Promise<string> {
    if (this.entries.size === 0) return '(no context)'

    // Decay before building context
    this.decay()

    // Fetch node data for all entries
    const nodeIds = Array.from(this.entries.keys())
    const nodes = await this.fetchNodes(nodeIds)

    // Sort by relevance descending
    const sorted = Array.from(this.entries.values())
      .sort((a, b) => b.relevance - a.relevance)

    const lines: string[] = []
    for (const entry of sorted) {
      const node = nodes.get(entry.nodeId)
      if (!node) continue

      const props = node.properties as Record<string, unknown>
      const name = (props.name as string) ?? entry.nodeId
      const description = (props.description as string) ?? (props.content as string) ?? ''
      const truncated = description.length > 100 ? description.slice(0, 100) + '...' : description

      lines.push(`[relevance: ${entry.relevance.toFixed(2)}] ${name}${truncated ? ' — ' + truncated : ''}`)
    }

    return lines.join('\n')
  }

  /**
   * Get all node IDs currently in the window, sorted by relevance descending.
   */
  getNodeIds(): string[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.relevance - a.relevance)
      .map(e => e.nodeId)
  }

  /**
   * Get entries with their relevance scores.
   */
  getEntries(): ContextEntry[] {
    return Array.from(this.entries.values())
      .sort((a, b) => b.relevance - a.relevance)
  }

  // ==========================================================================
  // Topic Shift Detection
  // ==========================================================================

  /**
   * Detect if the new set of entity IDs represents a topic shift.
   * A topic shift is when >50% of the new entities are not in the current window.
   */
  detectTopicShift(newEntityIds: string[]): boolean {
    if (newEntityIds.length === 0) return false
    if (this.entries.size === 0) return true

    const existingIds = new Set(this.entries.keys())
    const newCount = newEntityIds.filter(id => !existingIds.has(id)).length
    return newCount / newEntityIds.length > 0.5
  }

  /**
   * Refresh the window with new entity IDs.
   * Touches new entities with a boost, decays existing ones.
   */
  refresh(newEntityIds: string[]): void {
    // Decay everything first
    this.decay()

    // Touch new entities with strong boost
    for (const id of newEntityIds) {
      this.touch(id, 0.4)
    }
  }

  // ==========================================================================
  // Persistence
  // ==========================================================================

  /**
   * Save current window state to DuckDB's working_context table.
   */
  async persist(): Promise<void> {
    // Clear existing entries
    await this.graph.exec('DELETE FROM working_context')

    if (this.entries.size === 0) return

    const statements = Array.from(this.entries.values()).map(entry => ({
      sql: `INSERT INTO working_context (id, node_id, relevance, last_accessed, added_at)
            VALUES ($1, $2, $3, $4, $5)`,
      params: [
        `wc_${entry.nodeId}`,
        entry.nodeId,
        entry.relevance,
        entry.lastAccessed,
        entry.addedAt,
      ],
    }))

    await this.graph.batch(statements)
  }

  /**
   * Load window state from DuckDB's working_context table.
   */
  async restore(): Promise<void> {
    const rows = await this.graph.query<{
      node_id: string
      relevance: number
      last_accessed: number
      added_at: number
    }>('SELECT node_id, relevance, last_accessed, added_at FROM working_context')

    this.entries.clear()
    for (const row of rows) {
      this.entries.set(row.node_id, {
        nodeId: row.node_id,
        relevance: row.relevance,
        lastAccessed: row.last_accessed,
        addedAt: row.added_at,
      })
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  get size(): number {
    return this.entries.size
  }

  private async fetchNodes(ids: string[]): Promise<Map<string, GraphNode>> {
    if (ids.length === 0) return new Map()

    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE id IN (${placeholders})`,
      ids
    )

    const map = new Map<string, GraphNode>()
    for (const row of rows) {
      map.set(row.id, row)
    }
    return map
  }
}
