/**
 * Backfill Service — replays existing conversations through tree curation
 * to populate knowledge trees from historical data.
 *
 * Uses useSyncExternalStore-compatible listener pattern (not RxJS).
 *
 * Progress is checkpointed to localStorage so a page reload doesn't lose
 * progress. On reload the service restores into a 'paused' state —
 * the user can hit Resume to continue or Start to begin fresh.
 */

import { database } from '../../db/database'
import { entityStore, cooccurrenceStore } from '../../db/stores'
import { editTrees } from './treeEditor'
import { isEligibleForTree } from './entityFilter'
import type Conversation from '../../db/models/Conversation'
import type Memory from '../../db/models/Memory'
import { Q } from '@nozbe/watermelondb'

// ============================================================================
// Types
// ============================================================================

export interface BackfillLogEntry {
  timestamp: number
  entityName: string
  entityId: string
  actionType: string
  nodeLabel?: string
  nodeId?: string
  detail?: string
}

export interface BackfillStats {
  treesUpdated: number
  nodesCreated: number
  actionsApplied: Record<string, number>
  errors: number
}

export interface BackfillState {
  status: 'idle' | 'running' | 'paused' | 'complete'
  processedCount: number
  totalCount: number
  currentConversationText: string | null
  stats: BackfillStats
  log: BackfillLogEntry[]
  elapsedMs: number
}

// ============================================================================
// Checkpoint persistence
// ============================================================================

const CHECKPOINT_KEY = 'ramble:backfill-checkpoint'
const MAX_LOG_PERSIST = 50

interface BackfillCheckpoint {
  processedCount: number
  totalCount: number
  /** Timestamp of the last processed conversation — used to skip on resume */
  lastConvTimestamp: number
  stats: BackfillStats
  treesUpdatedIds: string[]
  log: BackfillLogEntry[]
  elapsedMs: number
  delayMs: number
}

function saveCheckpoint(cp: BackfillCheckpoint): void {
  try {
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp))
  } catch { /* quota exceeded — non-fatal */ }
}

function loadCheckpoint(): BackfillCheckpoint | null {
  try {
    const raw = localStorage.getItem(CHECKPOINT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearCheckpoint(): void {
  localStorage.removeItem(CHECKPOINT_KEY)
}

// ============================================================================
// Backfill Service
// ============================================================================

type Listener = () => void

class BackfillService {
  private _state: BackfillState = {
    status: 'idle',
    processedCount: 0,
    totalCount: 0,
    currentConversationText: null,
    stats: { treesUpdated: 0, nodesCreated: 0, actionsApplied: {}, errors: 0 },
    log: [],
    elapsedMs: 0,
  }
  private _treesUpdatedSet = new Set<string>()
  private _listeners = new Set<Listener>()
  private _aborted = false
  private _startTime = 0
  private _priorElapsedMs = 0
  private _timerInterval: ReturnType<typeof setInterval> | null = null
  private _lastConvTimestamp = 0
  delayMs = 500

  constructor() {
    // Restore from checkpoint on construction
    const cp = loadCheckpoint()
    if (cp) {
      this._treesUpdatedSet = new Set(cp.treesUpdatedIds)
      this._lastConvTimestamp = cp.lastConvTimestamp
      this._priorElapsedMs = cp.elapsedMs
      this.delayMs = cp.delayMs
      this._state = {
        status: 'paused',
        processedCount: cp.processedCount,
        totalCount: cp.totalCount,
        currentConversationText: null,
        stats: cp.stats,
        log: cp.log,
        elapsedMs: cp.elapsedMs,
      }
    }
  }

  // ---- useSyncExternalStore API ----

  getState = (): BackfillState => this._state

  subscribe = (fn: Listener): (() => void) => {
    this._listeners.add(fn)
    return () => this._listeners.delete(fn)
  }

  private notify(): void {
    this._listeners.forEach(fn => fn())
  }

  private updateState(patch: Partial<BackfillState>): void {
    this._state = { ...this._state, ...patch }
    this.notify()
  }

  // ---- Checkpoint ----

  private persistCheckpoint(): void {
    saveCheckpoint({
      processedCount: this._state.processedCount,
      totalCount: this._state.totalCount,
      lastConvTimestamp: this._lastConvTimestamp,
      stats: this._state.stats,
      treesUpdatedIds: [...this._treesUpdatedSet],
      log: this._state.log.slice(-MAX_LOG_PERSIST),
      elapsedMs: this._state.elapsedMs,
      delayMs: this.delayMs,
    })
  }

  // ---- Controls ----

  /** Start fresh — clears any existing checkpoint */
  async start(): Promise<void> {
    if (this._state.status === 'running') return

    clearCheckpoint()
    this._aborted = false
    this._startTime = Date.now()
    this._priorElapsedMs = 0
    this._treesUpdatedSet.clear()
    this._lastConvTimestamp = 0

    this.updateState({
      status: 'running',
      processedCount: 0,
      totalCount: 0,
      currentConversationText: null,
      stats: { treesUpdated: 0, nodesCreated: 0, actionsApplied: {}, errors: 0 },
      log: [],
      elapsedMs: 0,
    })

    await this.runLoop()
  }

  pause(): void {
    if (this._state.status === 'running') {
      this.updateState({ status: 'paused' })
      this.persistCheckpoint()
    }
  }

  /** Resume from current position (works after pause or page reload) */
  async resume(): Promise<void> {
    if (this._state.status !== 'paused') return

    this._aborted = false
    this._startTime = Date.now()
    this._priorElapsedMs = this._state.elapsedMs
    this.updateState({ status: 'running' })

    await this.runLoop()
  }

  stop(): void {
    this._aborted = true
    if (this._timerInterval) {
      clearInterval(this._timerInterval)
      this._timerInterval = null
    }
    clearCheckpoint()
    this.updateState({ status: 'idle', currentConversationText: null })
  }

  // ---- Core Logic ----

  private async runLoop(): Promise<void> {
    // Timer for elapsed time
    this._timerInterval = setInterval(() => {
      this.updateState({ elapsedMs: this._priorElapsedMs + (Date.now() - this._startTime) })
    }, 1000)

    try {
      await this.run()
    } finally {
      if (this._timerInterval) {
        clearInterval(this._timerInterval)
        this._timerInterval = null
      }
      this.updateState({ elapsedMs: this._priorElapsedMs + (Date.now() - this._startTime) })
    }
  }

  private async run(): Promise<void> {
    // 1. Load all conversations, oldest first
    const conversations = await database
      .get<Conversation>('conversations')
      .query(Q.sortBy('timestamp', Q.asc))
      .fetch()

    // Skip past already-processed conversations when resuming
    const resumeTimestamp = this._lastConvTimestamp
    const startIndex = resumeTimestamp > 0
      ? conversations.findIndex(c => c.timestamp > resumeTimestamp)
      : 0
    const remaining = startIndex < 0 ? [] : conversations.slice(startIndex)

    this.updateState({ totalCount: conversations.length })

    // 2. Load all memories and build lookup by conversationId
    const allMemories = await database
      .get<Memory>('memories')
      .query()
      .fetch()

    const memoriesByConvId = new Map<string, Memory[]>()
    for (const mem of allMemories) {
      for (const convId of mem.sourceConversationIdsParsed) {
        if (!memoriesByConvId.has(convId)) memoriesByConvId.set(convId, [])
        memoriesByConvId.get(convId)!.push(mem)
      }
    }

    // 3. Process remaining conversations
    for (const conv of remaining) {
      if (this._aborted) break

      // Handle pause
      while (this._state.status === 'paused' && !this._aborted) {
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      if (this._aborted) break

      this.updateState({
        currentConversationText: conv.rawText?.slice(0, 80) ?? null,
      })

      try {
        const memories = memoriesByConvId.get(conv.id) ?? []
        if (memories.length === 0) {
          this._lastConvTimestamp = conv.timestamp
          this.updateState({ processedCount: this._state.processedCount + 1 })
          this.persistCheckpoint()
          continue
        }

        // Find entities referenced by these memories
        const entityIds = new Set<string>()
        for (const mem of memories) {
          for (const eid of mem.entityIdsParsed) {
            entityIds.add(eid)
          }
        }

        // Filter to eligible entities (user always qualifies, others need mentionCount >= 3, no generics)
        const entities = await Promise.all(
          [...entityIds].map(id => entityStore.getById(id))
        )
        const eligibilityChecks = await Promise.all(
          entities.map(async e => e ? await isEligibleForTree(e) : false)
        )
        const eligible = entities.filter((_, i) => eligibilityChecks[i])

        // Increment co-occurrences
        const eligibleIds = eligible.map(e => e!.id)
        for (let i = 0; i < eligibleIds.length; i++) {
          for (let j = i + 1; j < eligibleIds.length; j++) {
            await cooccurrenceStore.increment(
              eligibleIds[i], eligibleIds[j],
              conv.rawText?.slice(0, 100) ?? ''
            )
          }
        }

        // Edit trees for all eligible entities in one pass
        if (eligible.length > 0 && !this._aborted) {
          // Derive topicIds from memories
          const topicIdSet = new Set<string>()
          for (const mem of memories) {
            for (const tid of mem.topicIdsParsed) topicIdSet.add(tid)
          }

          const result = await editTrees({
            entityIds: eligible.filter(Boolean).map(e => e!.id),
            topicIds: [...topicIdSet],
            memoryIds: memories.map(m => m.id),
            conversationId: conv.id,
            intent: 'inform',
          })

          // Log results
          const newLog = [...this._state.log]
          const newStats = { ...this._state.stats, actionsApplied: { ...this._state.stats.actionsApplied } }

          newLog.push({
            timestamp: Date.now(),
            entityName: eligible.map(e => e!.name).join(', '),
            entityId: eligible[0]!.id,
            actionType: 'edit-trees',
            detail: `proposed: ${result.actionsProposed}, applied: ${result.actionsApplied}`,
          })

          for (const eid of eligible) {
            if (eid) this._treesUpdatedSet.add(eid.id)
          }
          newStats.treesUpdated = this._treesUpdatedSet.size
          newStats.nodesCreated += result.actionsApplied

          this.updateState({ stats: newStats, log: newLog })
        }
      } catch (err) {
        const newLog = [...this._state.log]
        newLog.push({
          timestamp: Date.now(),
          entityName: 'ERROR',
          entityId: '',
          actionType: 'error',
          detail: String(err),
        })
        const newStats = { ...this._state.stats, errors: this._state.stats.errors + 1 }
        this.updateState({ stats: newStats, log: newLog })
      }

      this._lastConvTimestamp = conv.timestamp
      this.updateState({ processedCount: this._state.processedCount + 1 })
      this.persistCheckpoint()

      // Rate limiting delay
      if (this.delayMs > 0 && !this._aborted) {
        await new Promise(resolve => setTimeout(resolve, this.delayMs))
      }
    }

    if (!this._aborted) {
      clearCheckpoint()
      this.updateState({ status: 'complete', currentConversationText: null })
    }
  }
}

export const backfillService = new BackfillService()
