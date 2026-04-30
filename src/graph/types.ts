/**
 * Knowledge Graph Core Types
 *
 * Neo4j-style property graph with cognitive modeling properties.
 * Nodes have labels[], edges have a type, both carry arbitrary JSON properties.
 *
 * The type system follows two-level modeling:
 *   Level 1 — Generic primitives (GraphNode, GraphEdge, GraphEmbedding)
 *   Level 2 — Domain types in properties JSON (CognitiveProperties, EntityProperties, etc.)
 *   Ontology — Template types (OntologyPackage, OntologyNode, OntologyEdge, OntologyCoverage)
 */

// ============================================================================
// Graph Primitives
// ============================================================================

export interface GraphNode {
  id: string
  branch_id: string
  labels: string[]
  properties: Record<string, unknown>
  /**
   * DEPRECATED: Legacy v1 embedding column. New embeddings go to the
   * dedicated 'embeddings' table. This field is kept for backward
   * compatibility during migration. Read from GraphEmbedding instead.
   */
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
  /**
   * Intent classification from SYS-I. Format: "INTENT:EMOTION" (e.g., "ASSERT:curious").
   * The intent part uses fixed vocabulary: ASSERT, QUERY, CORRECT, EXPLORE, COMMAND, SOCIAL.
   * Legacy data may have intent only (no colon), which is valid.
   */
  intent: string | null
  topic: string | null
  /**
   * Emotional tone of the user's turn, classified by the LLM.
   * Fixed vocabulary: neutral, excited, frustrated, curious, anxious,
   * confident, hesitant, reflective.
   * Stored separately from intent for direct querying without parsing.
   */
  emotion: string | null
  recording_id: string | null
  batch_id: string | null
  attachments: string // JSON: UploadedAttachment[]
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
// Embeddings (unified vector storage — replaces nodes.embedding)
// ============================================================================

/**
 * A vector embedding linked to any entity type (node, edge, conversation, ontology node).
 *
 * Decoupled from nodes so that:
 *   - Multiple entity types can have embeddings
 *   - Model can be tracked and upgraded per-embedding
 *   - Re-embedding is possible via source_text
 */
export interface GraphEmbedding {
  id: string
  target_id: string
  /** What kind of entity this embedding belongs to */
  target_kind: 'node' | 'edge' | 'conversation' | 'ontology_node'
  vector: number[]
  /** Model that produced this vector (e.g., 'bge-small-en-v1.5') */
  model: string
  /** Original text that was embedded — enables re-embedding on model change */
  source_text: string | null
  created_at: number
}

// ============================================================================
// Ontology System — Conversational Slot-Filling Templates
//
// Inspired by:
//   - OpenEHR archetypes (two-level modeling: stable storage + domain templates)
//   - Frame-based AI (Minsky 1975: frames, slots, WHEN-NEEDED demons)
//   - Rasa CALM (state machine decides WHAT to ask, LLM decides HOW)
//   - FHIR SDC Adaptive ($next-question pattern)
//
// The ontology system is NOT a formal ontology (no OWL, no reasoning).
// It's a practical template system that guides what questions to ask
// during natural conversation. All fuzzy work (phrasing, depth judgment,
// context understanding) is done by the LLM. The schema only tracks
// what's mechanical: which slots exist, which are filled, which to ask next.
// ============================================================================

/**
 * An installed domain template package.
 * Packages are loaded from JSON files and contain concepts, slots, probes,
 * and pre-computed embeddings.
 */
export interface OntologyPackage {
  id: string
  name: string
  version: string
  description: string | null
  /** 'active' = navigator considers this, 'disabled' = installed but ignored */
  status: 'active' | 'disabled'
  installed_at: number
}

/**
 * A node in the ontology template graph.
 *
 * Three kinds:
 *   - 'concept': Topic area (e.g., "Sleep Patterns"). Has priority for ordering.
 *   - 'slot': Data point to fill (e.g., "sleep_duration"). Has constraints/examples as properties.
 *   - 'probe': Question template (e.g., "How many hours do you sleep?"). Has style hint.
 */
export type OntologyNodeKind = 'concept' | 'slot' | 'probe'

export interface OntologyNode {
  id: string
  package_id: string
  kind: OntologyNodeKind
  properties: Record<string, unknown>
  created_at: number
}

/**
 * Properties shape for concept nodes.
 * Priority (0-1) determines which concept's slots get asked first.
 */
export interface ConceptProperties {
  name: string
  description: string
  priority: number
}

/**
 * Properties shape for slot nodes.
 * Constraints and examples are inline properties (not separate nodes).
 * This matches the pattern used by FHIR profiles and CRM systems.
 */
export interface SlotProperties {
  name: string
  description: string
  /** Type hint for the LLM — not enforced by the system */
  value_type: 'text' | 'number' | 'boolean' | 'date' | 'list'
  required: boolean
  constraints?: Record<string, unknown>
  examples?: string[]
}

/**
 * Properties shape for probe nodes.
 * Style hints guide how the LLM phrases the question.
 */
export interface ProbeProperties {
  question: string
  style: 'casual' | 'direct' | 'reflective'
}

/**
 * Edge types used in the ontology graph.
 *
 * Navigator-relevant (deterministic behavior):
 *   HAS_SLOT, HAS_PROBE — structural traversal
 *   REQUIRES — concept dependency (skip concept if dependency unfulfilled)
 *   DEPENDS_ON — slot dependency (skip slot if dependency unfilled)
 *
 * Informational (no special handling):
 *   RELATED_TO, ALTERNATIVE_TO
 */
export type OntologyEdgeType =
  | 'HAS_SLOT'
  | 'HAS_PROBE'
  | 'REQUIRES'
  | 'DEPENDS_ON'
  | 'RELATED_TO'
  | 'ALTERNATIVE_TO'

export interface OntologyEdge {
  id: string
  package_id: string
  start_id: string
  end_id: string
  type: OntologyEdgeType
  properties: Record<string, unknown>
  created_at: number
}

/**
 * Coverage map entry — bridge between ontology template and user's instance data.
 *
 * Tracks whether a specific slot has been filled with actual user data.
 * The navigator queries this to find unfilled slots.
 *
 * The instance_node_id links back to the user's knowledge graph node
 * that was created to fill this slot — this is the provenance link.
 */
export interface OntologyCoverage {
  id: string
  slot_id: string
  package_id: string
  /** Points to the node in the user's main graph that fills this slot */
  instance_node_id: string | null
  /** Simple boolean: answered or not. LLM judges depth, not us. */
  filled: boolean
  /** How confident the system is in the filled value (0-1) */
  confidence: number
  /** How many times we've asked about this slot (for exposure control) */
  probe_count: number
  last_probed_at: number | null
  /** Which conversation triggered the fill */
  conversation_id: string | null
  updated_at: number
}

// ============================================================================
// Emotion & Engagement Constants
// ============================================================================

/**
 * Fixed vocabulary for user emotional tone.
 * Classified by the LLM alongside intent (same call, no extra cost).
 * Stored in conversations.emotion column.
 */
export const EMOTIONS = [
  'neutral',
  'excited',
  'frustrated',
  'curious',
  'anxious',
  'confident',
  'hesitant',
  'reflective',
] as const

export type Emotion = typeof EMOTIONS[number]

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
