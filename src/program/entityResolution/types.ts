/**
 * Entity Resolution Types
 *
 * Multi-signal fingerprint scoring for entity deduplication.
 * Combines Jaro-Winkler name similarity, Milne-Witten co-occurrence overlap,
 * topic Jaccard, temporal proximity, and type agreement via Fellegi-Sunter
 * inspired weighted scoring.
 */

/** Precomputed fingerprint for an entity — used for blocking + scoring */
export interface EntityFingerprint {
  entityId: string
  name: string
  type: string
  aliases: string[]
  nameNormalized: string
  soundexCodes: string[]
  cooccurringEntityIds: Set<string>
  topicIds: Set<string>
  firstMentioned: number
  lastMentioned: number
  mentionCount: number
}

/** Per-signal scores + composite decision for a candidate pair */
export interface MergeScore {
  nameSimilarity: number
  cooccurrenceJaccard: number
  topicJaccard: number
  temporalProximity: number
  typeAgreement: number
  composite: number
  decision: 'merge' | 'maybe' | 'distinct'
}

/** Counts of relinked records across all tables after a full merge */
export interface MergeResult {
  memories: number
  goals: number
  topics: number
  cooccurrences: number
  knowledgeNodes: number
  timelineEvents: number
}

/** Context passed from saveExtraction to the resolver for the current batch */
export interface SessionContext {
  /** Entity IDs already resolved in this extraction batch */
  resolvedEntityIds: string[]
  /** Topic IDs already resolved in this extraction batch */
  resolvedTopicIds: string[]
}

/** Result from resolveEntity — null means "create new" */
export interface ResolveResult {
  entityId: string
  entityName: string
  entityType: string
  score: MergeScore
}

/**
 * Fellegi-Sunter inspired weights — sum = 1.0
 *
 * NAME = 0.40: Primary signal, but insufficient alone (Abha/Asha both ~0.83)
 * COOCCURRENCE = 0.25: Milne-Witten inspired — shared social graph is strong evidence
 * TOPIC = 0.15: Same domain/topics indicates same entity
 * TEMPORAL = 0.10: Mentioned around the same time = weak positive signal
 * TYPE = 0.10: Type agreement is a sanity check, disagreement is a hard veto
 */
export const RESOLUTION_WEIGHTS = {
  NAME: 0.40,
  COOCCURRENCE: 0.25,
  TOPIC: 0.15,
  TEMPORAL: 0.10,
  TYPE: 0.10,
} as const

/**
 * Decision thresholds for composite score
 *
 * AUTO_MERGE >= 0.80: High confidence — use existing entity
 * MAYBE_MERGE >= 0.55: Medium confidence — still use existing (conservative against new duplicates)
 * Below 0.55: Distinct — create new entity
 */
export const THRESHOLDS = {
  AUTO_MERGE: 0.80,
  MAYBE_MERGE: 0.55,
} as const
