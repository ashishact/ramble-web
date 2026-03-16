/**
 * Knowledge Graph Core Types
 *
 * Neo4j-style property graph with cognitive modeling properties.
 * Nodes have labels[], edges have a type, both carry arbitrary JSON properties.
 */

// ============================================================================
// Graph Primitives
// ============================================================================

export interface GraphNode {
  id: string
  branch_id: string
  labels: string[]
  properties: Record<string, unknown>
  embedding: Float32Array | null
  created_at: number
  updated_at: number
}

export interface GraphEdge {
  id: string
  branch_id: string
  start_id: string
  end_id: string
  type: string
  properties: Record<string, unknown>
  created_at: number
  updated_at: number
}

// ============================================================================
// Event Log (Append-Only)
// ============================================================================

export type EventOp = 'create' | 'update' | 'delete' | 'merge' | 'retract'

export interface GraphEvent {
  id: string
  target_id: string
  target_kind: 'node' | 'edge'
  op: EventOp
  delta: Record<string, unknown>
  timestamp: number
  source: string
  recording_id: string | null
}

// ============================================================================
// Snapshots (Point-in-Time State)
// ============================================================================

export interface GraphSnapshot {
  id: string
  target_id: string
  target_kind: 'node' | 'edge'
  state: Record<string, unknown>
  timestamp: number
}

// ============================================================================
// Branches (Git-like)
// ============================================================================

export type BranchStatus = 'active' | 'merged' | 'archived'

export interface GraphBranch {
  id: string
  name: string
  parent_branch_id: string | null
  created_at: number
  merged_at: number | null
  status: BranchStatus
}

// ============================================================================
// Conversations
// ============================================================================

export interface GraphConversation {
  id: string
  session_id: string
  timestamp: number
  raw_text: string
  source: string
  speaker: string
  processed: boolean
  intent: string | null
  topic: string | null
  recording_id: string | null
  batch_id: string | null
  created_at: number
}

// ============================================================================
// Working Context
// ============================================================================

export interface WorkingContextEntry {
  id: string
  node_id: string
  relevance: number
  last_accessed: number
  added_at: number
}

// ============================================================================
// Cognitive Properties (embedded in node/edge properties JSON)
// ============================================================================

/**
 * Cognitive properties for memory/knowledge nodes.
 * These live inside the `properties` JSON field of a GraphNode.
 *
 * Preserves all 25 cognitive modeling concepts from the plan:
 * decay, reinforcement, contradiction, provenance, confidence,
 * importance, activity score, ownership, temporal validity,
 * composite score, memory state, etc.
 */
export interface CognitiveProperties {
  // === Identity ===
  content: string
  type: string          // 'fact' | 'event' | 'belief' | 'preference' | 'habit' | 'observation'
  subject?: string      // Entity name this memory is primarily about

  // === Scoring (0-1 range) ===
  importance: number    // How significant (LLM-assigned, default 0.5)
  confidence: number    // How sure we are (origin-based prior, decays for provisional)
  activityScore: number // Recency-weighted engagement (exponential decay, 7-day half-life)
  ownership: number     // How much the user "owns" this info (speech > typed > pasted > document)

  // === State Machine ===
  state: MemoryState    // provisional → stable → contested → superseded → retracted

  // === Temporal Validity ===
  validFrom?: number    // Unix ms — when this fact became true
  validUntil?: number   // Unix ms — when this fact stopped being true (null = still valid)

  // === Provenance ===
  origin: MemoryOrigin  // How the information entered the system
  extractionVersion: string
  sourceConversationIds: string[]

  // === Reinforcement ===
  reinforceCount: number
  lastReinforced: number   // Unix ms

  // === Contradiction ===
  contradictedBy?: string[]  // Node IDs of contradicting memories
  supersededBy?: string      // Node ID that superseded this one
}

export type MemoryState = 'provisional' | 'stable' | 'contested' | 'superseded' | 'retracted'

export type MemoryOrigin = 'speech' | 'typed' | 'meeting' | 'pasted' | 'document'

// ============================================================================
// Entity Properties (embedded in node properties JSON)
// ============================================================================

export interface EntityProperties {
  name: string
  type: string          // 'person' | 'organization' | 'location' | 'product' | 'other'
  description?: string
  aliases: string[]
  mentionCount: number
  firstMentioned: number
  lastMentioned: number
}

// ============================================================================
// Topic Properties (embedded in node properties JSON)
// ============================================================================

export interface TopicProperties {
  name: string
  category?: string
  mentionCount: number
  firstMentioned: number
  lastMentioned: number
}

// ============================================================================
// Goal Properties (embedded in node properties JSON)
// ============================================================================

export interface GoalProperties {
  statement: string
  type: string
  status: 'active' | 'achieved' | 'abandoned'
  progress: number
  entityIds: string[]
  topicIds: string[]
}

// ============================================================================
// Worker RPC Protocol
// ============================================================================

export type WorkerRequestType = 'init' | 'exec' | 'query' | 'batch' | 'export' | 'close'

export interface WorkerRequest {
  id: number
  type: WorkerRequestType
  payload: unknown
}

export interface WorkerResponse {
  id: number
  type: 'result' | 'error'
  payload: unknown
}

// ============================================================================
// KG Subset (output from single-pass LLM)
// ============================================================================

export interface KGSubset {
  nodes: Array<{
    tempId: string
    labels: string[]
    properties: Record<string, unknown>
  }>
  edges: Array<{
    startTempId: string
    endTempId: string
    type: string
    properties: Record<string, unknown>
  }>
  topics: string[]
  goals: Array<{
    statement: string
    type: string
    status?: string
    progress?: number
    shortId?: string
  }>
  corrections: Array<{
    wrong: string
    correct: string
  }>
  retractions: string[]
}
