/**
 * ReactiveGraphService — Writes + Event Emission
 *
 * Wraps GraphService methods, emitting graph events on every write.
 * This is the service that React components should use for mutations.
 *
 * Read-only queries can go through GraphService directly (no events needed).
 */

import type { GraphService } from '../GraphService'
import type { GraphNode, GraphEdge } from '../types'
import { graphEventBus } from '../events'

export class ReactiveGraphService {
  private graph: GraphService

  constructor(graph: GraphService) {
    this.graph = graph
  }

  // ==========================================================================
  // Passthrough reads (no events needed)
  // ==========================================================================

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.graph.query<T>(sql, params)
  }

  getNode(id: string): Promise<GraphNode | null> {
    return this.graph.getNode(id)
  }

  getEdges(nodeId: string, type?: string, direction?: 'outgoing' | 'incoming' | 'both'): Promise<GraphEdge[]> {
    return this.graph.getEdges(nodeId, type, direction)
  }

  findNodesByLabel(label: string, branchId?: string): Promise<GraphNode[]> {
    return this.graph.findNodesByLabel(label, branchId)
  }

  exportBytes(): Promise<Uint8Array> {
    return this.graph.exportBytes()
  }

  // ==========================================================================
  // Reactive writes (emit events)
  // ==========================================================================

  async createNode(params: Parameters<GraphService['createNode']>[0]): Promise<GraphNode> {
    const node = await this.graph.createNode(params)
    graphEventBus.emit('graph:node:created', { node })
    graphEventBus.emitTableChange(['nodes'])
    return node
  }

  async updateNode(id: string, updates: Parameters<GraphService['updateNode']>[1]): Promise<void> {
    await this.graph.updateNode(id, updates)
    graphEventBus.emit('graph:node:updated', { nodeId: id, updates: updates as Partial<GraphNode> })
    graphEventBus.emitTableChange(['nodes'])
  }

  async deleteNode(id: string): Promise<void> {
    await this.graph.deleteNode(id)
    graphEventBus.emit('graph:node:deleted', { nodeId: id })
    graphEventBus.emitTableChange(['nodes', 'edges'])
  }

  async createEdge(params: Parameters<GraphService['createEdge']>[0]): Promise<GraphEdge> {
    const edge = await this.graph.createEdge(params)
    graphEventBus.emit('graph:edge:created', { edge })
    graphEventBus.emitTableChange(['edges'])
    return edge
  }

  async updateEdge(id: string, updates: Parameters<GraphService['updateEdge']>[1]): Promise<void> {
    await this.graph.updateEdge(id, updates)
    graphEventBus.emit('graph:edge:updated', { edgeId: id, updates: updates as Partial<GraphEdge> })
    graphEventBus.emitTableChange(['edges'])
  }

  async deleteEdge(id: string): Promise<void> {
    await this.graph.deleteEdge(id)
    graphEventBus.emit('graph:edge:deleted', { edgeId: id })
    graphEventBus.emitTableChange(['edges'])
  }

  // ==========================================================================
  // Batch operations (grouped events)
  // ==========================================================================

  async exec(sql: string, params?: unknown[]): Promise<void> {
    await this.graph.exec(sql, params)
  }

  async batch(statements: Array<{ sql: string; params?: unknown[] }>): Promise<void> {
    await this.graph.batch(statements)
  }

  /**
   * Execute multiple reactive writes in a single batch.
   * All mutations inside the callback are grouped into one tables:changed event.
   */
  async batchMutations(fn: () => Promise<void>): Promise<void> {
    await graphEventBus.batch(fn)
  }
}
