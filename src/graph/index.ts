/**
 * Knowledge Graph — Public API
 *
 * Re-exports the GraphService singleton and all graph types.
 * Manages the EmbeddingListener lifecycle (starts with graph, stops on close).
 *
 * Usage:
 *   import { getGraphService } from '../graph'
 *   const graph = await getGraphService()
 */

import { GraphService } from './GraphService'
import { EmbeddingListener } from './embeddings/EmbeddingListener'

export { GraphService } from './GraphService'
export { EmbeddingListener } from './embeddings/EmbeddingListener'
export type {
  GraphNode,
  GraphEdge,
  GraphEvent,
  GraphSnapshot,
  GraphBranch,
  GraphConversation,
  WorkingContextEntry,
  CognitiveProperties,
  EntityProperties,
  TopicProperties,
  GoalProperties,
  KGSubset,
  MemoryState,
  MemoryOrigin,
} from './types'

// Embedding listener singleton — started lazily alongside graph
let embeddingListener: EmbeddingListener | null = null

/** Convenience alias — delegates to GraphService.getInstance() */
export const getGraphService = GraphService.getInstance.bind(GraphService)

/** Convenience alias — delegates to GraphService.closeInstance() */
export const closeGraphService = GraphService.closeInstance.bind(GraphService)

/**
 * Get (or create) the EmbeddingListener.
 * Starts listening on first call. Requires graph to be initialized.
 */
export async function getEmbeddingListener(): Promise<EmbeddingListener> {
  if (embeddingListener) return embeddingListener

  const graph = await getGraphService()
  embeddingListener = new EmbeddingListener(graph, {
    batchSize: 10,
    debounceMs: 2000,
  })
  embeddingListener.start()
  return embeddingListener
}

/**
 * Stop and clear the embedding listener.
 */
export function stopEmbeddingListener(): void {
  if (embeddingListener) {
    embeddingListener.stop()
    embeddingListener = null
  }
}

// Expose to browser console for debugging
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).getGraphService = getGraphService
}

// Release OPFS sync access handle before page unload — prevents stale locks on reload.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Stop embedding listener synchronously
    stopEmbeddingListener()
    // Synchronous: terminate the worker immediately to release OPFS handles.
    // Can't await async close here — beforeunload doesn't wait for promises.
    GraphService.terminateNow()
  })
}

// Vite HMR cleanup — release old worker's OPFS handle before hot reload creates a new one.
if (import.meta.hot) {
  import.meta.hot.dispose(async () => {
    console.log('[GraphService] HMR dispose — closing instance')
    stopEmbeddingListener()
    try {
      await GraphService.closeInstance()
    } catch (err) {
      console.warn('[GraphService] HMR dispose error (non-fatal):', err)
    }
  })
}
