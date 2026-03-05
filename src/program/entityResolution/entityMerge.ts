/**
 * Entity Merge — Full Cross-DB Entity Merge + Rename
 *
 * fullEntityMerge() relinks ALL references across the entire DB:
 *   1. Memories: entityIds arrays
 *   2. Goals: entityIds arrays
 *   3. Topics: entityIds arrays
 *   4. Co-occurrences: transfer records (sum counts for shared partners, delete self-loops)
 *   5. Knowledge tree nodes: entityId field
 *   6. Timeline events: entityIds arrays
 *   7. Entity record: entityStore.merge() (aliases, counts, delete source)
 */

import { Q } from '@nozbe/watermelondb'
import { database } from '../../db/database'
import {
  entityStore,
  memoryStore,
  goalStore,
  topicStore,
  knowledgeNodeStore,
  timelineEventStore,
} from '../../db/stores'
import type EntityCooccurrence from '../../db/models/EntityCooccurrence'
import type { MergeResult } from './types'
import { invalidateFingerprintCache } from './entityResolver'
import { createLogger } from '../utils/logger'

const logger = createLogger('EntityMerge')

const cooccurrences = database.get<EntityCooccurrence>('entity_cooccurrences')

/**
 * Relink entityIds JSON array field: replace sourceId with targetId, deduplicate.
 * Returns the new array, or null if no change was needed.
 */
function relinkEntityIds(jsonStr: string, sourceId: string, targetId: string): string[] | null {
  let ids: string[]
  try {
    ids = JSON.parse(jsonStr || '[]')
  } catch {
    return null
  }
  if (!ids.includes(sourceId)) return null

  const updated = ids.map(id => id === sourceId ? targetId : id)
  return [...new Set(updated)]
}

/**
 * Full entity merge: relink ALL references from source → target across every table,
 * then merge entity records (aliases, counts) and delete source.
 *
 * Optional newName renames the target entity after merge.
 */
export async function fullEntityMerge(
  targetId: string,
  sourceId: string,
  newName?: string,
): Promise<MergeResult> {
  const result: MergeResult = {
    memories: 0,
    goals: 0,
    topics: 0,
    cooccurrences: 0,
    knowledgeNodes: 0,
    timelineEvents: 0,
  }

  logger.info('Starting full entity merge', { targetId, sourceId, newName })

  // 1. Relink memories
  const allMemories = await memoryStore.getAll()
  for (const memory of allMemories) {
    const newIds = relinkEntityIds(memory.entityIds, sourceId, targetId)
    if (newIds) {
      await database.write(async () => {
        await memory.update((m) => {
          m.entityIds = JSON.stringify(newIds)
        })
      })
      result.memories++
    }
  }

  // 2. Relink goals
  const allGoals = await goalStore.getAll()
  for (const goal of allGoals) {
    const newIds = relinkEntityIds(goal.entityIds, sourceId, targetId)
    if (newIds) {
      await database.write(async () => {
        await goal.update((g) => {
          g.entityIds = JSON.stringify(newIds)
        })
      })
      result.goals++
    }
  }

  // 3. Relink topics (entityIds field)
  const allTopics = await topicStore.getAll()
  for (const topic of allTopics) {
    const newIds = relinkEntityIds(topic.entityIds, sourceId, targetId)
    if (newIds) {
      await database.write(async () => {
        await topic.update((t) => {
          t.entityIds = JSON.stringify(newIds)
        })
      })
      result.topics++
    }
  }

  // 4. Transfer co-occurrences
  // Find all cooccurrence records involving the source entity
  const sourceAsA = await cooccurrences
    .query(Q.where('entityA', sourceId))
    .fetch()
  const sourceAsB = await cooccurrences
    .query(Q.where('entityB', sourceId))
    .fetch()

  const allSourceCoocs = [...sourceAsA, ...sourceAsB]

  for (const cooc of allSourceCoocs) {
    const partnerId = cooc.entityA === sourceId ? cooc.entityB : cooc.entityA

    // Skip self-loops (source↔target becomes target↔target)
    if (partnerId === targetId) {
      await database.write(async () => {
        await cooc.destroyPermanently()
      })
      result.cooccurrences++
      continue
    }

    // Check if target already has a cooccurrence with this partner
    const [canonA, canonB] = targetId < partnerId ? [targetId, partnerId] : [partnerId, targetId]
    const existing = await cooccurrences
      .query(
        Q.where('entityA', canonA),
        Q.where('entityB', canonB),
        Q.take(1),
      )
      .fetch()

    if (existing.length > 0) {
      // Merge: sum counts, combine contexts, delete source record
      const existingRecord = existing[0]
      const existingContexts = existingRecord.recentContextsParsed
      const sourceContexts = cooc.recentContextsParsed
      const mergedContexts = [...sourceContexts, ...existingContexts].slice(0, 3)

      await database.write(async () => {
        await existingRecord.update((r) => {
          r.count += cooc.count
          r.lastSeen = Math.max(r.lastSeen, cooc.lastSeen)
          r.recentContexts = JSON.stringify(mergedContexts)
        })
        await cooc.destroyPermanently()
      })
    } else {
      // Transfer: rewrite the source record to point to target
      await database.write(async () => {
        await cooc.update((r) => {
          if (r.entityA === sourceId) {
            // Need to maintain canonical ordering
            if (targetId < r.entityB) {
              r.entityA = targetId
            } else {
              // Swap to maintain canonical order
              const oldB = r.entityB
              r.entityA = oldB
              r.entityB = targetId
            }
          } else {
            // r.entityB === sourceId
            if (r.entityA < targetId) {
              r.entityB = targetId
            } else {
              // Swap to maintain canonical order
              const oldA = r.entityA
              r.entityA = targetId
              r.entityB = oldA
            }
          }
        })
      })
    }
    result.cooccurrences++
  }

  // 5. Relink knowledge tree nodes (entityId field, not an array)
  const allNodes = await knowledgeNodeStore.getAll()
  for (const node of allNodes) {
    if (node.entityId === sourceId) {
      await knowledgeNodeStore.update(node.id, { entityId: targetId })
      result.knowledgeNodes++
    }
  }

  // 6. Relink timeline events
  const allEvents = await timelineEventStore.getAll()
  for (const event of allEvents) {
    const newIds = relinkEntityIds(event.entityIds, sourceId, targetId)
    if (newIds) {
      await database.write(async () => {
        await event.update((e) => {
          e.entityIds = JSON.stringify(newIds)
        })
      })
      result.timelineEvents++
    }
  }

  // 7. Merge entity records (aliases, counts, delete source)
  if (newName) {
    // Rename target first, then merge
    await entityStore.update(targetId, { name: newName })
  }
  await entityStore.merge(targetId, sourceId)

  // Invalidate fingerprint cache
  invalidateFingerprintCache()

  logger.info('Entity merge complete', { targetId, sourceId, result })
  return result
}

/**
 * Rename an entity. Old name becomes an alias.
 */
export async function renameEntity(entityId: string, newName: string): Promise<void> {
  const entity = await entityStore.getById(entityId)
  if (!entity) {
    logger.warn('renameEntity: entity not found', { entityId })
    return
  }

  const oldName = entity.name
  const aliases = entity.aliasesParsed
  if (!aliases.includes(oldName)) {
    aliases.push(oldName)
  }

  await entityStore.update(entityId, {
    name: newName,
    aliases: aliases.filter(a => a !== newName),
  })

  invalidateFingerprintCache()
  logger.info('Entity renamed', { entityId, from: oldName, to: newName })
}
