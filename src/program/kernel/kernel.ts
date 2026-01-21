/**
 * Kernel - Core Loop Orchestrator
 *
 * Singleton that manages:
 * - Session lifecycle
 * - Input processing queue
 * - Durable execution
 *
 * The Loop:
 * [userinput] → [search/surface] → LLM → [update] → save → wait
 */

import { sessionStore, conversationStore, taskStore, correctionStore } from '../../db/stores';
import { processInput, type ProcessingResult } from './processor';
import { seedCorePlugins } from '../plugins';
import { createLogger } from '../utils/logger';
import { pipelineStatus } from './pipelineStatus';
import type Session from '../../db/models/Session';

const logger = createLogger('Kernel');

// ============================================================================
// Types
// ============================================================================

export interface KernelState {
  initialized: boolean;
  currentSession: Session | null;
  isProcessing: boolean;
  queueLength: number;
}

export interface InputResult {
  conversationId: string;
  processingResult?: ProcessingResult;
  error?: string;
}

// ============================================================================
// Kernel Singleton
// ============================================================================

class Kernel {
  private static instance: Kernel | null = null;

  private initialized = false;
  private currentSession: Session | null = null;
  private isProcessing = false;
  private inputQueue: Array<{
    text: string;
    source: 'speech' | 'text';
    resolve: (result: InputResult) => void;
    reject: (error: Error) => void;
  }> = [];

  private listeners: Set<(state: KernelState) => void> = new Set();

  private constructor() {}

  static getInstance(): Kernel {
    if (!Kernel.instance) {
      Kernel.instance = new Kernel();
    }
    return Kernel.instance;
  }

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info('Initializing kernel...');

    // Try to resume existing session or create new one
    const activeSession = await sessionStore.getActive();
    if (activeSession) {
      this.currentSession = activeSession;
      logger.info('Resumed active session', { id: activeSession.id });
    } else {
      this.currentSession = await sessionStore.create({});
      logger.info('Created new session', { id: this.currentSession.id });
    }

    // Seed core plugins if needed
    await seedCorePlugins();

    // Fix any conversations that were processed but not marked (recovery from crashes)
    await this.fixOrphanedConversations();

    // Resume any pending tasks (for durability)
    await this.resumePendingTasks();

    this.initialized = true;
    this.notifyListeners();

    logger.info('Kernel initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    logger.info('Shutting down kernel...');

    // End current session
    if (this.currentSession) {
      await sessionStore.endSession(this.currentSession.id);
    }

    this.initialized = false;
    this.currentSession = null;
    this.notifyListeners();

    logger.info('Kernel shut down');
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  async startNewSession(): Promise<Session> {
    // End current session if exists
    if (this.currentSession) {
      await sessionStore.endSession(this.currentSession.id);
    }

    // Create new session
    this.currentSession = await sessionStore.create({});
    this.notifyListeners();

    logger.info('Started new session', { id: this.currentSession.id });
    return this.currentSession;
  }

  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  // ==========================================================================
  // Input Processing (The Core Loop)
  // ==========================================================================

  /**
   * Submit user input for processing
   * Returns a promise that resolves when processing is complete
   */
  async submitInput(text: string, source: 'speech' | 'text' = 'text'): Promise<InputResult> {
    if (!this.initialized || !this.currentSession) {
      throw new Error('Kernel not initialized');
    }

    return new Promise((resolve, reject) => {
      this.inputQueue.push({ text, source, resolve, reject });
      this.notifyListeners();
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.inputQueue.length === 0) return;

    this.isProcessing = true;
    this.notifyListeners();

    while (this.inputQueue.length > 0) {
      const item = this.inputQueue.shift()!;
      this.notifyListeners();

      try {
        const result = await this.processInputItem(item.text, item.source);
        item.resolve(result);
      } catch (error) {
        logger.error('Failed to process input', { error });
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isProcessing = false;
    this.notifyListeners();
  }

  private async processInputItem(
    text: string,
    source: 'speech' | 'text'
  ): Promise<InputResult> {
    if (!this.currentSession?.id) {
      throw new Error('No active session');
    }
    const sessionId = this.currentSession.id;

    // Start pipeline tracking
    pipelineStatus.start();
    pipelineStatus.step('input', 'running');

    // 1. Apply corrections (for STT)
    let sanitizedText = text;
    if (source === 'speech') {
      const { corrected } = await correctionStore.applyCorrections(text);
      sanitizedText = corrected;
    }
    pipelineStatus.step('input', 'success');

    // 2. Save conversation unit
    pipelineStatus.step('save', 'running');
    const conversation = await conversationStore.create({
      sessionId,
      rawText: text,
      sanitizedText,
      source,
      speaker: 'user',
    });

    // 3. Increment session unit count
    await sessionStore.incrementUnitCount(sessionId);

    // 4. Create durable task for processing
    const task = await taskStore.create({
      taskType: 'process-input',
      payload: {
        conversationId: conversation.id,
        sessionId,
        text: sanitizedText,
        source,
      },
      sessionId,
    });
    pipelineStatus.step('save', 'success');

    // 5. Process immediately
    pipelineStatus.step('process', 'running');
    try {
      await taskStore.start(task.id);

      const processingResult = await processInput(
        sessionId,
        conversation.id,
        sanitizedText,
        source
      );

      await conversationStore.markProcessed(conversation.id);

      await taskStore.complete(task.id, {
        entities: processingResult.entities.length,
        topics: processingResult.topics.length,
        memories: processingResult.memories.length,
      });

      pipelineStatus.step('process', 'success');
      pipelineStatus.step('done', 'success');

      return {
        conversationId: conversation.id,
        processingResult,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await taskStore.fail(task.id, errorMessage);

      pipelineStatus.step('process', 'error');
      pipelineStatus.step('done', 'error');

      return {
        conversationId: conversation.id,
        error: errorMessage,
      };
    }
  }

  // ==========================================================================
  // Task Recovery (Durability)
  // ==========================================================================

  /**
   * Fix conversations where the task completed but markProcessed never ran
   * This can happen if the app crashes between task.complete and markProcessed
   */
  private async fixOrphanedConversations(): Promise<void> {
    // Get unprocessed conversations
    const unprocessed = await conversationStore.getUnprocessed(100);
    logger.info('Checking for orphaned conversations', {
      unprocessedCount: unprocessed.length
    });
    if (unprocessed.length === 0) return;

    // Get completed process-input tasks
    const completedTasks = await taskStore.getByStatus('completed');
    const processInputTasks = completedTasks.filter(t => t.taskType === 'process-input');
    logger.info('Found completed process-input tasks', {
      count: processInputTasks.length
    });

    // Also check running tasks (might have crashed mid-execution)
    const runningTasks = await taskStore.getByStatus('running');
    const runningProcessInputTasks = runningTasks.filter(t => t.taskType === 'process-input');
    logger.info('Found running process-input tasks', {
      count: runningProcessInputTasks.length
    });

    // Build a set of conversationIds that have completed tasks
    const completedConversationIds = new Set<string>();
    for (const task of processInputTasks) {
      try {
        const payload = task.payloadParsed as { conversationId?: string };
        if (payload.conversationId) {
          completedConversationIds.add(payload.conversationId);
        }
      } catch {
        // Invalid payload, skip
      }
    }

    // Mark orphaned conversations as processed
    let fixed = 0;
    for (const conv of unprocessed) {
      if (completedConversationIds.has(conv.id)) {
        await conversationStore.markProcessed(conv.id);
        fixed++;
        logger.info('Fixed orphaned conversation', { id: conv.id });
      }
    }

    // For running tasks that are stale (crashed), mark complete and fix conversation
    for (const task of runningProcessInputTasks) {
      try {
        const payload = task.payloadParsed as { conversationId?: string };
        if (payload.conversationId) {
          // Mark conversation as processed
          await conversationStore.markProcessed(payload.conversationId);
          // Complete the task
          await taskStore.complete(task.id);
          fixed++;
          logger.info('Fixed stale running task', {
            taskId: task.id,
            conversationId: payload.conversationId
          });
        }
      } catch {
        // Invalid payload, skip
      }
    }

    if (fixed > 0) {
      logger.info('Fixed orphaned conversations', { count: fixed });
    }
  }

  private async resumePendingTasks(): Promise<void> {
    const pendingTasks = await taskStore.getPending(10);

    if (pendingTasks.length === 0) return;

    logger.info('Resuming pending tasks', { count: pendingTasks.length });

    for (const task of pendingTasks) {
      if (task.taskType === 'process-input') {
        const payload = task.payloadParsed as {
          conversationId: string;
          sessionId: string;
          text: string;
          source?: 'speech' | 'text';
        };

        try {
          await taskStore.start(task.id);
          await processInput(
            payload.sessionId,
            payload.conversationId,
            payload.text,
            payload.source ?? 'text'
          );
          // Mark conversation first, then complete task
          await conversationStore.markProcessed(payload.conversationId);
          await taskStore.complete(task.id);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await taskStore.fail(task.id, errorMessage);
        }
      }
    }
  }

  // ==========================================================================
  // Reprocessing
  // ==========================================================================

  /**
   * Reprocess conversations that failed extraction
   * Useful for recovering from errors
   */
  async reprocessFailed(): Promise<{ processed: number; failed: number }> {
    const unprocessed = await conversationStore.getUnprocessed(100);

    if (unprocessed.length === 0) {
      logger.info('No unprocessed conversations to reprocess');
      return { processed: 0, failed: 0 };
    }

    logger.info('Reprocessing failed conversations', { count: unprocessed.length });

    let processed = 0;
    let failed = 0;

    for (const conv of unprocessed) {
      try {
        // Skip conversations with no sessionId (corrupted data)
        if (!conv.sessionId) {
          logger.warn('Skipping conversation with no sessionId', { id: conv.id });
          // Just mark as processed to clear it
          await conversationStore.markProcessed(conv.id);
          processed++;
          continue;
        }

        logger.info('Reprocessing conversation', { id: conv.id, sessionId: conv.sessionId });

        await processInput(
          conv.sessionId,
          conv.id,
          conv.sanitizedText,
          conv.source as 'speech' | 'text'
        );

        await conversationStore.markProcessed(conv.id);
        processed++;

        logger.info('Reprocessed conversation successfully', { id: conv.id });
      } catch (error) {
        failed++;
        logger.error('Failed to reprocess conversation', {
          id: conv.id,
          error: error instanceof Error ? error.message : 'Unknown',
          stack: error instanceof Error ? error.stack : undefined
        });
        // Also log to console for visibility
        console.error('Reprocess error:', error);
      }
    }

    logger.info('Reprocessing complete', { processed, failed });
    return { processed, failed };
  }

  // ==========================================================================
  // State & Subscriptions
  // ==========================================================================

  getState(): KernelState {
    return {
      initialized: this.initialized,
      currentSession: this.currentSession,
      isProcessing: this.isProcessing,
      queueLength: this.inputQueue.length,
    };
  }

  subscribe(listener: (state: KernelState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

// ============================================================================
// Export singleton accessor
// ============================================================================

export function getKernel(): Kernel {
  return Kernel.getInstance();
}

// Expose for debugging in browser console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).reprocessFailed = async () => {
    const kernel = getKernel();
    const result = await kernel.reprocessFailed();
    console.log(`Reprocessed: ${result.processed} succeeded, ${result.failed} failed`);
    return result;
  };
}
