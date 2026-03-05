/**
 * Resolve short IDs in timeline actions back to real DB IDs.
 *
 * Each action type has specific fields that may contain short IDs.
 */

import type { TimelineAction } from './types'
import type { ShortIdMap } from '../knowledgeTree/types'
import { resolveActionIds } from '../knowledgeTree/shortIdMap'

/**
 * Map of action type -> field names that contain short IDs.
 */
const ACTION_ID_FIELDS: Record<string, string[]> = {
  create: ['entityIds', 'memoryIds'],
  update: ['event', 'memoryIds'],
  merge: ['source', 'target'],
  skip: [],
}

/**
 * Resolve all short IDs in a single timeline action.
 */
export function resolveTimelineShortIds(action: TimelineAction, idMap: ShortIdMap): TimelineAction {
  const fields = ACTION_ID_FIELDS[action.type] ?? []
  return resolveActionIds(idMap, action as unknown as Record<string, unknown>, fields) as unknown as TimelineAction
}
