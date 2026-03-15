/**
 * GraphEventBus — Graph-Aware Event System
 *
 * Extends the existing eventBus pattern with:
 * - Typed graph mutation events (node/edge CRUD)
 * - Table change notifications for reactive queries
 * - MessagePort channels for worker/iframe communication
 * - Event batching (group mutations → single tables:changed)
 * - Bidirectional bridge to old eventBus
 * - window.dispatchEvent for external web components
 *
 * ARCHITECTURE:
 * Internal React components: graphEventBus.on('graph:node:created', handler)
 * External Web Components: window.addEventListener('ramble:graph:node:created', handler)
 * Workers/iframes: graphEventBus.addChannel(port) → port.onmessage
 */

import type { GraphEventPayloads, GraphEventName, GraphEventHandler } from './types'

class GraphEventBus {
  private handlers = new Map<string, Set<GraphEventHandler<never>>>()
  private channels: MessagePort[] = []

  // Batching state
  private isBatching = false
  private batchedTables = new Set<string>()

  // ==========================================================================
  // Subscribe / Emit
  // ==========================================================================

  /**
   * Subscribe to a graph event.
   * @returns Unsubscribe function
   */
  on<K extends GraphEventName>(
    event: K,
    handler: GraphEventHandler<K>
  ): () => void {
    const key = event as string
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set())
    }
    this.handlers.get(key)!.add(handler as GraphEventHandler<never>)

    return () => this.handlers.get(key)?.delete(handler as GraphEventHandler<never>)
  }

  /**
   * Emit a graph event.
   *
   * Triple dispatch:
   * 1. Internal handlers (fast, typed)
   * 2. MessagePort channels (worker/iframe)
   * 3. Window CustomEvent with 'ramble:' prefix (external web components)
   */
  emit<K extends GraphEventName>(event: K, payload: GraphEventPayloads[K]): void {
    const key = event as string

    // 1. Internal handlers
    this.handlers.get(key)?.forEach(h => h(payload as never))

    // 2. MessagePort channels
    for (const port of this.channels) {
      port.postMessage({ event: key, payload })
    }

    // 3. Window CustomEvent (if in browser)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(`ramble:${key}`, {
          detail: payload,
          bubbles: false,
          cancelable: false,
        })
      )
    }

    // Track affected tables during batching
    if (this.isBatching && key !== 'graph:tables:changed') {
      this.batchedTables.add(this.eventToTable(key))
    }
  }

  // ==========================================================================
  // Event Batching
  // ==========================================================================

  /**
   * Group multiple mutations into one `graph:tables:changed` event.
   * Use this when performing multiple related writes.
   *
   * Usage:
   *   await graphEventBus.batch(async () => {
   *     emit('graph:node:created', ...)
   *     emit('graph:edge:created', ...)
   *   })
   *   // One tables:changed event fires after the callback completes
   */
  async batch(fn: () => void | Promise<void>): Promise<void> {
    const wasBatching = this.isBatching
    this.isBatching = true

    try {
      await fn()
    } finally {
      this.isBatching = wasBatching

      // Only flush at the outermost batch level
      if (!wasBatching && this.batchedTables.size > 0) {
        const tables = Array.from(this.batchedTables)
        this.batchedTables.clear()
        this.emit('graph:tables:changed', { tables })
      }
    }
  }

  /**
   * Map event name to table name for tables:changed notifications.
   * If not batching, individual mutations also fire tables:changed.
   */
  private eventToTable(eventName: string): string {
    if (eventName.includes('node')) return 'nodes'
    if (eventName.includes('edge')) return 'edges'
    return 'unknown'
  }

  /**
   * Emit a tables:changed event for non-batched single mutations.
   * Call this after each individual mutation when not inside a batch().
   */
  emitTableChange(tables: string[]): void {
    if (this.isBatching) {
      for (const t of tables) this.batchedTables.add(t)
    } else {
      this.emit('graph:tables:changed', { tables })
    }
  }

  // ==========================================================================
  // MessagePort Channels
  // ==========================================================================

  /**
   * Add a MessagePort for cross-context communication.
   * Events emitted on this bus will be forwarded to the port.
   * Messages received on the port will be emitted on this bus.
   */
  addChannel(port: MessagePort): () => void {
    this.channels.push(port)

    // Forward incoming messages from the port to this bus
    port.onmessage = (event: MessageEvent) => {
      const { event: eventName, payload } = event.data as {
        event: GraphEventName
        payload: GraphEventPayloads[GraphEventName]
      }
      if (eventName) {
        // Emit locally but don't re-forward to ports (avoid loops)
        const key = eventName as string
        this.handlers.get(key)?.forEach(h => h(payload as never))

        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(`ramble:${key}`, {
              detail: payload,
              bubbles: false,
              cancelable: false,
            })
          )
        }
      }
    }

    port.start()

    // Return cleanup function
    return () => {
      const idx = this.channels.indexOf(port)
      if (idx !== -1) this.channels.splice(idx, 1)
      port.close()
    }
  }

  // ==========================================================================
  // Utilities
  // ==========================================================================

  hasListeners(event: string): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0
  }

  clear(event?: string): void {
    if (event) {
      this.handlers.delete(event)
    } else {
      this.handlers.clear()
    }
  }
}

/** Singleton instance */
export const graphEventBus = new GraphEventBus()

// Expose to browser console for debugging
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).graphEventBus = graphEventBus
}
