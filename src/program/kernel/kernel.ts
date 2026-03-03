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

import { sessionStore, conversationStore, taskStore, recordingStore } from '../../db/stores';
import { processInput, type ProcessingResult } from './processor';
import { seedCorePlugins } from '../plugins';
import { createLogger } from '../utils/logger';
import { pipelineStatus } from './pipelineStatus';
import { recordingManager } from './recordingManager';
import { eventBus } from '../../lib/eventBus';
import { systemPause } from '../../lib/systemPause';
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
    recordingId?: string;
    resolve: (result: InputResult) => void;
    reject: (error: Error) => void;
  }> = [];

  private listeners: Set<(state: KernelState) => void> = new Set();
  private recordingUnsubscribers: Array<() => void> = [];

  /**
   * In-memory dedup caches — prevent duplicate conversation records.
   *
   * recentRawTexts: rawText → conversationId for the last N texts.
   * Catches exact duplicates regardless of source (WebSocket dupe, paste dupe,
   * dual submission path, etc.). Entries auto-expire after 2 minutes.
   */
  private recentRawTexts = new Map<string, string>();
  private readonly DEDUP_TTL_MS = 2 * 60 * 1000;

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

    // Wire recording lifecycle to native events
    this.wireRecordingLifecycle();

    this.initialized = true;
    this.notifyListeners();

    logger.info('Kernel initialized');
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    logger.info('Shutting down kernel...');

    // Unsubscribe recording lifecycle listeners
    this.recordingUnsubscribers.forEach(unsub => unsub());
    this.recordingUnsubscribers = [];

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
  // Recording Lifecycle Wiring
  // ==========================================================================

  /**
   * Wire RecordingManager to native events so the unified pipeline processes
   * all audio input through System I (per-chunk) and System II (full recording).
   *
   * Flow:
   *   native:recording-started  → recordingManager.start('voice')
   *   native:transcription-intermediate → recordingManager.addChunk() → submitChunk() (System I)
   *   native:recording-ended    → recordingManager.end() → submitInput() (System II)
   *
   * Text/paste input: called directly via submitInput() — no recording lifecycle needed.
   */
  private wireRecordingLifecycle(): void {
    // Clean up any previous subscriptions (shouldn't happen, but defensive)
    this.recordingUnsubscribers.forEach(unsub => unsub());
    this.recordingUnsubscribers = [];

    // ── Recording start ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:recording-started', () => {
        const recording = recordingManager.start('voice', { origin: 'in-app' });
        logger.info('Recording started via native event', { id: recording.id });
      })
    );

    // ── Intermediate chunk → System I processing ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:transcription-intermediate', (payload) => {
        if (!recordingManager.isRecording) return;

        const chunk = recordingManager.addChunk(
          payload.text,
          payload.audioType,
          { speechStartMs: payload.speechStartMs, speechEndMs: payload.speechEndMs }
        );

        // Fire-and-forget System I processing
        this.submitChunk(chunk.text, chunk.chunkIndex, chunk.recordingId)
          .catch(err => logger.error('System I chunk failed (non-fatal)', { error: err }));
      })
    );

    // ── Recording end → System II processing ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:recording-ended', () => {
        if (!recordingManager.isRecording) return;

        const { recording, fullText, chunks } = recordingManager.end();
        logger.info('Recording ended', { id: recording.id, chars: fullText.length });

        if (fullText.trim()) {
          // Save recording to DB for time travel
          recordingStore.create({
            type: recording.type,
            startedAt: recording.startedAt,
            endedAt: recording.endedAt,
            fullText,
            source: 'in-app',
            audioType: recording.audioType,
            throughputRate: recording.throughputRate,
            chunkCount: chunks.length,
            processingMode: 'system-ii',
            sessionId: this.currentSession?.id,
          }).catch(err => logger.error('Failed to save recording', { error: err }));

          // Submit for System II (durable) processing — pass recordingId
          // so the event chain stays connected: recording → processing → widgets
          this.submitInput(fullText.trim(), 'speech', recording.id)
            .catch(err => logger.error('System II processing failed', { error: err }));
        }
      })
    );

    // ── Transcription final (cloud STT) → same as recording end ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:transcription-final', (payload) => {
        if (!recordingManager.isRecording) return;

        // Add final text as last chunk
        recordingManager.addChunk(payload.text, 'mic');
        const { recording, fullText, chunks } = recordingManager.end();
        logger.info('Transcription final', { id: recording.id, chars: fullText.length });

        if (fullText.trim()) {
          recordingStore.create({
            type: recording.type,
            startedAt: recording.startedAt,
            endedAt: recording.endedAt,
            fullText,
            source: 'in-app',
            throughputRate: recording.throughputRate,
            chunkCount: chunks.length,
            processingMode: 'system-ii',
            sessionId: this.currentSession?.id,
          }).catch(err => logger.error('Failed to save recording', { error: err }));

          this.submitInput(fullText.trim(), 'speech', recording.id)
            .catch(err => logger.error('System II processing failed', { error: err }));
        }
      })
    );

    logger.info('Recording lifecycle wired to native events');
  }

  // ==========================================================================
  // Input Processing (The Core Loop)
  // ==========================================================================

  /**
   * Submit user input for processing.
   *
   * Every input should have a recordingId — the Recording abstraction tracks
   * ALL inputs (voice, text, paste, keyboard) for time travel and event routing.
   * If no recordingId is provided, one is created automatically so that
   * downstream processing (processor.ts) can always emit typed events.
   *
   * @param text - The input text
   * @param source - How the text arrived ('speech' | 'text')
   * @param recordingId - Optional recording ID (auto-created if not provided)
   */
  async submitInput(
    text: string,
    source: 'speech' | 'text' = 'text',
    recordingId?: string
  ): Promise<InputResult> {
    if (systemPause.isPaused) {
      logger.info('System paused — dropping input', { source, chars: text.length });
      return { conversationId: '' };
    }

    if (!this.initialized || !this.currentSession) {
      throw new Error('Kernel not initialized');
    }

    // Ensure every input has a recording — if the caller didn't create one
    // (e.g. TextInputWidget, legacy code paths), we create one here.
    let finalRecordingId = recordingId;
    if (!finalRecordingId) {
      const recType = source === 'speech' ? 'voice' : 'text';
      recordingManager.start(recType, { origin: 'in-app' });
      recordingManager.addChunk(text);
      const { recording: ended } = recordingManager.end();
      finalRecordingId = ended.id;

      // Persist the auto-created recording
      recordingStore.create({
        type: ended.type,
        startedAt: ended.startedAt,
        endedAt: ended.endedAt,
        fullText: text,
        source: 'in-app',
        throughputRate: ended.throughputRate,
        chunkCount: 1,
        processingMode: 'system-ii',
        sessionId: this.currentSession?.id,
      }).catch(err => logger.error('Failed to save auto-recording', { error: err }));
    }

    return new Promise((resolve, reject) => {
      this.inputQueue.push({ text, source, recordingId: finalRecordingId, resolve, reject });
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
        const result = await this.processInputItem(item.text, item.source, item.recordingId);
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
    source: 'speech' | 'text',
    recordingId?: string
  ): Promise<InputResult> {
    if (!this.currentSession?.id) {
      throw new Error('No active session');
    }
    const sessionId = this.currentSession.id;

    // ── Exact rawText dedup gate (in-memory) ─────────────────────────────
    // The same text can arrive via multiple paths (WebSocket + paste, native
    // recording + cloud STT, etc.) — only the first one should create a record.
    // Check against in-memory cache of recently created texts — no DB query.
    const existingConvId = this.recentRawTexts.get(text);
    if (existingConvId) {
      console.log(
        '%c[Kernel] Duplicate rawText — skipping',
        'color: red; font-weight: bold',
        { existingConvId, source, textPreview: text.slice(0, 80) }
      );
      return { conversationId: existingConvId };
    }

    // Start pipeline tracking
    pipelineStatus.start();
    pipelineStatus.step('input', 'running');

    // Corrections are now handled inside normalizeInput (Phase 1 of processor)
    // The raw text goes through as-is — normalizeInput applies dictionary,
    // phonetic, and learned corrections before the LLM call.
    const sanitizedText = text;
    pipelineStatus.step('input', 'success');

    // 2. Save conversation unit
    pipelineStatus.step('save', 'running');
    const conversation = await conversationStore.create({
      sessionId,
      rawText: text,
      sanitizedText,
      source,
      speaker: 'user',
      recordingId,
    });

    // Cache rawText → conversationId for dedup (auto-expires)
    this.recentRawTexts.set(text, conversation.id);
    setTimeout(() => this.recentRawTexts.delete(text), this.DEDUP_TTL_MS);

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
        source,
        { mode: 'system-ii', recordingId }
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
  // System I — Fast Processing (per-chunk)
  // ==========================================================================

  /**
   * Submit a single recording chunk for System I (fast/shallow) processing.
   *
   * System I processes each intermediate chunk with small context.
   * Results are saved to DB for time travel but without durability guarantees.
   * Fire-and-forget — if it fails, the chunk is skipped silently.
   *
   * @param chunkText - The text of the chunk to process
   * @param chunkIndex - Sequential index within the recording
   * @param recordingId - ID of the active recording
   * @returns ProcessingResult if successful, null if failed
   */
  async submitChunk(
    chunkText: string,
    chunkIndex: number,
    recordingId: string
  ): Promise<ProcessingResult | null> {
    if (systemPause.isPaused) return null;

    if (!this.initialized || !this.currentSession) {
      return null;
    }

    const sessionId = this.currentSession.id;

    try {
      // Save as conversation record (for time travel)
      const conversation = await conversationStore.create({
        sessionId,
        rawText: chunkText,
        sanitizedText: chunkText,
        source: 'speech',
        speaker: 'user',
        recordingId,
      });

      // Run System I processing — fire-and-forget, no durable task
      const result = await processInput(
        sessionId,
        conversation.id,
        chunkText,
        'speech',
        {
          mode: 'system-i',
          recordingId,
          chunkIndex,
        }
      );

      await conversationStore.markProcessed(conversation.id);

      return result;
    } catch (error) {
      logger.error('System I chunk processing failed (non-fatal)', {
        chunkIndex,
        recordingId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
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

    // For running tasks that are stale (crashed), reset to pending for retry
    // Don't complete them - the processing might have failed mid-way
    for (const task of runningProcessInputTasks) {
      try {
        // Reset to pending so resumePendingTasks will pick it up
        await taskStore.reschedule(task.id, Date.now());
        logger.info('Reset stale running task to pending', {
          taskId: task.id,
        });
      } catch {
        // Invalid task, skip
      }
    }

    if (fixed > 0) {
      logger.info('Fixed orphaned conversations', { count: fixed });
    }
  }

  private async resumePendingTasks(): Promise<void> {
    // Only get pending tasks - failed tasks require manual retry via reprocessFailed()
    // This prevents infinite retry loops when API is persistently broken
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
          logger.info('Successfully resumed task', { taskId: task.id });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await taskStore.fail(task.id, errorMessage);
          logger.error('Failed to resume task', { taskId: task.id, error: errorMessage });
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
