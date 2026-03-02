/**
 * Decay Service
 *
 * Thin wrapper — decay logic has moved to the Consolidation Engine
 * (`src/program/kernel/consolidation.ts`), which handles decay as part of
 * its periodic maintenance pass (entity dedup, near-duplicate detection,
 * and decay — all in one "sleep" cycle).
 *
 * What remains here:
 *
 * 1. runV4PostMigrationIfNeeded() — one-time data fix for memories created
 *    before v4. Sets state, activityScore, ownershipScore on all existing records.
 *    Guarded by 'migration_v4_done' key in the data store — fully idempotent.
 *
 * 2. runDecayIfDue() — @deprecated, delegates to consolidation engine.
 *    Kept for backward compatibility with BentoApp.tsx call site.
 *    Will be removed once all callers switch to initConsolidation().
 */

import { database } from '../../db/database'
import { dataStore } from '../../db/stores'
import Memory from '../../db/models/Memory'
import { runConsolidationIfDue } from '../kernel/consolidation'

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
// Decay pass (delegated to Consolidation Engine)
// ============================================================================

/**
 * @deprecated Use `initConsolidation()` from `src/program/kernel/consolidation.ts` instead.
 * Decay is now part of the consolidation engine's periodic maintenance pass.
 * This function delegates to `runConsolidationIfDue()` for backward compatibility.
 */
export async function runDecayIfDue(): Promise<void> {
  try {
    await runConsolidationIfDue()
  } catch (error) {
    console.error('[Decay] Decay pass failed:', error)
  }
}

