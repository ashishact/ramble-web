/**
 * Graph Data Layer — Shared Types
 *
 * These types define the shape of data as seen by UI components.
 * Properties are parsed from JSON and flattened into plain objects.
 */

/** Options for useGraphData queries */
export interface GraphDataOptions {
  /** Max rows to return (default: 100) */
  limit?: number
  /** Property field to sort by */
  orderBy?: { field: string; dir?: 'asc' | 'desc' }
  /** Simple property equality filters: { status: 'active' } */
  where?: Record<string, string | number | boolean>
  /** Extra React dependency array entries */
  deps?: unknown[]
}

/** Options for useConversationData queries */
export interface ConversationDataOptions {
  limit?: number
  orderBy?: { field: string; dir?: 'asc' | 'desc' }
  where?: Record<string, string | number | boolean | null>
  deps?: unknown[]
}

/** Base shape every node record shares after parsing */
export interface BaseNodeRecord {
  id: string
  labels: string[]
  createdAt: number
  updatedAt: number
}

export interface ConversationAttachment {
  r2Key: string
  filename: string
  contentType: string
  size: number
}

/** Base shape for conversation records */
export interface ConversationRecord {
  id: string
  sessionId: string
  timestamp: number
  rawText: string
  source: string
  speaker: string
  processed: boolean
  intent: string | null
  recordingId: string | null
  batchId: string | null
  attachments: ConversationAttachment[]
  createdAt: number
}

// ============================================================================
// Widget Item Types — Flattened shapes for UI consumption
// ============================================================================

/** Entity node flattened for display */
export interface EntityItem extends BaseNodeRecord {
  name: string
  type: string
  description?: string
  aliases: string[]
  mentionCount: number
  firstMentioned: number
  lastMentioned: number
}

/** Topic node flattened for display */
export interface TopicItem extends BaseNodeRecord {
  name: string
  description?: string
  category?: string
  mentionCount: number
  firstMentioned: number
  lastMentioned: number
}

/** Memory node flattened for display */
export interface MemoryItem extends BaseNodeRecord {
  content: string
  type: string
  subject?: string
  confidence: number
  importance: number
  activityScore: number
  state: string
  origin?: string
  lastReinforced: number
  reinforcementCount: number
  supersededBy?: string
  contradictedBy?: string[]
  validFrom?: number
  validUntil?: number
  shortId?: string
}

/** Goal node flattened for display */
export interface GoalItem extends BaseNodeRecord {
  statement: string
  type: string
  status: string
  progress: number
  firstExpressed: number
  lastReferenced: number
  achievedAt?: number
  parentGoalId?: string
}

/** Knowledge tree node flattened for display */
export interface KnowledgeNodeItem extends BaseNodeRecord {
  entityId: string
  parentId: string | null
  label: string
  content: string | null
  summary: string | null
  nodeType: string
  sortOrder: number
  depth: number
  source: string
  verification: string
  modifiedAt: number
  templateKey: string | null
  memoryIds: string[]
  metadata: Record<string, unknown>
}

/** Timeline event node flattened for display */
export interface TimelineEventItem extends BaseNodeRecord {
  title: string
  eventTime: number
  timeGranularity: string
  significance: string | null
  entityIds: string[]
}

/** Learned correction node flattened for display */
export interface LearnedCorrectionItem extends BaseNodeRecord {
  original: string
  corrected: string
  confidence: number
  count: number
  leftContext: string[]
  rightContext: string[]
}
