/**
 * Observer Queue System
 *
 * Manages the queue of messages to be processed by observers.
 * - Processes immediately when idle
 * - Accumulates messages while processing
 * - Triggers observers in sequence: Knowledge → Suggestion
 */

import { observerHelpers } from '../../stores/observerStore';

export interface QueueItem {
  messageIds: string[];
  sessionId: string;
}

export type QueueStatus = 'idle' | 'processing';

export interface ObserverQueueCallbacks {
  onStatusChange?: (status: QueueStatus, description?: string) => void;
  onKnowledgeProcessed?: (sessionId: string, messageIds: string[]) => void;
  onSuggestionProcessed?: (sessionId: string) => void;
  onError?: (error: Error, phase: 'knowledge' | 'suggestion') => void;
}

// Queue state
let queue: QueueItem[] = [];
let status: QueueStatus = 'idle';
let callbacks: ObserverQueueCallbacks = {};
let isProcessing = false;

// Observer functions (to be set by the API module)
let knowledgeObserverFn: ((sessionId: string, messageIds: string[]) => Promise<void>) | null = null;
let suggestionObserverFn: ((sessionId: string) => Promise<void>) | null = null;

/**
 * Set the observer functions
 */
export function setObservers(
  knowledgeObserver: (sessionId: string, messageIds: string[]) => Promise<void>,
  suggestionObserver: (sessionId: string) => Promise<void>
) {
  knowledgeObserverFn = knowledgeObserver;
  suggestionObserverFn = suggestionObserver;
}

/**
 * Set callbacks for queue events
 */
export function setQueueCallbacks(newCallbacks: ObserverQueueCallbacks) {
  callbacks = newCallbacks;
}

/**
 * Get current queue status
 */
export function getQueueStatus(): QueueStatus {
  return status;
}

/**
 * Get queue length
 */
export function getQueueLength(): number {
  return queue.length;
}

/**
 * Enqueue a message for processing
 * If idle, starts processing immediately
 * If processing, message will be picked up in the next batch
 */
export function enqueue(messageId: string, sessionId: string): void {
  // Check if there's already a pending item for this session
  const existingItem = queue.find(item => item.sessionId === sessionId);

  if (existingItem) {
    // Add to existing batch
    if (!existingItem.messageIds.includes(messageId)) {
      existingItem.messageIds.push(messageId);
    }
  } else {
    // Create new batch
    queue.push({
      messageIds: [messageId],
      sessionId,
    });
  }

  console.log('[ObserverQueue] Enqueued message:', messageId, 'for session:', sessionId);

  // Start processing if idle
  if (!isProcessing) {
    processNext();
  }
}

/**
 * Enqueue multiple messages at once
 */
export function enqueueMany(messageIds: string[], sessionId: string): void {
  messageIds.forEach(id => enqueue(id, sessionId));
}

/**
 * Process the next item in the queue
 */
async function processNext(): Promise<void> {
  if (isProcessing || queue.length === 0) {
    return;
  }

  isProcessing = true;
  status = 'processing';
  callbacks.onStatusChange?.('processing', 'Processing messages...');

  // Get the next item
  const item = queue.shift()!;
  const { messageIds, sessionId } = item;

  console.log('[ObserverQueue] Processing', messageIds.length, 'messages for session:', sessionId);

  try {
    // Phase 1: Knowledge Observer
    if (knowledgeObserverFn) {
      callbacks.onStatusChange?.('processing', 'Extracting knowledge...');
      await knowledgeObserverFn(sessionId, messageIds);
      callbacks.onKnowledgeProcessed?.(sessionId, messageIds);
    }

    // Phase 2: Suggestion Observer
    if (suggestionObserverFn) {
      callbacks.onStatusChange?.('processing', 'Generating suggestions...');
      await suggestionObserverFn(sessionId);
      callbacks.onSuggestionProcessed?.(sessionId);
    }

    console.log('[ObserverQueue] Completed processing for session:', sessionId);
  } catch (error) {
    console.error('[ObserverQueue] Error processing:', error);
    callbacks.onError?.(error instanceof Error ? error : new Error(String(error)), 'knowledge');
  }

  isProcessing = false;

  // Check if more items were added while processing
  if (queue.length > 0) {
    // Continue processing
    processNext();
  } else {
    status = 'idle';
    callbacks.onStatusChange?.('idle');
  }
}

/**
 * Force process all pending items (for testing)
 */
export async function processAll(): Promise<void> {
  while (queue.length > 0) {
    await processNext();
  }
}

/**
 * Clear the queue (for testing/reset)
 */
export function clearQueue(): void {
  queue = [];
  isProcessing = false;
  status = 'idle';
}

/**
 * Check if a session has any pending messages
 */
export function hasPendingMessages(sessionId: string): boolean {
  return queue.some(item => item.sessionId === sessionId);
}

/**
 * Get all pending message IDs for a session
 */
export function getPendingMessageIds(sessionId: string): string[] {
  const item = queue.find(item => item.sessionId === sessionId);
  return item?.messageIds || [];
}

// ============================================================================
// System 2 Thinker Integration
// ============================================================================

let system2ThinkerFn: ((sessionId: string) => Promise<void>) | null = null;
const KNOWLEDGE_THRESHOLD = 16;

/**
 * Set the System 2 Thinker function
 */
export function setSystem2Thinker(fn: (sessionId: string) => Promise<void>) {
  system2ThinkerFn = fn;
}

/**
 * Check if System 2 Thinker should run
 * Called after knowledge observer completes
 */
export async function checkSystem2Trigger(sessionId: string): Promise<void> {
  if (!system2ThinkerFn) return;

  const count = observerHelpers.getKnowledgeItemCount(sessionId);

  // Run every 16 items
  if (count > 0 && count % KNOWLEDGE_THRESHOLD === 0) {
    console.log('[ObserverQueue] Triggering System 2 Thinker for session:', sessionId);
    callbacks.onStatusChange?.('processing', 'Running deep analysis...');

    try {
      await system2ThinkerFn(sessionId);
      console.log('[ObserverQueue] System 2 Thinker completed for session:', sessionId);
    } catch (error) {
      console.error('[ObserverQueue] System 2 Thinker error:', error);
    }
  }
}

// ============================================================================
// Meta Observer Integration
// ============================================================================

let metaObserverFn: (() => Promise<void>) | null = null;
const META_STORAGE_KEY = 'observer-meta-last-run';

/**
 * Set the Meta Observer function
 */
export function setMetaObserver(fn: () => Promise<void>) {
  metaObserverFn = fn;
}

/**
 * Check if Meta Observer should run (once per day)
 */
export async function checkMetaTrigger(): Promise<void> {
  if (!metaObserverFn) return;

  const lastRun = localStorage.getItem(META_STORAGE_KEY);
  const now = new Date();
  const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

  if (lastRun !== today) {
    console.log('[ObserverQueue] Triggering Meta Observer (daily run)');
    callbacks.onStatusChange?.('processing', 'Analyzing system structure...');

    try {
      await metaObserverFn();
      localStorage.setItem(META_STORAGE_KEY, today);
      console.log('[ObserverQueue] Meta Observer completed');
    } catch (error) {
      console.error('[ObserverQueue] Meta Observer error:', error);
    }
  }
}
