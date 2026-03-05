/**
 * Resolve short IDs in curation actions back to real DB IDs.
 *
 * Each action type has specific fields that may contain short IDs.
 * This function resolves them all in one pass.
 */

import type { CurationAction, ShortIdMap } from './types'
import { resolveActionIds } from './shortIdMap'

/**
 * Map of action type → field names that contain short IDs.
 */
const ACTION_ID_FIELDS: Record<string, string[]> = {
  edit: ['node', 'memoryIds'],
  create: ['parent', 'memoryIds', 'insertAfter'],
  delete: ['node'],
  move: ['node', 'newParent', 'insertAfter'],
  merge: ['source', 'target'],
  rename: ['node'],
  split: ['node'],
  retype: ['node'],
  link: ['fromNode', 'toEntity', 'toNode'],
  verify: ['node'],
  skip: [],
}

/**
 * Resolve all short IDs in a single curation action.
 */
export function resolveAllShortIds(action: CurationAction, idMap: ShortIdMap): CurationAction {
  const fields = ACTION_ID_FIELDS[action.type] ?? []
  const resolved = resolveActionIds(idMap, action as unknown as Record<string, unknown>, fields)

  // Special handling for split.into[].memoryIds
  if (action.type === 'split' && 'into' in resolved) {
    const splitAction = resolved as unknown as { into: Array<{ memoryIds: string[] }> }
    splitAction.into = splitAction.into.map(item => ({
      ...item,
      memoryIds: item.memoryIds.map(id =>
        typeof id === 'string' && idMap.toReal.has(id) ? idMap.toReal.get(id)! : id
      ),
    }))
  }

  return resolved as unknown as CurationAction
}
