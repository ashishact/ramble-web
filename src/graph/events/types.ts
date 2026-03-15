/**
 * Graph Event Types
 *
 * Centralized type definitions for all graph mutation events.
 * These are emitted by ReactiveGraphService on every write operation.
 */

import type { GraphNode, GraphEdge } from '../types'

// ============================================================================
// Graph Mutation Events
// ============================================================================

export interface GraphEventPayloads {
  // Node lifecycle
  'graph:node:created': { node: GraphNode }
  'graph:node:updated': { nodeId: string; updates: Partial<GraphNode> }
  'graph:node:deleted': { nodeId: string }

  // Edge lifecycle
  'graph:edge:created': { edge: GraphEdge }
  'graph:edge:updated': { edgeId: string; updates: Partial<GraphEdge> }
  'graph:edge:deleted': { edgeId: string }

  // Table change notifications (for reactive queries)
  // Emitted after one or more mutations, with the affected table names.
  // Batched: multiple mutations in a batch() call produce one event.
  'graph:tables:changed': { tables: string[] }
}

export type GraphEventName = keyof GraphEventPayloads

// ============================================================================
// Combined Event Payloads (graph + legacy)
// ============================================================================

// Re-export so consumers can import from one place
export type { GraphEventPayloads as EventPayloads }

// Handler type
export type GraphEventHandler<K extends GraphEventName = GraphEventName> =
  (payload: GraphEventPayloads[K]) => void
