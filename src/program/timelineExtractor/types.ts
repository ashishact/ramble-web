/**
 * Timeline Extraction Types — action types the historian LLM can output.
 *
 * Follows the same action-based pattern as knowledge tree curation.
 */

// === Timeline Actions ===

export interface TimelineCreateAction {
  type: 'create'
  title: string
  description: string
  eventTime: string            // relative or ISO date string — resolved before DB write
  timeGranularity: string      // exact|day|week|month|approximate
  timeConfidence: number       // 0-1
  significance?: string        // optional human-readable significance
  entityIds: string[]          // short IDs (e-prefix)
  memoryIds: string[]          // short IDs (m-prefix)
}

export interface TimelineUpdateAction {
  type: 'update'
  event: string                // short ID (t-prefix) of existing event
  title?: string
  description?: string
  significance?: string
  memoryIds?: string[]         // short IDs to append
  timeConfidence?: number
}

export interface TimelineMergeAction {
  type: 'merge'
  source: string               // short ID (t-prefix) — will be deleted
  target: string               // short ID (t-prefix) — will be kept
  mergedTitle: string
  mergedDescription: string
}

export interface TimelineSkipAction {
  type: 'skip'
  reason: string
}

export type TimelineAction =
  | TimelineCreateAction
  | TimelineUpdateAction
  | TimelineMergeAction
  | TimelineSkipAction

// === Response Envelope ===

export interface TimelineResponse {
  actions: TimelineAction[]
}
