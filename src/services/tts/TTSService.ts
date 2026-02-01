/**
 * TTS Service - Singleton with lazy model loading, chunk-based playback, and queue support
 * Based on Stobo's NarratorStream implementation
 */

import type { KokoroTTS } from 'kokoro-js';
import type {
  TTSPlaybackState,
  TTSProgressInfo,
  TTSConfig,
  TTSCallbacks,
  QueuedItem,
  TTSPart,
} from './types';
import { DEFAULT_VOICE } from './voices';
import { splitParagraph, sanitizeText, sanitizeChunk } from './textChunker';
import { eventBus } from '../../lib/eventBus';

// v1.0 model with 54 voices and 8 languages
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

let partIdCounter = 0;
function generatePartId(): string {
  return `tts-part-${++partIdCounter}`;
}

class TTSService {
  private static instance: TTSService | null = null;

  private tts: KokoroTTS | null = null;
  private isLoadingModel = false;
  private isGenerating = false;

  // Chunk-based playback (like NarratorStream)
  private parts: TTSPart[] = [];
  private currentPartId: string = '';
  private playingAudioElement: HTMLAudioElement | null = null;

  private queue: QueuedItem[] = [];
  private isProcessingQueue = false;

  private currentVoice: string = DEFAULT_VOICE;
  private currentWords: string[] = [];
  private playbackState: TTSPlaybackState = 'idle';

  private callbacks: TTSCallbacks = {};

  // Navigation debounce - for smooth chunk skipping
  private navigationTimeout: ReturnType<typeof setTimeout> | null = null;

  private constructor() {}

  static getInstance(): TTSService {
    if (!TTSService.instance) {
      TTSService.instance = new TTSService();
    }
    return TTSService.instance;
  }

  setCallbacks(callbacks: TTSCallbacks): void {
    this.callbacks = callbacks;
  }

  getPlaybackState(): TTSPlaybackState {
    return this.playbackState;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getCurrentWords(): string[] {
    return this.currentWords;
  }

  getParts(): TTSPart[] {
    return this.parts;
  }

  getCurrentPartId(): string {
    return this.currentPartId;
  }

  private setState(state: TTSPlaybackState): void {
    this.playbackState = state;
    this.callbacks.onStateChange?.(state);
  }

  private notifyProgress(progress: TTSProgressInfo): void {
    this.callbacks.onProgress?.(progress);
  }

  private notifyQueueChange(): void {
    this.callbacks.onQueueChange?.(this.queue.length);
  }

  private notifyPartChange(): void {
    this.callbacks.onPartChange?.(this.currentPartId, this.parts);
  }

  private async loadModel(): Promise<KokoroTTS | null> {
    if (this.tts) return this.tts;
    if (this.isLoadingModel) return null;

    this.isLoadingModel = true;
    this.setState('loading-model');

    try {
      // Dynamic import for lazy loading
      const { KokoroTTS } = await import('kokoro-js');

      // Match Stobo's config exactly - no dtype, just webgpu
      this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        device: 'webgpu',
        progress_callback: (progress: { progress?: number; status?: string }) => {
          this.notifyProgress({
            type: 'model-download',
            progress: progress.progress ?? 0,
            message: progress.status,
          });
        },
      });

      this.isLoadingModel = false;
      this.setState('idle');
      return this.tts;
    } catch (error) {
      this.isLoadingModel = false;
      this.setState('idle');
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Generate TTS audio for a specific part (doesn't play it)
   */
  private async generateTTSForPart(part: TTSPart): Promise<boolean> {
    if (part.audio) return true; // Already generated

    const tts = await this.loadModel();
    if (!tts) return false;

    try {
      // Sanitize the chunk text for TTS (handles any remaining punctuation issues)
      const textForTTS = sanitizeChunk(part.text);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audio = await tts.generate(textForTTS, { voice: this.currentVoice as any });
      const blob = audio.toBlob();
      const audioElement = new Audio(URL.createObjectURL(blob));

      part.audio = { element: audioElement, blob };

      // Emit event: audio generation completed for this part
      eventBus.emit('tts:generated', { partId: part.id, text: part.text });

      return true;
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      return false;
    }
  }

  /**
   * Get the currently playing part
   */
  private getPlayingPart(): TTSPart | null {
    return this.parts.find(p => p.id === this.currentPartId) || null;
  }

  /**
   * Get the next part after current
   */
  private getNextPart(): TTSPart | null {
    const idx = this.parts.findIndex(p => p.id === this.currentPartId);
    if (idx === -1) return this.parts[0] || null;
    return this.parts[idx + 1] || null;
  }

  /**
   * Get the previous part before current
   */
  private getPrevPart(): TTSPart | null {
    const idx = this.parts.findIndex(p => p.id === this.currentPartId);
    if (idx <= 0) return null;
    return this.parts[idx - 1] || null;
  }

  /**
   * Play from current part (or first if none set)
   */
  private async play(): Promise<void> {
    let current = this.getPlayingPart();
    if (!current) {
      current = this.parts[0];
      if (!current) return; // No text to play
    }

    // Generate TTS if not already done
    if (!current.audio) {
      this.isGenerating = true;
      this.setState('generating');
      const success = await this.generateTTSForPart(current);
      this.isGenerating = false;
      if (!success || !current.audio) {
        this.setState('idle');
        return;
      }
    }

    const audioElement = current.audio.element;

    // Set as current and notify
    this.currentPartId = current.id;
    this.notifyPartChange();

    // Stop previous audio if any
    if (this.playingAudioElement && this.playingAudioElement !== audioElement) {
      this.smoothPause(this.playingAudioElement);
    }

    this.playingAudioElement = audioElement;

    // Setup word highlighting for this chunk
    this.setupWordHighlight(audioElement, current.text);

    // Play - reset volume (may have been faded out) and position
    audioElement.volume = 1;
    audioElement.currentTime = 0;
    audioElement.play();
    this.setState('playing');

    // Emit event: playback started
    eventBus.emit('tts:started', { partId: current.id });

    // Auto-play next on end
    audioElement.onended = () => {
      const next = this.getNextPart();
      if (next) {
        this.playNext();
      } else {
        // All chunks done - check queue before going idle
        if (this.queue.length > 0) {
          // Process next queued item without going idle
          this.processQueue();
        } else {
          // Truly done - emit event and go idle
          eventBus.emit('tts:ended', { reason: 'completed' });
          this.setState('idle');
        }
      }
    };

    // Pre-generate TTS for next part while current plays
    const next = this.getNextPart();
    if (next && !next.audio) {
      this.generateTTSForPart(next);
    }
  }

  async speak(text: string, config?: TTSConfig): Promise<void> {
    const voice = config?.voice || this.currentVoice;
    this.currentVoice = voice;

    const sanitized = sanitizeText(text);
    if (!sanitized) return;

    const tts = await this.loadModel();
    if (!tts) return;

    if (this.isGenerating) {
      console.log('Already generating audio, skipping...');
      return;
    }

    // Split into chunks - paragraphs first, then sentences
    const chunks = splitParagraph(sanitized, 350);
    this.currentWords = sanitized.split(' ');

    // Create parts with IDs and paragraph info
    this.parts = chunks.map(chunk => ({
      id: generatePartId(),
      text: chunk.text,
      isFirstInParagraph: chunk.isFirstInParagraph,
    }));
    this.currentPartId = '';

    console.log('TTS Generating', text, chunks);

    // Start playback from first part
    await this.play();
  }

  private setupWordHighlight(audio: HTMLAudioElement, text: string): void {
    const words = text.split(' ');

    const onTimeUpdate = () => {
      const currentTime = audio.currentTime;
      // Apply offset like Stobo does to account for silence at end
      const totalDuration = Math.max(audio.duration - 0.5, 0.1);

      let percent = currentTime / totalDuration;
      if (percent > 1) percent = 1;

      const wordIndex = Math.floor(percent * words.length);
      const clampedIndex = Math.min(wordIndex, words.length - 1);
      this.callbacks.onWordHighlight?.(clampedIndex, words[clampedIndex] || '');
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
    });
  }

  /**
   * Schedule play after navigation delay (debounced)
   */
  private schedulePlay(): void {
    // Cancel any pending play
    if (this.navigationTimeout) {
      clearTimeout(this.navigationTimeout);
    }

    // Schedule new play after 250ms
    this.navigationTimeout = setTimeout(() => {
      this.navigationTimeout = null;
      this.play();
    }, 250);
  }

  /**
   * Play next chunk - navigation is instant, playback is debounced
   */
  playNext(): void {
    const next = this.getNextPart();
    if (!next) return;

    // Pause current audio immediately
    if (this.playingAudioElement) {
      this.playingAudioElement.pause();
    }

    // Update current part immediately (UI updates instantly)
    this.currentPartId = next.id;
    this.notifyPartChange();

    // Reset audio position if it was played before
    if (next.audio?.element) {
      next.audio.element.currentTime = 0;
    }

    // Debounced play - only plays after user stops navigating
    this.schedulePlay();
  }

  /**
   * Play previous chunk - navigation is instant, playback is debounced
   */
  playPrev(): void {
    const prev = this.getPrevPart();
    if (!prev) {
      // If no prev, restart current from beginning
      if (this.navigationTimeout) {
        clearTimeout(this.navigationTimeout);
        this.navigationTimeout = null;
      }
      if (this.playingAudioElement) {
        this.playingAudioElement.currentTime = 0;
        this.playingAudioElement.volume = 1;
        this.playingAudioElement.play();
        this.setState('playing');
      }
      return;
    }

    // Pause current audio immediately
    if (this.playingAudioElement) {
      this.playingAudioElement.pause();
    }

    // Update current part immediately (UI updates instantly)
    this.currentPartId = prev.id;
    this.notifyPartChange();

    // Reset audio position
    if (prev.audio?.element) {
      prev.audio.element.currentTime = 0;
    }

    // Debounced play - only plays after user stops navigating
    this.schedulePlay();
  }

  queueText(text: string, voice?: string): void {
    this.queue.push({
      text,
      voice: voice || this.currentVoice,
    });
    this.notifyQueueChange();

    if (this.playbackState === 'idle' && !this.isProcessingQueue) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessingQueue = false;
      return;
    }

    this.isProcessingQueue = true;
    const next = this.queue.shift()!;
    this.notifyQueueChange();

    await this.speak(next.text, { voice: next.voice });
  }

  stop(): void {
    // Check if we were actually playing something (to emit cancelled event)
    const wasPlaying = this.playbackState === 'playing' || this.playbackState === 'generating' || this.playbackState === 'paused';

    // Clear queue
    this.queue = [];
    this.notifyQueueChange();

    // Stop current audio with smooth fade
    if (this.playingAudioElement) {
      this.smoothPause(this.playingAudioElement);
    }

    // Clear all parts
    this.parts = [];
    this.currentPartId = '';
    this.playingAudioElement = null;
    this.isGenerating = false;
    this.isProcessingQueue = false;

    // Emit cancelled event if we were actively playing/generating
    if (wasPlaying) {
      eventBus.emit('tts:cancelled', { reason: 'user-stopped' });
    }

    this.setState('idle');
    this.notifyPartChange();
  }

  pause(): void {
    if (this.playingAudioElement && this.playbackState === 'playing') {
      this.playingAudioElement.pause();
      this.setState('paused');
    }
  }

  resume(): void {
    if (this.playingAudioElement && this.playbackState === 'paused') {
      this.playingAudioElement.play();
      this.setState('playing');
    }
  }

  private smoothPause(audioElement: HTMLAudioElement, duration = 300): void {
    const step = 50;
    const volumeStep = audioElement.volume / (duration / step);

    const fadeOut = setInterval(() => {
      if (audioElement.volume > volumeStep) {
        audioElement.volume -= volumeStep;
      } else {
        audioElement.volume = 0;
        audioElement.pause();
        clearInterval(fadeOut);
      }
    }, step);
  }

  setVoice(voice: string): void {
    this.currentVoice = voice;
  }

  getVoice(): string {
    return this.currentVoice;
  }

  /**
   * Get current audio element for external gradient updates
   */
  getPlayingAudioElement(): HTMLAudioElement | null {
    return this.playingAudioElement;
  }
}

export const ttsService = TTSService.getInstance();
export default ttsService;
