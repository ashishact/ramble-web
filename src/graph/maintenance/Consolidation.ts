/**
 * Consolidation — Periodic Knowledge Maintenance for DuckDB Graph
 *
 * Replaces the WatermelonDB consolidation engine with graph-native operations:
 *
 * 1. runDecay() — Exponential decay on activity/confidence/importance
 * 2. runConfidenceDecay() — Provisional memories lose confidence over time
 * 3. findNearDuplicates() — Bigram Dice similarity, reinforce or supersede
 * 4. deduplicateEntities() — Same name, different case → merge
 * 5. compactEventLog() — Prune old deltas, keep snapshots
 */

import type { GraphService } from '../GraphService'
import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import type { GraphNode, CognitiveProperties, EntityProperties } from '../types'
import { decayActivityScore, applyReinforcement } from '../merge/cognitiveHelpers'
import { createLogger } from '../../program/utils/logger'

const logger = createLogger('Consolidation')

// ============================================================================
// Similarity Helper (same as old consolidation.ts)
// ============================================================================

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const aBigrams = new Set<string>()
  const bBigrams = new Set<string>()
  const aLower = a.toLowerCase()
  const bLower = b.toLowerCase()
  for (let i = 0; i < aLower.length - 1; i++) aBigrams.add(aLower.slice(i, i + 2))
  for (let i = 0; i < bLower.length - 1; i++) bBigrams.add(bLower.slice(i, i + 2))
  let intersection = 0
  for (const bigram of aBigrams) { if (bBigrams.has(bigram)) intersection++ }
  return (2 * intersection) / (aBigrams.size + bBigrams.size)
}

// ============================================================================
// Consolidation
// ============================================================================

export interface ConsolidationResult {
  entitiesMerged: number
  duplicatesFound: number
  decayed: number
  eventsCompacted: number
  timestamp: number
}

export class Consolidation {
  private graph: GraphService
  private reactive: ReactiveGraphService

  constructor(graph: GraphService, reactive: ReactiveGraphService) {
    this.graph = graph
    this.reactive = reactive
  }

  /**
   * Run the full consolidation pass.
   */
  async run(): Promise<ConsolidationResult> {
    logger.info('Starting consolidation pass...')
    const startTime = Date.now()

    const entitiesMerged = await this.deduplicateEntities()
    const duplicatesFound = await this.findNearDuplicates()
    const decayed = await this.runDecay()
    const eventsCompacted = await this.compactEventLog()

    const result: ConsolidationResult = {
      entitiesMerged,
      duplicatesFound,
      decayed,
      eventsCompacted,
      timestamp: Date.now(),
    }

    logger.info('Consolidation complete', {
      ...result,
      durationMs: Date.now() - startTime,
    })

    return result
  }

  // ==========================================================================
  // Decay
  // ==========================================================================

  /**
   * Run exponential decay on all active memories.
   * activity: exp(-0.15 * days), zero if <0.01
   * confidence: 0.9x per 30 days for provisional
   * importance: 0.95x per 180 days for events
   */
  async runDecay(): Promise<number> {
    const memories = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'memory')
       AND json_extract_string(properties, '$.state') NOT IN ('retracted', 'superseded')`
    )

    let decayed = 0
    const now = Date.now()

    for (const node of memories) {
      const props = node.properties as unknown as CognitiveProperties
      const daysSince = (now - props.lastReinforced) / 86_400_000
      let changed = false
      const updates: Record<string, unknown> = { ...node.properties }

      // Activity decay
      if (props.activityScore > 0.01) {
        const newActivity = decayActivityScore(props.activityScore, props.lastReinforced)
        if (newActivity !== props.activityScore) {
          (updates as Record<string, unknown>).activityScore = newActivity
          changed = true
        }
      }

      // Confidence decay for provisional
      if (props.state === 'provisional' && daysSince > 30) {
        (updates as Record<string, unknown>).confidence = props.confidence * 0.9
        changed = true
      }

      // Importance decay for old events
      if (props.type === 'event' && daysSince > 180) {
        (updates as Record<string, unknown>).importance = props.importance * 0.95
        changed = true
      }

      if (changed) {
        await this.graph.exec(
          `UPDATE nodes SET properties = $1, updated_at = $2 WHERE id = $3`,
          [JSON.stringify(updates), now, node.id]
        )
        decayed++
      }
    }

    return decayed
  }

  // ==========================================================================
  // Near-Duplicate Detection
  // ==========================================================================

  /**
   * Find near-duplicate memories using bigram Dice coefficient.
   * >= 0.95: reinforce (same info seen again)
   * 0.80-0.94: supersede (slightly different, newer wins)
   */
  async findNearDuplicates(): Promise<number> {
    const memories = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'memory')
       AND json_extract_string(properties, '$.state') NOT IN ('retracted', 'superseded')
       ORDER BY updated_at DESC LIMIT 200`
    )

    let found = 0
    const processed = new Set<string>()

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue
      const propsI = memories[i].properties as unknown as CognitiveProperties

      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue
        const propsJ = memories[j].properties as unknown as CognitiveProperties

        if (propsI.type !== propsJ.type) continue

        const sim = stringSimilarity(propsI.content, propsJ.content)
        if (sim >= 0.95) {
          // Reinforce the newer one
          const newer = memories[i].updated_at >= memories[j].updated_at ? memories[i] : memories[j]
          const older = newer === memories[i] ? memories[j] : memories[i]
          const newerProps = newer.properties as unknown as CognitiveProperties

          const reinforced = applyReinforcement({
            importance: newerProps.importance,
            activityScore: newerProps.activityScore,
            reinforceCount: newerProps.reinforceCount,
            state: newerProps.state,
          })

          await this.reactive.updateNode(newer.id, {
            properties: { ...newer.properties, ...reinforced },
          })

          processed.add(older.id)
          found++
        } else if (sim >= 0.80) {
          // Supersede older with newer
          const newer = memories[i].updated_at >= memories[j].updated_at ? memories[i] : memories[j]
          const older = newer === memories[i] ? memories[j] : memories[i]

          await this.reactive.updateNode(older.id, {
            properties: { ...older.properties, state: 'superseded', supersededBy: newer.id },
          })

          processed.add(older.id)
          found++
        }
      }
    }

    return found
  }

  // ==========================================================================
  // Entity Dedup
  // ==========================================================================

  /**
   * Merge entities with same name but different casing.
   * Keeps the entity with highest mentionCount.
   */
  async deduplicateEntities(): Promise<number> {
    const entities = await this.graph.findNodesByLabel('entity')
    if (entities.length === 0) return 0

    const groups = new Map<string, GraphNode[]>()
    for (const entity of entities) {
      const props = entity.properties as unknown as EntityProperties
      const key = props.name.toLowerCase()
      const group = groups.get(key) ?? []
      group.push(entity)
      groups.set(key, group)
    }

    let merged = 0
    for (const [, group] of groups) {
      if (group.length <= 1) continue

      // Sort by mentionCount DESC
      group.sort((a, b) => {
        const propsA = a.properties as unknown as EntityProperties
        const propsB = b.properties as unknown as EntityProperties
        return (propsB.mentionCount ?? 0) - (propsA.mentionCount ?? 0)
      })

      const primary = group[0]
      for (let i = 1; i < group.length; i++) {
        const dup = group[i]
        // Relink edges from dup → primary
        await this.graph.exec(
          `UPDATE edges SET start_id = $1, updated_at = $2 WHERE start_id = $3`,
          [primary.id, Date.now(), dup.id]
        )
        await this.graph.exec(
          `UPDATE edges SET end_id = $1, updated_at = $2 WHERE end_id = $3`,
          [primary.id, Date.now(), dup.id]
        )
        // Delete duplicate node
        await this.reactive.deleteNode(dup.id)
        merged++
      }
    }

    return merged
  }

  // ==========================================================================
  // Event Log Compaction
  // ==========================================================================

  /**
   * Compact the event log by removing old deltas that are covered by snapshots.
   * Keeps events newer than 30 days or that have no covering snapshot.
   */
  async compactEventLog(): Promise<number> {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

    // Delete old events that have snapshots covering them
    const result = await this.graph.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM events
       WHERE timestamp < $1
       AND target_id IN (SELECT target_id FROM snapshots WHERE timestamp > events.timestamp)`,
      [thirtyDaysAgo]
    )

    const count = result[0]?.cnt ?? 0

    if (count > 0) {
      await this.graph.exec(
        `DELETE FROM events
         WHERE timestamp < $1
         AND target_id IN (SELECT target_id FROM snapshots WHERE timestamp > events.timestamp)`,
        [thirtyDaysAgo]
      )
    }

    return count
  }
}
