/**
 * Observer System API
 *
 * Exposes functions for:
 * - Testing individual observers
 * - Querying session data
 * - Manual triggers
 *
 * This module also initializes the observer queue with all observers.
 */

import {
  setObservers,
  setSystem2Thinker,
  setMetaObserver,
  setQueueCallbacks,
  enqueue,
  enqueueMany,
  getQueueStatus,
  getQueueLength,
  checkMetaTrigger,
  type QueueStatus,
  type ObserverQueueCallbacks,
} from './observerQueue';
import { processMessages } from './knowledgeObserver';
import { generateSuggestions } from './suggestionObserver';
import { runDeepAnalysis, checkAndRunIfNeeded } from './system2Thinker';
import { runMetaAnalysis } from './metaObserver';
import { observerHelpers } from '../../stores/observerStore';

// ============================================================================
// Initialization
// ============================================================================

let isInitialized = false;

/**
 * Initialize the observer system
 * Call this once on app startup
 */
export function initializeObserverSystem(callbacks?: ObserverQueueCallbacks): void {
  if (isInitialized) {
    console.log('[ObserverAPI] Already initialized');
    return;
  }

  console.log('[ObserverAPI] Initializing observer system...');

  // Set observer functions
  setObservers(processMessages, generateSuggestions);
  setSystem2Thinker(runDeepAnalysis);
  setMetaObserver(runMetaAnalysis);

  // Set callbacks if provided
  if (callbacks) {
    setQueueCallbacks(callbacks);
  }

  isInitialized = true;
  console.log('[ObserverAPI] Observer system initialized');

  // Check if meta observer should run (daily)
  checkMetaTrigger().catch(err => {
    console.error('[ObserverAPI] Meta trigger check failed:', err);
  });
}

// ============================================================================
// Queue Management
// ============================================================================

/**
 * Enqueue a message for processing
 */
export function enqueueMessage(messageId: string, sessionId: string): void {
  if (!isInitialized) {
    initializeObserverSystem();
  }
  enqueue(messageId, sessionId);
}

/**
 * Enqueue multiple messages
 */
export function enqueueMessages(messageIds: string[], sessionId: string): void {
  if (!isInitialized) {
    initializeObserverSystem();
  }
  enqueueMany(messageIds, sessionId);
}

/**
 * Get current queue status
 */
export function getStatus(): QueueStatus {
  return getQueueStatus();
}

/**
 * Get queue length
 */
export function getLength(): number {
  return getQueueLength();
}

// ============================================================================
// Manual Observer Triggers (for testing)
// ============================================================================

/**
 * Manually run the knowledge observer
 */
export async function runKnowledgeObserver(
  sessionId: string,
  messageIds: string[]
): Promise<void> {
  console.log('[ObserverAPI] Manual trigger: Knowledge Observer');
  await processMessages(sessionId, messageIds);
}

/**
 * Manually run the suggestion observer
 */
export async function runSuggestionObserver(sessionId: string): Promise<void> {
  console.log('[ObserverAPI] Manual trigger: Suggestion Observer');
  await generateSuggestions(sessionId);
}

/**
 * Manually run the System 2 Thinker
 */
export async function runSystem2Thinker(
  sessionId: string,
  itemCount = 16
): Promise<void> {
  console.log('[ObserverAPI] Manual trigger: System 2 Thinker');
  await runDeepAnalysis(sessionId, itemCount);
}

/**
 * Manually run the Meta Observer
 */
export async function runMetaObserver(): Promise<void> {
  console.log('[ObserverAPI] Manual trigger: Meta Observer');
  await runMetaAnalysis();
}

/**
 * Retry a failed observer operation
 */
export async function retryObserverError(errorId: string): Promise<void> {
  // Search through all sessions for the error
  const allSessions = observerHelpers.getAllSessions();
  let foundError: import('../../stores/observerStore').ObserverError | null = null;

  // Search through all sessions for the error
  for (const session of allSessions) {
    const sessionErrors = observerHelpers.getObserverErrors(session.id);
    const err = sessionErrors.find(e => e.id === errorId);
    if (err) {
      foundError = err;
      break;
    }
  }

  // Also check global errors
  if (!foundError) {
    const globalErrors = observerHelpers.getObserverErrors('_global');
    foundError = globalErrors.find(e => e.id === errorId) || null;
  }

  if (!foundError) {
    console.error('[ObserverAPI] Error not found:', errorId);
    return;
  }

  console.log('[ObserverAPI] Retrying failed operation:', foundError.phase, 'for session:', foundError.sessionId);

  try {
    switch (foundError.phase) {
      case 'knowledge':
        if (foundError.retryData.messageIds) {
          await processMessages(foundError.sessionId, foundError.retryData.messageIds);
        }
        break;
      case 'suggestion':
        await generateSuggestions(foundError.sessionId);
        break;
      case 'system2':
        await runDeepAnalysis(foundError.sessionId, foundError.retryData.knowledgeCount || 16);
        break;
      case 'meta':
        await runMetaAnalysis();
        break;
    }

    // Mark as resolved on success
    observerHelpers.resolveObserverError(errorId);
    console.log('[ObserverAPI] Retry successful, error resolved');
  } catch (retryError) {
    console.error('[ObserverAPI] Retry failed:', retryError);
    // Update the error message but keep it unresolved
    throw retryError;
  }
}

// ============================================================================
// Session Management
// ============================================================================

/**
 * Get session state
 */
export function getSessionState(sessionId: string): Record<string, unknown> | null {
  const session = observerHelpers.getSession(sessionId);
  return session?.state || null;
}

/**
 * Get all knowledge items for a session
 */
export function getAllKnowledgeItems(sessionId: string) {
  return observerHelpers.getKnowledgeItems(sessionId);
}

/**
 * Get all suggestions for a session
 */
export function getAllSuggestions(sessionId: string) {
  return observerHelpers.getSuggestions(sessionId);
}

/**
 * Get system thinking for a session
 */
export function getSystemThinking(sessionId: string) {
  const session = observerHelpers.getSession(sessionId);
  return session?.systemThinking || null;
}

/**
 * Resume a session (checks if analysis is needed)
 */
export async function resumeSession(sessionId: string): Promise<void> {
  console.log('[ObserverAPI] Resuming session:', sessionId);
  await checkAndRunIfNeeded(sessionId);
}

// ============================================================================
// Convenience exports
// ============================================================================

export {
  // From observerQueue
  setQueueCallbacks,
  // Types
  type QueueStatus,
  type ObserverQueueCallbacks,
};
