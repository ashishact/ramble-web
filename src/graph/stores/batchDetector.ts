/**
 * Batch Detector — Time-Gap Conversation Grouping
 *
 * Groups incoming conversations into batches based on silence gaps.
 * When a gap exceeds the threshold, the accumulated batch is "ready"
 * and the callback is invoked with a batch ID.
 *
 * Rules:
 * - gapThresholdMs: silence > this triggers batch (default: 30s)
 * - maxBatchSize: force batch at this count (default: 10)
 * - maxWaitMs: force batch after this time since first item (default: 60s)
 */

import { nid } from '../../program/utils/id'

export interface BatchDetectorConfig {
  gapThresholdMs: number
  maxBatchSize: number
  maxWaitMs: number
  onBatchReady: (batchId: string, conversationIds: string[]) => void
}

const DEFAULT_CONFIG: Omit<BatchDetectorConfig, 'onBatchReady'> = {
  gapThresholdMs: 30_000,
  maxBatchSize: 10,
  maxWaitMs: 60_000,
}

export class BatchDetector {
  private config: BatchDetectorConfig
  private currentBatchId: string
  private conversationIds: string[] = []
  private firstItemTime: number | null = null
  private lastItemTime: number | null = null
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null

  constructor(config: Partial<BatchDetectorConfig> & Pick<BatchDetectorConfig, 'onBatchReady'>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.currentBatchId = nid.batch()
  }

  /**
   * Add a new conversation to the current batch.
   * Resets the gap timer. May trigger batch if at capacity.
   */
  add(conversationId: string): string {
    const now = Date.now()

    // If gap since last item exceeds threshold, flush first
    if (this.lastItemTime && (now - this.lastItemTime) > this.config.gapThresholdMs) {
      this.flush()
    }

    this.conversationIds.push(conversationId)
    this.lastItemTime = now

    if (!this.firstItemTime) {
      this.firstItemTime = now
      this.startMaxWaitTimer()
    }

    // Reset gap timer
    this.resetGapTimer()

    // Force flush if at max batch size
    if (this.conversationIds.length >= this.config.maxBatchSize) {
      this.flush()
    }

    return this.currentBatchId
  }

  /**
   * Flush the current batch (if non-empty) and start a new one.
   */
  flush(): void {
    this.clearTimers()

    if (this.conversationIds.length > 0) {
      const batchId = this.currentBatchId
      const ids = [...this.conversationIds]

      // Reset state
      this.conversationIds = []
      this.firstItemTime = null
      this.lastItemTime = null
      this.currentBatchId = nid.batch()

      // Invoke callback
      this.config.onBatchReady(batchId, ids)
    }
  }

  /** Current batch ID (for tagging new conversations) */
  get currentBatch(): string {
    return this.currentBatchId
  }

  /** Number of conversations in the current batch */
  get pendingCount(): number {
    return this.conversationIds.length
  }

  destroy(): void {
    this.clearTimers()
  }

  // ==========================================================================
  // Timers
  // ==========================================================================

  private resetGapTimer(): void {
    if (this.gapTimer) clearTimeout(this.gapTimer)
    this.gapTimer = setTimeout(() => {
      this.flush()
    }, this.config.gapThresholdMs)
  }

  private startMaxWaitTimer(): void {
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer)
    this.maxWaitTimer = setTimeout(() => {
      this.flush()
    }, this.config.maxWaitMs)
  }

  private clearTimers(): void {
    if (this.gapTimer) {
      clearTimeout(this.gapTimer)
      this.gapTimer = null
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer)
      this.maxWaitTimer = null
    }
  }
}
