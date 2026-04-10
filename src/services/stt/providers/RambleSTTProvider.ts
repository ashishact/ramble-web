/**
 * RambleSTTProvider
 *
 * Web STT provider — only active when Ramble Native is NOT available.
 *
 * Flow:
 *  - MediaRecorder captures continuous audio in 200 ms slices
 *  - VAD (voice activity detection) tracks speech/silence state
 *  - A 500 ms check interval decides when to flush:
 *      1. elapsed >= 10 s AND silence detected  → send immediately (clean boundary)
 *      2. elapsed >= 15 s                       → send regardless (non-stop talkers)
 *      3. stopRecording() called                → send remaining + isFinal:true
 *  - Only chunks that contain at least one speech segment are sent (pure silence discarded)
 *  - API calls are serialised so chunkIndex stays in order even if uploads overlap
 *
 * IDs per recording session:
 *  - sessionId  — chatSessionId from Sys1 (read from profileStorage), persisted across recordings
 *  - messageId  — minted by the server on the first chunk, reused for all subsequent chunks
 *
 * The last chunk passes isFinal:true — the server assembles the full transcript inline,
 * no separate /end call is needed.
 */

import { nid } from '../../../program/utils/id'
import { profileStorage } from '../../../lib/profileStorage'
import { getWorkerHeaders } from '../../cfGateway'
import { createLogger } from '../../../program/utils/logger'
import { eventBus } from '../../../lib/eventBus'
import type { ISTTProvider, STTServiceCallbacks, STTProvider, STTFinalResult, STTQuickResponse } from '../types'

const log = createLogger('RambleSTT')

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787'

// Chunking thresholds
const CHUNK_MIN_MS = 10_000        // start looking for a silence gap at 10 s
const CHUNK_MAX_MS = 15_000        // hard cap — send regardless at 15 s
const CHECK_INTERVAL_MS = 500      // how often the flush check runs
const RECORDER_TIMESLICE_MS = 200  // MediaRecorder slice granularity

// Key where Sys1Engine stores the chat session ID
const SYS1_SESSION_KEY = 'sys1-chat-session-id'

export class RambleSTTProvider implements ISTTProvider {
  private callbacks: STTServiceCallbacks = {}
  private connected = false
  private recording = false

  // Audio capture
  private stream: MediaStream | null = null
  private mediaRecorder: MediaRecorder | null = null
  private currentChunkBlobs: Blob[] = []
  private chunkStartTime = 0

  // VAD state
  private vad: any = null
  private vadActive = false         // true once VAD is successfully loaded
  private hasSpeechInChunk = false  // true if any speech detected since last flush
  private isSilentNow = true        // true when VAD is not detecting speech

  // Flush timer
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private stopRequested = false

  // Per-session API state (reset on every startRecording)
  private sessionId: string | null = null
  private messageId: string | null = null
  private chunkIndex = 0

  // WebM init segment — first blob from MediaRecorder contains the EBML header.
  // Subsequent chunks are continuation frames only; prepending this makes them valid WebM.
  private initSegment: Blob | null = null
  // True if the init segment blob was also pushed into currentChunkBlobs (user was speaking at t=0)
  private initSegmentInChunk = false

  // Transcript accumulation
  private accumulatedTranscript = ''

  // Quick response from server (set on isFinal, may be undefined if server didn't return one)
  private quickResponse: STTQuickResponse | undefined = undefined

  // True once at least one chunk has been uploaded to the server
  private anySentToServer = false

  // Tracks server-sent chunks for UI feedback
  private chunksSent = 0
  private totalSentAudioMs = 0

  // VAD-gated speech duration — totalSpeechMs never resets; currentChunkSpeechMs resets on each flush
  private totalSpeechMs = 0
  private currentChunkSpeechMs = 0

  // Serialise API calls — guarantees chunkIndex ordering even under slow network
  private sendChain: Promise<void> = Promise.resolve()

  // waitForFinalTranscript support
  private finalResolvers: Array<(result: STTFinalResult) => void> = []
  private isFinalDone = false

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(callbacks: STTServiceCallbacks): Promise<void> {
    this.callbacks = callbacks
    this.connected = true
    this.callbacks.onStatusChange?.({ connected: true, recording: false, provider: 'ramble' })
  }

  disconnect(): void {
    this.cleanup()
    this.connected = false
    this.callbacks.onStatusChange?.({ connected: false, recording: false, provider: 'ramble' })
  }

  async startRecording(): Promise<void> {
    if (!this.connected) throw new Error('Not connected')
    if (this.recording) {
      log.info('Already recording — ignoring')
      return
    }

    // Fresh state for this recording session
    this.sessionId = profileStorage.getItem(SYS1_SESSION_KEY) ?? nid.session()
    this.messageId = nid.recording()  // generated client-side, sent on every chunk
    this.chunkIndex = 0
    this.accumulatedTranscript = ''
    this.initSegment = null
    this.initSegmentInChunk = false
    this.anySentToServer = false
    this.chunksSent = 0
    this.totalSentAudioMs = 0
    this.totalSpeechMs = 0
    this.currentChunkSpeechMs = 0
    this.quickResponse = undefined
    this.currentChunkBlobs = []
    this.hasSpeechInChunk = false
    this.isSilentNow = true
    this.stopRequested = false
    this.isFinalDone = false
    this.finalResolvers = []
    this.sendChain = Promise.resolve()

    log.info('Starting', { sessionId: this.sessionId })

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })

      await this.startVAD()

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm' })

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          const isSpeaking = !this.vadActive || !this.isSilentNow

          // First blob: always save as init segment (EBML header + first audio cluster).
          // If VAD is already active at this point (user spoke immediately), also include
          // it in currentChunkBlobs so those first 200ms aren't lost.
          if (!this.initSegment) {
            this.initSegment = e.data
            if (isSpeaking) {
              this.currentChunkBlobs.push(e.data)
              this.initSegmentInChunk = true
              this.totalSpeechMs += RECORDER_TIMESLICE_MS
              this.currentChunkSpeechMs += RECORDER_TIMESLICE_MS
              eventBus.emit('stt:vad-duration', { totalSpeechMs: this.totalSpeechMs })
            }
            return
          }

          // Subsequent blobs: only accumulate during speech
          if (isSpeaking) {
            this.currentChunkBlobs.push(e.data)
            this.totalSpeechMs += RECORDER_TIMESLICE_MS
            this.currentChunkSpeechMs += RECORDER_TIMESLICE_MS
            eventBus.emit('stt:vad-duration', { totalSpeechMs: this.totalSpeechMs })
          }
        }
      }

      this.mediaRecorder.onstop = () => {
        log.info('MediaRecorder stopped — flushing final chunk')
        this.flushChunk(true)
      }

      this.mediaRecorder.start(RECORDER_TIMESLICE_MS)
      this.chunkStartTime = Date.now()

      this.checkInterval = setInterval(() => this.checkFlush(), CHECK_INTERVAL_MS)

      this.recording = true
      this.callbacks.onStatusChange?.({ connected: true, recording: true, provider: 'ramble' })
    } catch (err) {
      this.callbacks.onError?.({
        code: 'MICROPHONE_ERROR',
        message: err instanceof Error ? err.message : 'Failed to access microphone',
        provider: 'ramble',
      })
      throw err
    }
  }

  stopRecording(): void {
    if (!this.recording) return

    if (this.currentChunkSpeechMs < 1000 && !this.anySentToServer) {
      // First and only chunk, but less than 1s of actual speech — discard
      log.info('Speech audio too short (<1s) and nothing sent — discarding', { speechMs: this.currentChunkSpeechMs })
      this.cleanup()
      this.notifyFinal()
      return
    }

    log.info('Stop requested')
    this.stopRequested = true
    this.recording = false

    clearInterval(this.checkInterval!)
    this.checkInterval = null

    this.vad?.pause()

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      // ondataavailable fires with remaining audio, then onstop fires → flushChunk(true)
      this.mediaRecorder.stop()
    } else {
      this.flushChunk(true)
    }

    this.callbacks.onStatusChange?.({ connected: this.connected, recording: false, provider: 'ramble' })
  }

  async waitForFinalTranscript(timeoutMs = 15_000): Promise<STTFinalResult> {
    if (this.isFinalDone) return { transcript: this.accumulatedTranscript, quickResponse: this.quickResponse }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.finalResolvers = this.finalResolvers.filter(r => r !== onDone)
        log.warn('waitForFinalTranscript timed out, returning accumulated transcript')
        resolve({ transcript: this.accumulatedTranscript, quickResponse: this.quickResponse })
      }, timeoutMs)

      const onDone = (result: STTFinalResult) => {
        clearTimeout(timer)
        resolve(result)
      }
      this.finalResolvers.push(onDone)
    })
  }

  sendAudio(_audioData: ArrayBuffer | Blob): void {
    throw new Error('RambleSTTProvider only supports integrated microphone recording')
  }

  isConnected(): boolean { return this.connected }
  isRecording(): boolean { return this.recording }
  getProvider(): STTProvider { return 'ramble' }

  // ── VAD ───────────────────────────────────────────────────────────────

  private async startVAD(): Promise<void> {
    if (typeof (window as any).vad === 'undefined') {
      log.warn('VAD library not loaded — all audio will be sent (silence not filtered)')
      // vadActive stays false — flushChunk will skip the hasSpeechInChunk gate
      return
    }

    // Reuse the existing instance — MicVAD.new() loads the ONNX model each time,
    // so recreating it on every recording would reload it on every key press.
    if (this.vad) {
      this.vad.start()
      this.vadActive = true
      return
    }

    this.vad = await (window as any).vad.MicVAD.new({
      onSpeechStart: () => {
        this.isSilentNow = false
        this.hasSpeechInChunk = true
      },
      onSpeechEnd: () => {
        this.isSilentNow = true
      },
    })
    this.vad.start()
    this.vadActive = true
  }

  // ── Flush logic ───────────────────────────────────────────────────────

  private checkFlush(): void {
    if (this.stopRequested) return
    // When VAD is active, gate on speech detection. Without VAD we can't
    // tell silence from speech so we always allow the flush.
    if (this.vadActive && !this.hasSpeechInChunk) return

    // Thresholds are based on actual speech audio duration, not wall clock.
    // 1s speech + 5s silence + 3s speech + 4s silence = 4s speech — no flush yet.
    const speechElapsed = this.currentChunkSpeechMs
    const hitHardCap = speechElapsed >= CHUNK_MAX_MS
    const silenceWindow = speechElapsed >= CHUNK_MIN_MS && this.isSilentNow

    if (hitHardCap || silenceWindow) {
      log.info('Flushing mid-recording chunk', {
        speechS: (speechElapsed / 1000).toFixed(1),
        reason: hitHardCap ? 'hard-cap-15s-speech' : 'silence-after-10s-speech',
      })
      this.flushChunk(false)
    }
  }

  private flushChunk(isFinal: boolean): void {
    const blobs = this.currentChunkBlobs.splice(0)  // atomically take all blobs
    const durationMs = Date.now() - this.chunkStartTime
    const hadSpeech = this.hasSpeechInChunk  // capture BEFORE reset

    // Reset window for the next chunk
    this.chunkStartTime = Date.now()
    this.hasSpeechInChunk = false
    this.isSilentNow = true
    this.currentChunkSpeechMs = 0

    // Determine whether this window has audio worth sending.
    // Without VAD we can't detect silence, so we always send.
    // For the final flush, bypass the VAD gate — send whatever is buffered so the last words aren't lost.
    const hasUsableAudio = blobs.length > 0 && (!this.vadActive || hadSpeech || isFinal)

    if (!hasUsableAudio) {
      if (!isFinal) return  // mid-recording silence window — just drop it

      // Final flush with no usable audio
      if (!this.anySentToServer) {
        // Nothing was ever sent — nothing to finalize on the server
        log.info('Stop with no audio sent at all — resolving immediately')
        this.notifyFinal()
      } else {
        // Chunks were already sent — tell server to finalize without uploading new audio
        log.info('Stop with no remaining speech — sending finalize-only')
        this.sendChain = this.sendChain
          .then(() => this.sendFinalizeOnly())
          .catch(err => log.error('finalizeOnly failed:', err))
      }
      return
    }

    // Prepend init segment unless it was already pushed into blobs at recording start
    // (when the user spoke immediately and initSegmentInChunk is true for the first chunk).
    const needsPrepend = this.initSegment && !this.initSegmentInChunk
    const blobParts = needsPrepend ? [this.initSegment!, ...blobs] : blobs
    this.initSegmentInChunk = false  // only relevant for the very first chunk
    const blob = new Blob(blobParts, { type: 'audio/webm' })

    this.anySentToServer = true

    // Chain so parallel flushes never race on chunkIndex
    this.sendChain = this.sendChain
      .then(() => this.sendChunk(blob, durationMs, isFinal))
      .catch(err => log.error('sendChunk failed:', err))
  }

  private async sendFinalizeOnly(): Promise<void> {
    log.info('Finalizing audio without new audio', { messageId: this.messageId })

    const form = new FormData()
    form.append('messageId', this.messageId!)
    form.append('sessionId', this.sessionId!)
    form.append('isFinal', 'true')
    // No audio field — server routes to finalizeAudioMessage

    try {
      const res = await fetch(
        `${WORKER_URL}/api/v1/sys1/audio-chunk`,
        { method: 'POST', headers: getWorkerHeaders(), body: form }
      )

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error((errBody as any).error || `HTTP ${res.status}`)
      }

      const data = await res.json() as { ok: boolean; messageId: string; fullTranscript?: string; quickResponse?: STTQuickResponse }
      const finalText = data.fullTranscript?.trim() || this.accumulatedTranscript
      this.accumulatedTranscript = finalText
      if (data.quickResponse) this.quickResponse = data.quickResponse

      if (finalText) {
        this.callbacks.onTranscript?.({ text: finalText, isFinal: true, timestamp: Date.now() })
      }
      this.notifyFinal()
    } catch (err) {
      log.error('finalizeOnly failed:', err)
      this.callbacks.onError?.({
        code: 'TRANSCRIPTION_ERROR',
        message: err instanceof Error ? err.message : 'Failed to finalize recording',
        provider: 'ramble',
      })
      this.notifyFinal()  // don't leave waiters hanging
    }
  }

  // ── API ───────────────────────────────────────────────────────────────

  private async sendChunk(blob: Blob, durationMs: number, isFinal: boolean): Promise<void> {
    const form = new FormData()
    form.append('audio', blob, 'audio.webm')
    form.append('sessionId', this.sessionId!)
    form.append('chunkIndex', String(this.chunkIndex))
    form.append('durationMs', String(durationMs))
    form.append('messageId', this.messageId!)  // always set — generated client-side on startRecording
    if (isFinal) form.append('isFinal', 'true')

    log.info('Sending chunk', { chunkIndex: this.chunkIndex, durationS: (durationMs / 1000).toFixed(1), isFinal, bytes: blob.size })

    try {
      const res = await fetch(
        `${WORKER_URL}/api/v1/sys1/audio-chunk`,
        { method: 'POST', headers: getWorkerHeaders(), body: form }
      )

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error((errBody as any).error || `HTTP ${res.status}`)
      }

      const data = await res.json() as {
        messageId: string
        transcript: string
        fullTranscript?: string
        latencyMs?: number
        final?: boolean
        quickResponse?: STTQuickResponse
      }

      this.chunkIndex++
      this.chunksSent++
      this.totalSentAudioMs += durationMs
      eventBus.emit('stt:chunk-sent', { chunksSent: this.chunksSent, totalSentAudioMs: this.totalSentAudioMs })

      // Emit interim transcript as chunks come in
      if (data.transcript?.trim()) {
        this.accumulatedTranscript += (this.accumulatedTranscript ? ' ' : '') + data.transcript.trim()
        this.callbacks.onTranscript?.({
          text: this.accumulatedTranscript,
          isFinal: false,
          timestamp: Date.now(),
        })
      }

      if (isFinal) {
        const finalText = data.fullTranscript?.trim() || this.accumulatedTranscript
        this.accumulatedTranscript = finalText
        if (data.quickResponse) this.quickResponse = data.quickResponse
        this.callbacks.onTranscript?.({ text: finalText, isFinal: true, timestamp: Date.now() })
        this.notifyFinal()
      }
    } catch (err) {
      log.error('Chunk send failed:', err)
      this.callbacks.onError?.({
        code: 'TRANSCRIPTION_ERROR',
        message: err instanceof Error ? err.message : 'Failed to send audio chunk',
        provider: 'ramble',
      })
      if (isFinal) this.notifyFinal()  // don't leave waiters hanging on error
    }
  }

  private notifyFinal(): void {
    this.isFinalDone = true
    const result: STTFinalResult = { transcript: this.accumulatedTranscript, quickResponse: this.quickResponse }
    const resolvers = this.finalResolvers.splice(0)
    for (const r of resolvers) r(result)
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  private cleanup(): void {
    clearInterval(this.checkInterval!)
    this.checkInterval = null

    if (this.vad) {
      try { this.vad.pause(); this.vad.destroy?.() } catch { /* ignore */ }
      this.vad = null
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop()
    }
    this.mediaRecorder = null

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop())
      this.stream = null
    }

    this.recording = false
    this.currentChunkBlobs = []
  }
}
