/**
 * Graph Mutations — Universal Create/Update/Delete
 *
 * A thin, type-safe API over ReactiveGraphService.
 * Every component uses the same pattern for writes:
 *
 *   import { graphMutations } from '@/graph/data'
 *
 *   await graphMutations.createNode(['entity', 'person'], { name: 'Alice', ... })
 *   await graphMutations.updateNode(id, { description: 'Updated' })
 *   await graphMutations.deleteNode(id)
 *
 * All mutations:
 * 1. Route through ReactiveGraphService (which emits events)
 * 2. Events trigger useGraphData/useGraphCounts re-queries automatically
 * 3. No widget needs to know about SQL, events, or subscriptions
 */

import { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import { getGraphService } from '../index'
import { graphEventBus } from '../events'
import type { GraphNode, GraphEdge } from '../types'

// ============================================================================
// Singleton ReactiveGraphService
// ============================================================================

let _reactive: ReactiveGraphService | null = null

async function getReactive(): Promise<ReactiveGraphService> {
  if (!_reactive) {
    const graph = await getGraphService()
    _reactive = new ReactiveGraphService(graph)
  }
  return _reactive
}

// ============================================================================
// Node Mutations
// ============================================================================

function generateId(): string {
  return crypto.randomUUID()
}

/**
 * Create a node with the given labels and properties.
 * Returns the created node.
 */
async function createNode(
  labels: string[],
  properties: Record<string, unknown>,
  id?: string
): Promise<GraphNode> {
  const reactive = await getReactive()
  return reactive.createNode({
    id: id ?? generateId(),
    labels,
    properties,
  })
}

/**
 * Update a node's properties (shallow merge into existing properties).
 * Pass the full properties object if you want to replace them entirely.
 */
async function updateNodeProperties(
  id: string,
  propertyUpdates: Record<string, unknown>
): Promise<void> {
  const reactive = await getReactive()

  // Read current properties, merge, then write back
  const node = await reactive.getNode(id)
  if (!node) throw new Error(`Node not found: ${id}`)

  const currentProps = node.properties ?? {}

  const merged = { ...currentProps, ...propertyUpdates }
  await reactive.updateNode(id, { properties: merged })
}

/**
 * Replace a node's properties entirely (no merge).
 */
async function setNodeProperties(
  id: string,
  properties: Record<string, unknown>
): Promise<void> {
  const reactive = await getReactive()
  await reactive.updateNode(id, { properties })
}

/**
 * Update a node's labels.
 */
async function updateNodeLabels(
  id: string,
  labels: string[]
): Promise<void> {
  const reactive = await getReactive()
  await reactive.updateNode(id, { labels })
}

/**
 * Delete a node and all its connected edges.
 */
async function deleteNode(id: string): Promise<void> {
  const reactive = await getReactive()
  await reactive.deleteNode(id)
}

/**
 * Get a single node by ID.
 */
async function getNode(id: string): Promise<GraphNode | null> {
  const reactive = await getReactive()
  return reactive.getNode(id)
}

// ============================================================================
// Edge Mutations
// ============================================================================

/**
 * Create an edge between two nodes.
 */
async function createEdge(
  startId: string,
  endId: string,
  type: string,
  properties?: Record<string, unknown>
): Promise<GraphEdge> {
  const reactive = await getReactive()
  return reactive.createEdge({
    id: generateId(),
    startId,
    endId,
    type,
    properties,
  })
}

/**
 * Update an edge's properties.
 */
async function updateEdgeProperties(
  id: string,
  properties: Record<string, unknown>
): Promise<void> {
  const reactive = await getReactive()
  await reactive.updateEdge(id, { properties })
}

/**
 * Delete an edge.
 */
async function deleteEdge(id: string): Promise<void> {
  const reactive = await getReactive()
  await reactive.deleteEdge(id)
}

/**
 * Get edges for a node.
 */
async function getEdges(
  nodeId: string,
  type?: string,
  direction?: 'outgoing' | 'incoming' | 'both'
): Promise<GraphEdge[]> {
  const reactive = await getReactive()
  return reactive.getEdges(nodeId, type, direction)
}

// ============================================================================
// Conversation Mutations
// ============================================================================

/**
 * Create a conversation record.
 */
async function createConversation(conv: {
  id?: string
  sessionId: string
  timestamp?: number
  rawText: string
  source: string
  speaker?: string
  intent?: string | null
  recordingId?: string | null
}): Promise<void> {
  const reactive = await getReactive()
  const id = conv.id ?? generateId()
  const now = Date.now()

  await reactive.exec(
    `INSERT INTO conversations (id, session_id, timestamp, raw_text, source, speaker, processed, intent, recording_id, batch_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      conv.sessionId,
      conv.timestamp ?? now,
      conv.rawText,
      conv.source,
      conv.speaker ?? 'user',
      false,
      conv.intent ?? null,
      conv.recordingId ?? null,
      null,
      now,
    ]
  )

  // Notify listeners
  graphEventBus.emitTableChange(['conversations'])
}

/**
 * Mark a conversation as processed with a batch ID.
 */
async function markConversationProcessed(
  id: string,
  batchId: string
): Promise<void> {
  const reactive = await getReactive()
  await reactive.exec(
    `UPDATE conversations SET processed = true, batch_id = $1 WHERE id = $2`,
    [batchId, id]
  )
  graphEventBus.emitTableChange(['conversations'])
}

// ============================================================================
// Batch Mutations
// ============================================================================

/**
 * Run multiple mutations in a single batch — produces one tables:changed event.
 *
 * Usage:
 *   await graphMutations.batch(async () => {
 *     await graphMutations.createNode(['entity'], { name: 'Alice' })
 *     await graphMutations.createNode(['entity'], { name: 'Bob' })
 *     await graphMutations.createEdge(aliceId, bobId, 'KNOWS')
 *   })
 */
async function batch(fn: () => Promise<void>): Promise<void> {
  const reactive = await getReactive()
  await reactive.batchMutations(fn)
}

/**
 * Raw SQL query (read-only). Use for custom queries not covered by hooks.
 */
async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const reactive = await getReactive()
  return reactive.query<T>(sql, params)
}

/**
 * Raw SQL exec (write). Fires no events — use sparingly.
 * Prefer the typed mutation functions above.
 */
async function exec(sql: string, params?: unknown[]): Promise<void> {
  const reactive = await getReactive()
  await reactive.exec(sql, params)
}

// ============================================================================
// Export as single namespace
// ============================================================================

export const graphMutations = {
  // Nodes
  createNode,
  updateNodeProperties,
  setNodeProperties,
  updateNodeLabels,
  deleteNode,
  getNode,

  // Edges
  createEdge,
  updateEdgeProperties,
  deleteEdge,
  getEdges,

  // Conversations
  createConversation,
  markConversationProcessed,

  // Batch
  batch,

  // Raw
  query,
  exec,
}
