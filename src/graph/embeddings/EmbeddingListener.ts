/**
 * EmbeddingListener — Queue-Based Background Embedder
 *
 * Listens to graph:node:created and graph:node:updated events,
 * queues node IDs, and processes them in batches of K.
 *
 * Queue behavior:
 * - Events add node IDs to the queue (deduplicated)
 * - After a quiet period (debounce), processing starts
 * - Takes up to K items from the queue per batch
 * - After each batch completes, checks queue for more work
 * - Continues until queue is drained
 *
 * Decoupled from kernel — any source of node changes gets embeddings.
 */

import type { GraphService } from '../GraphService'
import { graphEventBus } from '../events'
import { EmbeddingService } from './EmbeddingService'
import { telemetry } from '../../program/telemetry'

// ============================================================================
// EmbeddingListener
// ============================================================================

export class EmbeddingListener {
  private embeddingService: EmbeddingService
  private queue: string[] = []
  private queueSet = new Set<string>() // for O(1) dedup
  private timer: ReturnType<typeof setTimeout> | null = null
  private processing = false
  private unsubscribers: Array<() => void> = []

  private debounceMs: number
  private batchSize: number

  constructor(graph: GraphService, opts?: {
    debounceMs?: number
    batchSize?: number
    model?: string
  }) {
    this.debounceMs = opts?.debounceMs ?? 2000
    this.batchSize = opts?.batchSize ?? 10
    this.embeddingService = new EmbeddingService(graph, opts?.model)
  }

  /**
   * Start listening to graph events.
   */
  start(): void {
    const unsub1 = graphEventBus.on('graph:node:created', ({ node }) => {
      this.enqueue(node.id)
    })

    const unsub2 = graphEventBus.on('graph:node:updated', ({ nodeId }) => {
      this.enqueue(nodeId)
    })

    this.unsubscribers.push(unsub1, unsub2)
    console.log(`[EmbeddingListener] Started — batch size: ${this.batchSize}, debounce: ${this.debounceMs}ms`)
  }

  /**
   * Stop listening and cancel pending work.
   */
  stop(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers = []

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    this.queue = []
    this.queueSet.clear()
    console.log('[EmbeddingListener] Stopped')
  }

  /**
   * Get the underlying EmbeddingService (for VectorSearch, manual use, etc.)
   */
  getService(): EmbeddingService {
    return this.embeddingService
  }

  /**
   * Current queue depth.
   */
  get pending(): number {
    return this.queue.length
  }

  /**
   * Whether the listener is currently processing a batch.
   */
  get isProcessing(): boolean {
    return this.processing
  }

  // ==========================================================================
  // Queue management
  // ==========================================================================

  private enqueue(nodeId: string): void {
    if (this.queueSet.has(nodeId)) return // dedup
    this.queue.push(nodeId)
    this.queueSet.add(nodeId)
    this.scheduleProcess()
  }

  private scheduleProcess(): void {
    if (this.processing) return // will drain after current batch

    // Reset debounce timer — wait for quiet period before starting
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.processNext()
    }, this.debounceMs)
  }

  // ==========================================================================
  // Batch processing loop
  // ==========================================================================

  private processNext(): void {
    if (this.processing || this.queue.length === 0) return

    // Take up to K items from front of queue
    const batch = this.queue.splice(0, this.batchSize)
    for (const id of batch) this.queueSet.delete(id)

    this.processing = true
    const remaining = this.queue.length

    console.log(`[EmbeddingListener] Processing batch of ${batch.length} (${remaining} remaining in queue)`)

    // Fire-and-forget — never blocks anything
    void (async () => {
      telemetry.emit('embedding', 'embed-nodes', 'start', {
        nodeCount: batch.length,
        queueRemaining: remaining,
        model: 'bge-small-en-v1.5',
      })

      try {
        const embedded = await this.embeddingService.embedNodes(batch)

        telemetry.emit('embedding', 'embed-nodes', 'end', {
          nodeCount: batch.length,
          embedded,
          queueRemaining: this.queue.length,
        }, { status: 'success' })

        console.log(`[EmbeddingListener] Batch done: ${embedded}/${batch.length} embedded (${this.queue.length} remaining)`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        telemetry.emit('embedding', 'embed-nodes', 'end', {
          nodeCount: batch.length,
          error: msg,
        }, { status: 'error' })

        console.warn('[EmbeddingListener] Batch failed (non-fatal):', msg)
      } finally {
        this.processing = false

        // If queue has more items, process next batch immediately
        if (this.queue.length > 0) {
          this.processNext()
        }
      }
    })()
  }
}
