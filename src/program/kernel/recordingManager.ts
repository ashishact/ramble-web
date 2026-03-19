/**
 * RecordingManager — Universal Recording Lifecycle
 *
 * ARCHITECTURE: Maps existing native events to a universal Recording concept.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Before RecordingManager, the system had two disconnected flows:
 *   1. native:recording-started/ended → GlobalSTTController → kernel.submitInput()
 *   2. native:transcription-intermediate → meetingStatus → meeting widget LLM loop
 *
 * RecordingManager unifies these into one lifecycle:
 *   start() → addChunk() → addChunk() → ... → end()
 *
 * Every input type maps to this lifecycle:
 *   - Voice (native): native:recording-started → start('voice')
 *                      native:transcription-intermediate → addChunk()
 *                      native:recording-ended → end()
 *   - Voice (cloud STT): same flow via GlobalSTTController
 *   - Text/paste: start('text'/'paste') → single addChunk() → end()
 *   - File upload: start('document'/'image') → addChunk(preview) → end()
 *
 * Emits recording:started, recording:chunk, recording:ended events.
 * Downstream consumers (System I, System II, widgets) subscribe to these
 * instead of native:* events directly.
 *
 * THROUGHPUT RATE: Physical bottleneck signal for confidence calibration.
 * Speech is slow (~2.5 chars/sec), paste is instant. The rate is computed
 * at end() from total chars / elapsed seconds. This feeds into memory
 * confidence scoring downstream.
 */

import { eventBus } from '../../lib/eventBus'
import type { Recording, RecordingChunk, RecordingType } from '../types/recording'
import { createLogger } from '../utils/logger'

const logger = createLogger('RecordingManager')

// Maximum throughputRate to prevent Infinity from instant paste/upload
const MAX_THROUGHPUT_RATE = 1000

import { nid } from '../utils/id'

// ============================================================================
// RecordingManager
// ============================================================================

export class RecordingManager {
  /** The currently active recording, or null if idle */
  private _activeRecording: Recording | null = null

  /** Chunks accumulated during the active recording */
  private _chunks: RecordingChunk[] = []

  /** Full accumulated text (joined chunks) for quick access */
  private _fullText = ''

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Start a new recording session.
   *
   * @param type - How the content is arriving (voice, text, paste, document, image)
   * @param options - Optional overrides for audioType and origin
   * @returns The new Recording object
   * @throws If a recording is already active (must end() first)
   */
  start(
    type: RecordingType,
    options?: {
      audioType?: 'mic' | 'system'
      origin?: 'in-app' | 'out-of-app'
    }
  ): Recording {
    if (this._activeRecording) {
      logger.warn('start() called while recording already active — ending previous first', {
        activeId: this._activeRecording.id,
      })
      this.end()
    }

    const recording: Recording = {
      id: nid.recording(),
      type,
      startedAt: Date.now(),
      audioType: options?.audioType,
      origin: options?.origin ?? 'in-app',
    }

    this._activeRecording = recording
    this._chunks = []
    this._fullText = ''

    logger.info('Recording started', { id: recording.id, type })

    eventBus.emit('recording:started', { recording })

    return recording
  }

  /**
   * Add a text chunk to the active recording.
   * For voice: called on each intermediate transcription.
   * For text/paste/document: called once with the full content.
   *
   * @param text - The text content of this chunk
   * @param audioType - Audio source for voice chunks (mic/system)
   * @param timing - Optional VAD timing from native app
   * @returns The created RecordingChunk
   * @throws If no recording is active
   */
  addChunk(
    text: string,
    audioType?: 'mic' | 'system',
    timing?: { speechStartMs?: number; speechEndMs?: number }
  ): RecordingChunk {
    if (!this._activeRecording) {
      logger.error('addChunk() called with no active recording')
      throw new Error('No active recording — call start() first')
    }

    const chunk: RecordingChunk = {
      recordingId: this._activeRecording.id,
      text,
      chunkIndex: this._chunks.length,
      timestamp: Date.now(),
      audioType,
      speechStartMs: timing?.speechStartMs,
      speechEndMs: timing?.speechEndMs,
    }

    this._chunks.push(chunk)
    this._fullText += (this._fullText ? ' ' : '') + text

    eventBus.emit('recording:chunk', {
      chunk,
      recording: this._activeRecording,
    })

    return chunk
  }

  /**
   * End the active recording session.
   * Calculates throughputRate and emits recording:ended.
   *
   * @returns The completed recording + full text + all chunks
   * @throws If no recording is active
   */
  end(): { recording: Recording; fullText: string; chunks: RecordingChunk[] } {
    if (!this._activeRecording) {
      logger.error('end() called with no active recording')
      throw new Error('No active recording — call start() first')
    }

    const now = Date.now()
    this._activeRecording.endedAt = now
    this._activeRecording.throughputRate = this.calculateThroughputRate()

    const result = {
      recording: { ...this._activeRecording },
      fullText: this._fullText,
      chunks: [...this._chunks],
    }

    logger.info('Recording ended', {
      id: this._activeRecording.id,
      type: this._activeRecording.type,
      chunks: this._chunks.length,
      chars: this._fullText.length,
      throughputRate: this._activeRecording.throughputRate,
    })

    eventBus.emit('recording:ended', {
      recording: result.recording,
      fullText: result.fullText,
    })

    // Reset state
    this._activeRecording = null
    this._chunks = []
    this._fullText = ''

    return result
  }

  // ── Accessors ──────────────────────────────────────────────────────────

  /** Get the currently active recording, or null if idle */
  getActive(): Recording | null {
    return this._activeRecording ? { ...this._activeRecording } : null
  }

  /** Get accumulated full text of the active recording */
  getFullText(): string {
    return this._fullText
  }

  /** Get all chunks of the active recording */
  getChunks(): RecordingChunk[] {
    return [...this._chunks]
  }

  /** Whether a recording is currently active */
  get isRecording(): boolean {
    return this._activeRecording !== null
  }

  // ── Internal ───────────────────────────────────────────────────────────

  /**
   * Calculate throughput rate as chars / elapsed seconds.
   *
   * Physical bottleneck signal:
   *   - Speech: ~2.5 chars/sec (150 words/min * ~5 chars/word / 60)
   *   - Typing: ~5-10 chars/sec
   *   - Paste/document: nearly instant → capped at MAX_THROUGHPUT_RATE
   *
   * A recording that lasted 0 seconds (instant) gets max rate.
   */
  calculateThroughputRate(): number {
    if (!this._activeRecording) return 0

    const elapsedMs = Date.now() - this._activeRecording.startedAt
    const elapsedSec = elapsedMs / 1000

    if (elapsedSec <= 0 || this._fullText.length === 0) {
      return MAX_THROUGHPUT_RATE
    }

    const rate = this._fullText.length / elapsedSec
    return Math.min(rate, MAX_THROUGHPUT_RATE)
  }
}

// Singleton instance
export const recordingManager = new RecordingManager()
