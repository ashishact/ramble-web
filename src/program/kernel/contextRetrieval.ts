/**
 * Context Retrieval — Hint-Based Relevance-Scored Search
 *
 * VISION: Two-pass architecture solves the chicken-and-egg problem.
 * ═══════════════════════════════════════════════════════════════════
 *
 * Pass 1 (normalizeInput): LLM reads raw text and extracts approximate
 *   names and topics as search keys — "Charan Tandi", "project deadline"
 *
 * Pass 2 (this file): Search keys find real DB entities/topics/memories.
 *   The extraction LLM now gets full context: "Charan Tandi" matches
 *   entity "Charan Tandi" with 47 mentions, related project "Ramble", etc.
 *
 * SCORING: Combines relevance (how well the hint matches) with recency
 * (how recently the entity/topic/memory was active). Final score:
 *   finalScore = relevance * 0.6 + recencyScore * 0.4
 *
 * Recency is normalized so the most recent item gets 1.0 and the oldest
 * gets ~0. This ensures we prioritize what's being talked about NOW
 * while still finding old-but-relevant matches.
 *
 * SIZE TIERS: System I (fast) gets fewer results, System II (slow) gets more.
 */

import { entityStore, topicStore, memoryStore } from '../../db/stores'
import type { NormalizationHints } from '../types/recording'
import type Entity from '../../db/models/Entity'
import type Topic from '../../db/models/Topic'
import type Memory from '../../db/models/Memory'

// ============================================================================
// Types
// ============================================================================

export type ContextSize = 'small' | 'medium' | 'large'

/** Reference to a matched entity with relevance score */
export interface EntityRef {
  id: string
  name: string
  type: string
  relevance: number
}

/** Reference to a matched topic with relevance score */
export interface TopicRef {
  id: string
  name: string
  category?: string
  relevance: number
}

/** Reference to a matched memory with relevance score */
export interface MemoryRef {
  id: string
  content: string
  type: string
  relevance: number
}

export interface RetrievedContext {
  matchedEntities: EntityRef[]
  matchedTopics: TopicRef[]
  relatedMemories: MemoryRef[]
}

// Size tier limits
const SIZE_LIMITS: Record<ContextSize, { entities: number; topics: number; memories: number }> = {
  small: { entities: 5, topics: 3, memories: 5 },
  medium: { entities: 15, topics: 8, memories: 15 },
  large: { entities: 25, topics: 15, memories: 25 },
}

// ============================================================================
// Scoring Helpers
// ============================================================================

/**
 * Calculate recency score (0-1) based on timestamp.
 * Most recent item in the set gets 1.0, oldest gets ~0.
 * Uses exponential decay with a 7-day half-life.
 */
function recencyScore(timestamp: number, now: number): number {
  const ageMs = now - timestamp
  const halfLifeMs = 7 * 24 * 60 * 60 * 1000 // 7 days
  return Math.exp(-ageMs / halfLifeMs)
}

/**
 * Combine relevance and recency into a final score.
 * relevance: how well the hint matched (0-1)
 * recency: how recently active (0-1)
 */
function finalScore(relevance: number, recency: number): number {
  return relevance * 0.6 + recency * 0.4
}

// ============================================================================
// Main Retrieval Function
// ============================================================================

/**
 * Use normalization hints to find relevant context from the database.
 * Called between normalization (Pass 1) and extraction (Pass 2).
 *
 * @param hints - Entity and topic hints from normalization
 * @param size - Context size tier (small for System I, medium for System II)
 * @returns Matched entities, topics, and related memories with relevance scores
 */
export async function retrieveContext(
  hints: NormalizationHints,
  size: ContextSize = 'medium'
): Promise<RetrievedContext> {
  const limits = SIZE_LIMITS[size]
  const now = Date.now()

  // ── Search entities ──────────────────────────────────────────────────
  const entityMatches = new Map<string, { entity: Entity; relevance: number }>()

  for (const hint of hints.entityHints) {
    const matches = await entityStore.searchWithRelevance(hint.name, 10)
    for (const { entity, relevance } of matches) {
      const existing = entityMatches.get(entity.id)
      // Keep the highest relevance score for each entity
      const weightedRelevance = relevance * (hint.confidence ?? 0.5)
      if (!existing || existing.relevance < weightedRelevance) {
        entityMatches.set(entity.id, { entity, relevance: weightedRelevance })
      }
    }
  }

  // Score and sort entities
  const matchedEntities: EntityRef[] = Array.from(entityMatches.values())
    .map(({ entity, relevance }) => ({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      relevance: finalScore(relevance, recencyScore(entity.lastMentioned, now)),
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limits.entities)

  // ── Search topics ────────────────────────────────────────────────────
  const topicMatches = new Map<string, { topic: Topic; relevance: number }>()

  for (const hint of hints.topicHints) {
    const matches = await topicStore.searchWithRelevance(hint.name, 10)
    for (const { topic, relevance } of matches) {
      const existing = topicMatches.get(topic.id)
      if (!existing || existing.relevance < relevance) {
        topicMatches.set(topic.id, { topic, relevance })
      }
    }
  }

  // Score and sort topics
  const matchedTopics: TopicRef[] = Array.from(topicMatches.values())
    .map(({ topic, relevance }) => ({
      id: topic.id,
      name: topic.name,
      category: topic.category ?? undefined,
      relevance: finalScore(relevance, recencyScore(topic.lastMentioned, now)),
    }))
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limits.topics)

  // ── Find related memories using matched entity/topic IDs ────────────
  const entityIds = matchedEntities.map(e => e.id)
  const topicIds = matchedTopics.map(t => t.id)

  let relatedMemories: MemoryRef[] = []

  if (entityIds.length > 0 || topicIds.length > 0) {
    const memories = await memoryStore.getForContext(entityIds, topicIds, limits.memories * 2)

    relatedMemories = memories
      .map((m: Memory) => {
        // Score by overlap with matched entities/topics
        const memEntityIds = m.entityIdsParsed
        const memTopicIds = m.topicIdsParsed
        const entityOverlap = entityIds.filter(id => memEntityIds.includes(id)).length
        const topicOverlap = topicIds.filter(id => memTopicIds.includes(id)).length
        const overlapRelevance = Math.min(1, (entityOverlap * 0.3 + topicOverlap * 0.2))

        return {
          id: m.id,
          content: m.content,
          type: m.type,
          relevance: finalScore(overlapRelevance, recencyScore(m.lastReinforced, now)),
        }
      })
      .sort((a: MemoryRef, b: MemoryRef) => b.relevance - a.relevance)
      .slice(0, limits.memories)
  }

  // Also search memories directly by entity/topic name hints
  for (const hint of [...hints.entityHints, ...hints.topicHints]) {
    if (relatedMemories.length >= limits.memories) break
    const directMatches = await memoryStore.searchWithRelevance(hint.name, 5)
    for (const { memory, relevance } of directMatches) {
      if (relatedMemories.length >= limits.memories) break
      if (relatedMemories.some(m => m.id === memory.id)) continue
      relatedMemories.push({
        id: memory.id,
        content: memory.content,
        type: memory.type,
        relevance: finalScore(relevance, recencyScore(memory.lastReinforced, now)),
      })
    }
  }

  // Re-sort after adding direct matches
  relatedMemories.sort((a, b) => b.relevance - a.relevance)
  relatedMemories = relatedMemories.slice(0, limits.memories)

  return { matchedEntities, matchedTopics, relatedMemories }
}
