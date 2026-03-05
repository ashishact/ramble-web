/**
 * Apply resolved timeline actions to the database.
 *
 * Handles create, update, merge, and skip actions.
 * All short IDs should already be resolved to real DB IDs before calling.
 */

import { timelineEventStore } from '../../db/stores'
import { resolveTemporalExpression } from '../kernel/temporalResolver'
import type {
  TimelineAction,
  TimelineCreateAction,
  TimelineUpdateAction,
  TimelineMergeAction,
} from './types'
import { createLogger } from '../utils/logger'

const logger = createLogger('TimelineExtractor')

/**
 * Resolve an eventTime string to a Unix timestamp.
 * Tries temporal resolver first (handles "today", "yesterday", etc.),
 * then ISO date parsing, then falls back to current time.
 */
function resolveEventTime(eventTime: string): { timestamp: number; fromResolver: boolean } {
  // Try temporal resolver (handles relative expressions)
  const resolved = resolveTemporalExpression(eventTime, Date.now())
  if (resolved?.validFrom) {
    return { timestamp: resolved.validFrom, fromResolver: true }
  }

  // Try ISO date parsing
  const parsed = new Date(eventTime)
  if (!isNaN(parsed.getTime())) {
    return { timestamp: parsed.getTime(), fromResolver: false }
  }

  // Fallback to current time
  logger.warn('Could not resolve eventTime, using current time', { eventTime })
  return { timestamp: Date.now(), fromResolver: false }
}

async function applyCreate(action: TimelineCreateAction): Promise<boolean> {
  const { timestamp } = resolveEventTime(action.eventTime)

  await timelineEventStore.create({
    entityIds: action.entityIds,
    eventTime: timestamp,
    timeGranularity: action.timeGranularity || 'day',
    timeConfidence: action.timeConfidence ?? 0.5,
    title: action.title,
    description: action.description,
    significance: action.significance,
    memoryIds: action.memoryIds,
    source: 'inferred',
  })

  logger.info('Created timeline event', { title: action.title })
  return true
}

async function applyUpdate(action: TimelineUpdateAction): Promise<boolean> {
  const updateData: Parameters<typeof timelineEventStore.update>[1] = {}

  if (action.title !== undefined) updateData.title = action.title
  if (action.description !== undefined) updateData.description = action.description
  if (action.significance !== undefined) updateData.significance = action.significance
  if (action.memoryIds !== undefined) updateData.memoryIds = action.memoryIds
  if (action.timeConfidence !== undefined) updateData.timeConfidence = action.timeConfidence

  const success = await timelineEventStore.update(action.event, updateData)

  if (success) {
    logger.info('Updated timeline event', { eventId: action.event })
  } else {
    logger.warn('Failed to update timeline event', { eventId: action.event })
  }
  return success
}

async function applyMerge(action: TimelineMergeAction): Promise<boolean> {
  // Update target with merged content
  const success = await timelineEventStore.update(action.target, {
    title: action.mergedTitle,
    description: action.mergedDescription,
  })

  if (!success) {
    logger.warn('Failed to update merge target', { target: action.target })
    return false
  }

  // Delete source
  const deleted = await timelineEventStore.delete(action.source)
  if (!deleted) {
    logger.warn('Failed to delete merge source', { source: action.source })
    return false
  }

  logger.info('Merged timeline events', { source: action.source, target: action.target })
  return true
}

/**
 * Apply a list of resolved timeline actions to the database.
 * Returns the count of successfully applied actions.
 */
export async function applyTimelineActions(actions: TimelineAction[]): Promise<number> {
  let applied = 0

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'create': {
          const ok = await applyCreate(action)
          if (ok) applied++
          break
        }
        case 'update': {
          const ok = await applyUpdate(action)
          if (ok) applied++
          break
        }
        case 'merge': {
          const ok = await applyMerge(action)
          if (ok) applied++
          break
        }
        case 'skip': {
          logger.debug('Skip action', { reason: action.reason })
          break
        }
      }
    } catch (error) {
      logger.error('Failed to apply timeline action', {
        type: action.type,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return applied
}
