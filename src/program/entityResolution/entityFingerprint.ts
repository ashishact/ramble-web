/**
 * Entity Fingerprint Builder
 *
 * Batch-builds fingerprints for ALL entities in the DB, pulling
 * co-occurrence, topic, and memory data in bulk queries.
 * Also builds "virtual" fingerprints for incoming (not-yet-saved) entities.
 */

import {
  entityStore,
  cooccurrenceStore,
  topicStore,
  memoryStore,
} from '../../db/stores'
import { soundex } from '../services/phoneticMatcher'
import type { EntityFingerprint, SessionContext } from './types'

/**
 * Build fingerprints for ALL entities in the database.
 *
 * 3 bulk queries (cooccurrences, topics, memories), then assembles adjacency
 * indexes. Returns Map<entityId, EntityFingerprint>.
 */
export async function buildAllFingerprints(): Promise<Map<string, EntityFingerprint>> {
  const [allEntities, allCooccurrences, allTopics, allMemories] = await Promise.all([
    entityStore.getAll(),
    cooccurrenceStore.getAll(),
    topicStore.getAll(),
    memoryStore.getAll(),
  ])

  // Build co-occurrence adjacency: entityId → Set of co-occurring entityIds
  const cooccurrenceMap = new Map<string, Set<string>>()
  for (const c of allCooccurrences) {
    if (!cooccurrenceMap.has(c.entityA)) cooccurrenceMap.set(c.entityA, new Set())
    if (!cooccurrenceMap.has(c.entityB)) cooccurrenceMap.set(c.entityB, new Set())
    cooccurrenceMap.get(c.entityA)!.add(c.entityB)
    cooccurrenceMap.get(c.entityB)!.add(c.entityA)
  }

  // Build topic membership: entityId → Set of topicIds
  const topicMembershipMap = new Map<string, Set<string>>()
  for (const topic of allTopics) {
    const entityIds = topic.entityIdsParsed
    for (const entityId of entityIds) {
      if (!topicMembershipMap.has(entityId)) topicMembershipMap.set(entityId, new Set())
      topicMembershipMap.get(entityId)!.add(topic.id)
    }
  }

  // Also build topic membership from memories (entities → topics via shared memories)
  for (const memory of allMemories) {
    const memEntityIds = memory.entityIdsParsed
    const memTopicIds = memory.topicIdsParsed
    for (const entityId of memEntityIds) {
      if (!topicMembershipMap.has(entityId)) topicMembershipMap.set(entityId, new Set())
      for (const topicId of memTopicIds) {
        topicMembershipMap.get(entityId)!.add(topicId)
      }
    }
  }

  // Assemble fingerprints
  const fingerprints = new Map<string, EntityFingerprint>()

  for (const entity of allEntities) {
    const nameWords = entity.name.split(/\s+/).filter(w => w.length > 1)
    const soundexCodes = nameWords.map(w => soundex(w)).filter(Boolean)

    fingerprints.set(entity.id, {
      entityId: entity.id,
      name: entity.name,
      type: entity.type,
      aliases: entity.aliasesParsed,
      nameNormalized: entity.name.toLowerCase().trim(),
      soundexCodes,
      cooccurringEntityIds: cooccurrenceMap.get(entity.id) ?? new Set(),
      topicIds: topicMembershipMap.get(entity.id) ?? new Set(),
      firstMentioned: entity.firstMentioned,
      lastMentioned: entity.lastMentioned,
      mentionCount: entity.mentionCount,
    })
  }

  return fingerprints
}

/**
 * Build a "virtual" fingerprint for an incoming entity that hasn't been
 * saved yet. Uses the current extraction's session context to populate
 * co-occurrence and topic signals.
 */
export function buildIncomingFingerprint(
  name: string,
  type: string,
  sessionContext: SessionContext,
): EntityFingerprint {
  const nameWords = name.split(/\s+/).filter(w => w.length > 1)
  const soundexCodes = nameWords.map(w => soundex(w)).filter(Boolean)
  const now = Date.now()

  return {
    entityId: '__incoming__',
    name,
    type,
    aliases: [],
    nameNormalized: name.toLowerCase().trim(),
    soundexCodes,
    cooccurringEntityIds: new Set(sessionContext.resolvedEntityIds),
    topicIds: new Set(sessionContext.resolvedTopicIds),
    firstMentioned: now,
    lastMentioned: now,
    mentionCount: 0,
  }
}
