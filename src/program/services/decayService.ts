/**
 * Decay Service
 *
 * Two one-shot maintenance operations that run on page load:
 *
 * 1. runV4PostMigrationIfNeeded() — one-time data fix for memories created
 *    before v4. Sets state, activityScore, ownershipScore on all existing records.
 *    Guarded by 'migration_v4_done' key in the data store — fully idempotent.
 *
 * 2. runDecayIfDue() — runs at most once per 24h, decays:
 *    - confidence on old provisional memories (> 30 days unreinforced)
 *    - importance on old event memories (> 180 days)
 *    - activityScore on all active memories (exponential decay)
 *
 * Both are fire-and-forget — they must not block the UI.
 */

import { database } from '../../db/database'
import { dataStore } from '../../db/stores'
import Memory from '../../db/models/Memory'

const DECAY_INTERVAL_MS = 24 * 60 * 60 * 1000  // 24 hours
const LAST_DECAY_KEY = 'last_decay_run'
const MIGRATION_V4_KEY = 'migration_v4_done'

// ============================================================================
// Post-migration fix (v3 → v4)
// ============================================================================

/**
 * One-time fix for memories that existed before v4.
 * Sets state, activityScore, ownershipScore on historical records.
 * Runs only once, guarded by migration_v4_done flag.
 */
export async function runV4PostMigrationIfNeeded(): Promise<void> {
  try {
    const done = await dataStore.getValue<boolean>(MIGRATION_V4_KEY)
    if (done) return

    const allMemories = await database.get<Memory>('memories').query().fetch()

    if (allMemories.length > 0) {
      await database.write(async () => {
        for (const memory of allMemories) {
          await memory.update((m) => {
            // Set state based on supersession status
            if (m.supersededBy) {
              m.state = 'superseded'
            } else {
              m.state = 'stable'  // All existing memories had reinforcementCount = 1
            }
            // Derive activity score from historical reinforcement count
            m.activityScore = Math.min(1, m.reinforcementCount * 0.1)
            // Neutral ownership for historical data (origin unknown)
            m.ownershipScore = 0.5
          })
        }
      })
    }

    await dataStore.set(MIGRATION_V4_KEY, 'system', true)
    console.log(`[Decay] v4 post-migration fix applied to ${allMemories.length} memories`)
  } catch (error) {
    console.error('[Decay] v4 post-migration fix failed:', error)
    // Non-blocking — don't rethrow; will retry on next page load
  }
}

// ============================================================================
// Decay pass
// ============================================================================

/**
 * Run activity/confidence/importance decay if 24h have elapsed since last run.
 * Fire-and-forget — never throws.
 */
export async function runDecayIfDue(): Promise<void> {
  try {
    const lastRun = await dataStore.getValue<number>(LAST_DECAY_KEY)
    const now = Date.now()

    if (lastRun && now - lastRun < DECAY_INTERVAL_MS) {
      return  // Not due yet
    }

    const allMemories = await database.get<Memory>('memories').query().fetch()

    // Only process memories that will actually change
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

    await dataStore.set(LAST_DECAY_KEY, 'system', now)
    console.log(`[Decay] Decay pass complete: ${toDecay.length}/${allMemories.length} memories updated`)
  } catch (error) {
    console.error('[Decay] Decay pass failed:', error)
    // Non-blocking — don't rethrow
  }
}

