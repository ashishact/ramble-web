/**
 * Kernel - Core Loop Orchestrator
 *
 * Singleton that manages:
 * - Conversation save to DuckDB
 * - Recording lifecycle wiring (native events → recordingManager)
 *
 * Knowledge graph extraction is handled by SYS-II PeriodScheduler (every 6 hours),
 * NOT per-input. The kernel's job is just to save conversations.
 */

import { conversationStore } from '../../graph/stores/conversationStore';
import { createLogger } from '../utils/logger';
import { pipelineStatus } from './pipelineStatus';
import { recordingManager } from './recordingManager';
import { eventBus } from '../../lib/eventBus';
import { systemPause } from '../../lib/systemPause';
import { simpleHash } from '../utils/id';
import { telemetry } from '../telemetry';

const logger = createLogger('Kernel');

// ============================================================================
// Types
// ============================================================================

export interface KernelState {
  initialized: boolean;
  isProcessing: boolean;
  queueLength: number;
}

export interface InputResult {
  conversationId: string;
  error?: string;
}

export interface QuickResultInput {
  transcript: string
  quickResponse: { topic: string | undefined; intent: string; response: string }
  sessionId: string
  recordingId?: string
}

// ============================================================================
// Kernel Singleton
// ============================================================================

class Kernel {
  private static instance: Kernel | null = null;

  private initialized = false;
  private isProcessing = false;
  private inputQueue: Array<{
    text: string;
    source: 'speech' | 'text' | 'meeting';
    recordingId?: string;
    resolve: (result: InputResult) => void;
    reject: (error: Error) => void;
  }> = [];

  private listeners: Set<(state: KernelState) => void> = new Set();
  private recordingUnsubscribers: Array<() => void> = [];

  /**
   * Holds the meeting transcript received from `native:meeting-transcript-complete`.
   * The native app sends this BEFORE `native:recording-ended`. When recording-ended
   * fires, we check this field: if set, we use the meeting transcript (with speaker
   * labels) instead of the flat fullText from recordingManager.
   */
  private pendingMeetingTranscript: string | null = null;

  /**
   * In-memory dedup cache — hash(rawText) → conversationId.
   * Prevents duplicate conversation records from multiple submission paths.
   * Entries auto-expire after 2 minutes.
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

    this.initialized = false;
    this.notifyListeners();

    logger.info('Kernel shut down');
  }

  // ==========================================================================
  // Recording Lifecycle Wiring
  // ==========================================================================

  private wireRecordingLifecycle(): void {
    this.recordingUnsubscribers.forEach(unsub => unsub());
    this.recordingUnsubscribers = [];

    // ── Recording start ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:recording-started', () => {
        const recording = recordingManager.start('voice', { origin: 'in-app' });
        logger.info('Recording started via native event', { id: recording.id });
      })
    );

    // ── Intermediate chunk → track in recording only ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:transcription-intermediate', (payload) => {
        if (!recordingManager.isRecording) return;

        recordingManager.addChunk(
          payload.text,
          payload.audioType,
          { speechStartMs: payload.speechStartMs, speechEndMs: payload.speechEndMs }
        );
      })
    );

    // ── Meeting transcript received (before recording-ended) ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:meeting-transcript-complete', (payload) => {
        logger.info('Meeting transcript received', {
          segments: payload.segments?.length,
          transcriptLength: payload.transcript?.length,
        });
        this.pendingMeetingTranscript = payload.transcript;
      })
    );

    // ── Recording end → save + accumulate ──
    this.recordingUnsubscribers.push(
      eventBus.on('native:recording-ended', () => {
        if (!recordingManager.isRecording) return;

        const { recording, fullText } = recordingManager.end();

        const isMeeting = this.pendingMeetingTranscript !== null;
        const textToProcess = isMeeting ? this.pendingMeetingTranscript! : fullText;
        const source = isMeeting ? 'meeting' as const : 'speech' as const;

        this.pendingMeetingTranscript = null;

        logger.info('Recording ended', {
          id: recording.id,
          chars: textToProcess.length,
          isMeeting,
        });

        if (textToProcess.trim()) {
          // Only submit to conversationStore (and knowledge graph) for meetings.
          // Solo/individual native speech is NOT ingested — user must explicitly
          // paste text in ramble-web for it to enter the database.
          if (isMeeting) {
            this.submitInput(textToProcess.trim(), source, recording.id)
              .catch(err => logger.error('Processing failed', { error: err }));
          } else {
            logger.info('Solo native speech — skipping DB ingestion', {
              id: recording.id,
              chars: textToProcess.length,
            });
          }
        }
      })
    );

    // ── Transcription final (cloud STT) ──
    // Cloud STT is only used in solo/individual mode. Native meetings have
    // their own path (native:meeting-transcript-complete → native:recording-ended).
    // In solo mode we do NOT ingest native speech — only explicit text paste.
    this.recordingUnsubscribers.push(
      eventBus.on('native:transcription-final', (payload) => {
        if (!recordingManager.isRecording) return;

        recordingManager.addChunk(payload.text, 'mic');
        const { recording, fullText } = recordingManager.end();
        logger.info('Transcription final (solo — not ingested)', {
          id: recording.id,
          chars: fullText.length,
        });
      })
    );

    logger.info('Recording lifecycle wired to native events');
  }

  // ==========================================================================
  // Input Submission
  // ==========================================================================

  async submitInput(
    text: string,
    source: 'speech' | 'text' | 'meeting' = 'text',
    recordingId?: string
  ): Promise<InputResult> {
    if (systemPause.isPaused) {
      logger.info('System paused — dropping input', { source, chars: text.length });
      return { conversationId: '' };
    }

    if (!this.initialized) {
      throw new Error('Kernel not initialized');
    }

    // Ensure every input has a recording
    let finalRecordingId = recordingId;
    if (!finalRecordingId) {
      const recType = source === 'speech' ? 'voice' : 'text';
      recordingManager.start(recType, { origin: 'in-app' });
      recordingManager.addChunk(text);
      const { recording: ended } = recordingManager.end();
      finalRecordingId = ended.id;
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
        const result = await this.saveConversation(item.text, item.source, item.recordingId);
        item.resolve(result);
      } catch (error) {
        logger.error('Failed to save input', { error });
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isProcessing = false;
    this.notifyListeners();
  }

  // ==========================================================================
  // Save Conversation (no LLM — extraction is done by PeriodScheduler)
  // ==========================================================================

  /**
   * Save conversation to DuckDB. No LLM calls — knowledge graph extraction
   * is handled by SYS-II PeriodScheduler on a 6-hour cadence.
   */
  private async saveConversation(
    text: string,
    source: 'speech' | 'text' | 'meeting',
    recordingId?: string
  ): Promise<InputResult> {
    // Dedup gate
    const textHash = simpleHash(text);
    const existingConvId = this.recentRawTexts.get(textHash);
    if (existingConvId) {
      logger.info('Duplicate rawText — skipping', { existingConvId, source });
      return { conversationId: existingConvId };
    }

    // Save conversation to DuckDB
    pipelineStatus.start();
    pipelineStatus.step('input', 'running');
    telemetry.emit('kernel', 'saveConversation', 'start', {
      source,
      chars: text.length,
    });

    const conversation = await conversationStore.create({
      sessionId: 'default',
      rawText: text,
      source,
      speaker: 'user',
      recordingId,
    });

    // Dedup cache
    this.recentRawTexts.set(textHash, conversation.id);
    setTimeout(() => this.recentRawTexts.delete(textHash), this.DEDUP_TTL_MS);

    pipelineStatus.step('input', 'success');
    pipelineStatus.step('save', 'success');
    pipelineStatus.step('done', 'success');

    telemetry.emit('kernel', 'saveConversation', 'end', {
      conversationId: conversation.id,
    }, { status: 'success' });

    logger.info('Conversation saved', {
      conversationId: conversation.id,
    });

    return { conversationId: conversation.id };
  }

  // ==========================================================================
  // Quick Result Ingestion (server pre-computed AI response)
  // ==========================================================================

  /**
   * Saves a user transcript and its pre-computed AI response in one shot,
   * bypassing the LLM transport. Used when the worker returns a `quickResponse`
   * alongside the final isFinal=true transcription.
   *
   * Writes two rows:
   *   - speaker:'user'  — the transcript
   *   - speaker:'sys1'  — the AI response (marked processed immediately)
   */
  /**
   * Saves the user turn immediately (before the API call).
   * Returns the new conversation id so it can be passed to ingestQuickResult
   * to avoid re-writing the user turn once the AI response arrives.
   */
  async saveUserTurn(
    transcript: string,
    sessionId: string,
    source: 'typed' | 'speech' = 'typed',
    recordingId?: string
  ): Promise<string> {
    if (!this.initialized) throw new Error('Kernel not initialized');
    if (!transcript.trim()) throw new Error('Empty transcript');

    const userConv = await conversationStore.create({
      sessionId,
      rawText: transcript,
      source,
      speaker: 'user',
      recordingId,
    });

    const textHash = simpleHash(transcript);
    this.recentRawTexts.set(textHash, userConv.id);
    setTimeout(() => this.recentRawTexts.delete(textHash), this.DEDUP_TTL_MS);

    return userConv.id;
  }

  async ingestQuickResult(
    transcript: string,
    quickResponse: { topic: string | undefined; intent: string; response: string },
    sessionId: string,
    recordingId?: string,
    existingUserConvId?: string
  ): Promise<void> {
    if (!this.initialized) {
      throw new Error('Kernel not initialized');
    }
    if (!transcript.trim()) return;

    if (!existingUserConvId) {
      // Dedup gate — only needed when user turn wasn't pre-written
      const textHash = simpleHash(transcript);
      const existingConvId = this.recentRawTexts.get(textHash);
      if (existingConvId) {
        logger.info('ingestQuickResult: duplicate transcript — skipping', { existingConvId });
        return;
      }

      logger.info('ingestQuickResult: saving user + sys1 turns', {
        chars: transcript.length,
        intent: quickResponse.intent,
        topic: quickResponse.topic,
      });

      // User turn
      const userConv = await conversationStore.create({
        sessionId,
        rawText: transcript,
        source: 'speech',
        speaker: 'user',
        intent: quickResponse.intent,
        topic: quickResponse.topic,
        recordingId,
      });

      this.recentRawTexts.set(textHash, userConv.id);
      setTimeout(() => this.recentRawTexts.delete(textHash), this.DEDUP_TTL_MS);
    } else {
      logger.info('ingestQuickResult: user turn already saved, writing sys1 only', {
        existingUserConvId,
        intent: quickResponse.intent,
      });
    }

    // AI response turn
    const aiConv = await conversationStore.create({
      sessionId,
      rawText: quickResponse.response,
      source: 'sys1',
      speaker: 'sys1',
      intent: quickResponse.intent,
      topic: quickResponse.topic,
    });
    await conversationStore.markProcessed(aiConv.id);

    logger.info('ingestQuickResult: saved', { existingUserConvId, aiConvId: aiConv.id });
  }

  // ==========================================================================
  // State & Subscriptions
  // ==========================================================================

  getState(): KernelState {
    return {
      initialized: this.initialized,
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
