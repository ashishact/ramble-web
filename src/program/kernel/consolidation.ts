/**
 * Consolidation Engine — Periodic Knowledge Maintenance ("Sleep")
 *
 * VISION: The brain doesn't just record — it consolidates during rest.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This engine runs periodically (5 min idle OR 24h since last run) and
 * performs maintenance operations on the knowledge base:
 *
 * Phase 1 (now):
 *   - Entity deduplication (merge same-name different-case)
 *   - Near-duplicate memory detection (string similarity)
 *   - Activity/confidence/importance decay (from decayService)
 *   - Emit processing:consolidation event
 *
 * Phase 2 (future):
 *   - Cross-session pattern recognition
 *   - Goal progress inference
 *   - Memory consolidation (merge related into summaries)
 *
 * System II and Consolidation should batch when possible. For now keep
 * simple: one-by-one. Future iterations will batch multiple items into
 * single LLM calls for efficiency.
 */

import { database } from '../../db/database'
import { entityStore, memoryStore, dataStore } from '../../db/stores'
import { eventBus } from '../../lib/eventBus'
import { createLogger } from '../utils/logger'
import type Entity from '../../db/models/Entity'
import type Memory from '../../db/models/Memory'
import type { ConsolidationResult } from '../types/recording'

const logger = createLogger('Consolidation')

// ============================================================================
// Constants
// ============================================================================

/** Minimum idle time before running consolidation (5 minutes) */
const IDLE_THRESHOLD_MS = 5 * 60 * 1000

/** Key for tracking last consolidation run in dataStore */
const LAST_CONSOLIDATION_KEY = 'last_consolidation_run'

// Decay constants (moved from decayService.ts)
const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Similarity threshold for near-duplicate memory detection */
const MEMORY_SIMILARITY_THRESHOLD = 0.85

// ============================================================================
// Similarity Helpers
// ============================================================================

/**
 * Simple string similarity based on shared bigrams (Dice coefficient).
 * Fast enough for in-memory scanning of ~200 memories.
 */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const aBigrams = new Set<string>()
  const bBigrams = new Set<string>()
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()

  for (let i = 0; i < aLower.length - 1; i++) {
    aBigrams.add(aLower.slice(i, i + 2))
  }
  for (let i = 0; i < bLower.length - 1; i++) {
    bBigrams.add(bLower.slice(i, i + 2))
  }

  let intersection = 0
  for (const bigram of aBigrams) {
    if (bBigrams.has(bigram)) intersection++
  }

  return (2 * intersection) / (aBigrams.size + bBigrams.size)
}

// ============================================================================
// Consolidation Operations
// ============================================================================

/**
 * Merge entities that have the same name but different casing.
 * Keeps the entity with the highest mentionCount as the primary,
 * adds others as aliases, then deletes duplicates.
 */
async function deduplicateEntities(): Promise<number> {
  const all = await entityStore.getAll()
  if (all.length === 0) return 0

  // Group by lowercase name
  const groups = new Map<string, Entity[]>()
  for (const entity of all) {
    const key = entity.name.toLowerCase()
    const group = groups.get(key) || []
    group.push(entity)
    groups.set(key, group)
  }

  let merged = 0
  for (const [, group] of groups) {
    if (group.length <= 1) continue

    // Sort by mentionCount DESC — highest is the "winner"
    group.sort((a, b) => b.mentionCount - a.mentionCount)
    const primary = group[0]
    const duplicates = group.slice(1)

    // Merge aliases from duplicates into primary
    const existingAliases = primary.aliasesParsed
    const newAliases = new Set(existingAliases)
    for (const dup of duplicates) {
      // Add the duplicate's name as an alias
      newAliases.add(dup.name)
      // Add its existing aliases too
      for (const alias of dup.aliasesParsed) {
        newAliases.add(alias)
      }
    }
    // Remove the primary's own name from aliases
    newAliases.delete(primary.name)

    // Update primary with merged aliases
    await entityStore.update(primary.id, {
      aliases: [...newAliases],
    })

    // Delete duplicates
    for (const dup of duplicates) {
      await entityStore.delete(dup.id)
      merged++
    }

    logger.info('Merged duplicate entities', {
      primary: primary.name,
      merged: duplicates.length,
    })
  }

  return merged
}

/**
 * Find near-duplicate memories using string similarity.
 * When duplicates are found, the newer one supersedes the older.
 */
async function findNearDuplicateMemories(): Promise<number> {
  const active = await memoryStore.getActive(200)
  if (active.length < 2) return 0

  let duplicatesFound = 0
  const processed = new Set<string>()

  for (let i = 0; i < active.length; i++) {
    if (processed.has(active[i].id)) continue

    for (let j = i + 1; j < active.length; j++) {
      if (processed.has(active[j].id)) continue

      // Only compare memories of the same type
      if (active[i].type !== active[j].type) continue

      const similarity = stringSimilarity(active[i].content, active[j].content)
      if (similarity >= MEMORY_SIMILARITY_THRESHOLD) {
        // Newer supersedes older — keep the more recent one
        const older = active[i].lastReinforced < active[j].lastReinforced ? active[i] : active[j]
        const newer = older === active[i] ? active[j] : active[i]

        await memoryStore.supersede(older.id, newer.id)
        // Reinforce the surviving memory
        await memoryStore.reinforce(newer.id)

        processed.add(older.id)
        duplicatesFound++

        logger.info('Found near-duplicate memories', {
          olderId: older.id,
          newerId: newer.id,
          similarity: similarity.toFixed(2),
          content: older.content.slice(0, 50),
        })
      }
    }
  }

  return duplicatesFound
}

/**
 * Run activity/confidence/importance decay.
 * Moved from decayService.ts into consolidation engine.
 */
async function runDecay(): Promise<number> {
  const now = Date.now()
  const allMemories = await database.get<Memory>('memories').query().fetch()

  const toDecay = allMemories.filter(m => {
    const daysSince = (now - m.lastReinforced) / 86_400_000
    return (
      (m.state === 'provisional' && daysSince > 30) ||
      (m.type === 'event' && daysSince > 180) ||
      (m.activityScore > 0.01)
    )
  })

  if (toDecay.length > 0) {
    await database.write(async () => {
      for (const memory of toDecay) {
        const daysSince = (now - memory.lastReinforced) / 86_400_000
        await memory.update((m) => {
          // Decay confidence for old provisional memories
          if (m.state === 'provisional' && daysSince > 30) {
            m.confidence = m.confidence * 0.9
          }
          // Decay importance for old event memories
          if (m.type === 'event' && daysSince > 180) {
            m.importance = m.importance * 0.95
          }
          // Exponential activityScore decay for all active memories
          if (m.activityScore > 0.01) {
            const decayed = m.activityScore * Math.exp(-0.15 * daysSince)
            m.activityScore = decayed < 0.01 ? 0 : decayed
          }
        })
      }
    })
  }

  return toDecay.length
}

// ============================================================================
// Main Consolidation Runner
// ============================================================================

/**
 * Run the full consolidation pass.
 * Called on idle or after MAX_INTERVAL_MS since last run.
 */
export async function runConsolidation(): Promise<ConsolidationResult> {
  logger.info('Starting consolidation pass...')
  const startTime = Date.now()

  try {
    // 1. Entity deduplication
    const entitiesMerged = await deduplicateEntities()

    // 2. Near-duplicate memory detection
    const duplicatesFound = await findNearDuplicateMemories()

    // 3. Decay pass
    const decayed = await runDecay()

    const result: ConsolidationResult = {
      entitiesMerged,
      duplicatesFound,
      decayed,
      timestamp: Date.now(),
    }

    // Save last run timestamp
    await dataStore.set(LAST_CONSOLIDATION_KEY, 'system', Date.now())

    // Emit event for widgets/consumers
    eventBus.emit('processing:consolidation', { result })

    const durationMs = Date.now() - startTime
    logger.info('Consolidation complete', {
      ...result,
      durationMs,
    })

    return result
  } catch (error) {
    logger.error('Consolidation failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      entitiesMerged: 0,
      duplicatesFound: 0,
      decayed: 0,
      timestamp: Date.now(),
    }
  }
}

/**
 * Check if consolidation is due and run if so.
 * Call this periodically (e.g. on idle timer or page visibility change).
 */
export async function runConsolidationIfDue(): Promise<ConsolidationResult | null> {
  try {
    const lastRun = await dataStore.getValue<number>(LAST_CONSOLIDATION_KEY)
    const now = Date.now()

    if (lastRun && now - lastRun < DECAY_INTERVAL_MS) {
      return null // Not due yet
    }

    return await runConsolidation()
  } catch (error) {
    logger.error('Consolidation check failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

// ============================================================================
// Idle Timer
// ============================================================================

let idleTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Reset the idle timer. Call this when user activity is detected.
 * After IDLE_THRESHOLD_MS of inactivity, consolidation runs.
 */
export function resetIdleTimer(): void {
  if (idleTimer) {
    clearTimeout(idleTimer)
  }

  idleTimer = setTimeout(() => {
    idleTimer = null
    runConsolidationIfDue().catch(err =>
      logger.error('Idle consolidation failed', { error: err })
    )
  }, IDLE_THRESHOLD_MS)
}

/**
 * Initialize the consolidation engine.
 * Sets up the idle timer and runs initial check.
 */
export function initConsolidation(): void {
  // Run initial check (may have been > 24h since last run)
  runConsolidationIfDue().catch(err =>
    logger.error('Initial consolidation check failed', { error: err })
  )

  // Start idle timer
  resetIdleTimer()

  // Reset on user activity events
  if (typeof window !== 'undefined') {
    const reset = () => resetIdleTimer()
    window.addEventListener('keydown', reset, { passive: true })
    window.addEventListener('click', reset, { passive: true })
    window.addEventListener('scroll', reset, { passive: true })
  }

  logger.info('Consolidation engine initialized')
}
