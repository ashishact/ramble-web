/**
 * Groq Whisper STT Provider
 *
 * Ultra-fast Whisper API with intelligent chunking
 * Supports 2 chunking strategies:
 *   1. Simple: Send entire recording (default)
 *   2. VAD-based: Split using Voice Activity Detection (@ricky0123/vad-web)
 *
 * Constraints:
 *   - Optimal: 10-30 seconds per chunk
 *   - Max: 3 minutes per chunk (hard limit)
 *   - Never cut during speech
 */

import type {
  ISTTProvider,
  STTConfig,
  STTServiceCallbacks,
  STTProvider,
} from '../types';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

// Chunking configuration
const CHUNK_MIN_DURATION = 10; // seconds

export type ChunkingStrategy = 'simple' | 'vad';

export interface GroqWhisperConfig extends STTConfig {
  chunkingStrategy?: ChunkingStrategy;
}

interface AudioChunk {
  blob: Blob;
  startTime: number;
  endTime: number;
  duration: number;
}

export class GroqWhisperProvider implements ISTTProvider {
  private config: GroqWhisperConfig;
  private callbacks: STTServiceCallbacks = {};
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private connected = false;
  private recording = false;
  private chunkingStrategy: ChunkingStrategy;
  private providerType: STTProvider;

  // For VAD-based chunking
  private vad: any = null;
  private vadAudioChunks: Float32Array[] = [];
  private vadAccumulatedDuration = 0; // Total duration of accumulated speech in seconds

  // Accumulated transcript
  private fullTranscript = '';
  private pendingChunks: AudioChunk[] = [];
  private isProcessing = false;
  private waitingForFinalBlob = false; // True when stopRecording called, waiting for onstop

  constructor(config: GroqWhisperConfig) {
    if (!config.provider) {
      throw new Error('Provider must be specified in config');
    }
    this.config = config;
    this.providerType = config.provider;
    this.chunkingStrategy = config.chunkingStrategy || 'simple';
  }

  async connect(callbacks: STTServiceCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.connected = true;
    this.fullTranscript = '';
    this.callbacks.onStatusChange?.({
      connected: true,
      recording: false,
      provider: this.providerType,
    });
  }

  disconnect(): void {
    this.cleanup();
    this.connected = false;
    this.callbacks.onStatusChange?.({
      connected: false,
      recording: false,
      provider: this.providerType,
    });
  }

  /**
   * Ensure microphone stream is open (called once, kept open)
   */
  private async ensureMicrophoneStream(): Promise<void> {
    if (this.stream) return; // Already have a stream

    console.log('[GroqWhisper] Opening microphone stream...');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[GroqWhisper] Microphone stream opened');
  }

  async startRecording(): Promise<void> {
    if (!this.connected) {
      throw new Error('Cannot start recording: not connected');
    }
    if (this.recording) {
      console.log('[GroqWhisper] Already recording, ignoring startRecording');
      return;
    }

    try {
      // Ensure microphone is open (fast if already open)
      await this.ensureMicrophoneStream();

      this.fullTranscript = '';
      this.pendingChunks = [];
      this.transcriptResolvers = [];
      this.waitingForFinalBlob = false;

      // Initialize based on chunking strategy
      switch (this.chunkingStrategy) {
        case 'simple':
          await this.startSimpleRecording();
          break;
        case 'vad':
          await this.startVADBasedRecording();
          break;
      }

      this.recording = true;
      this.callbacks.onStatusChange?.({
        connected: true,
        recording: true,
        provider: this.providerType,
      });
    } catch (err) {
      this.callbacks.onError?.({
        code: 'MICROPHONE_ERROR',
        message: err instanceof Error ? err.message : 'Failed to access microphone',
        provider: this.providerType,
      });
      throw err;
    }
  }

  // Resolvers waiting for final transcript
  private transcriptResolvers: Array<(transcript: string) => void> = [];

  stopRecording(): void {
    if (!this.recording) {
      console.log('[GroqWhisper] Not recording, ignoring stopRecording');
      return;
    }

    console.log('[GroqWhisper] stopRecording called');

    // For VAD: send any remaining accumulated chunks before stopping
    if (this.chunkingStrategy === 'vad' && this.vadAudioChunks.length > 0) {
      console.log('[VAD] Sending remaining chunks on stop:', this.vadAccumulatedDuration.toFixed(2), 'seconds');
      this.processVADChunks();
    }

    // For simple mode: mark that we're waiting for the final blob from onstop
    if (this.chunkingStrategy === 'simple' && this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.waitingForFinalBlob = true;
      console.log('[GroqWhisper] Waiting for final audio blob...');
    }

    // Stop MediaRecorder but DON'T close the stream
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.recording = false;

    // Cleanup strategy-specific resources (VAD state, etc.) but NOT the stream
    this.cleanupChunkingResources();

    this.callbacks.onStatusChange?.({
      connected: this.connected,
      recording: false,
      provider: this.providerType,
    });

    console.log('[GroqWhisper] stopRecording complete, microphone stream kept open');
  }

  /**
   * Notify any waiting resolvers that transcript is ready
   */
  private notifyTranscriptReady(): void {
    const resolvers = this.transcriptResolvers;
    this.transcriptResolvers = [];
    for (const resolve of resolvers) {
      resolve(this.fullTranscript);
    }
  }

  /**
   * Wait for final transcript after stopping recording
   * Returns immediately if transcript is already ready, otherwise waits
   */
  async waitForFinalTranscript(timeoutMs = 10000): Promise<string> {
    console.log('[GroqWhisper] waitForFinalTranscript called, state:', {
      waitingForFinalBlob: this.waitingForFinalBlob,
      isProcessing: this.isProcessing,
      pendingChunks: this.pendingChunks.length,
    });

    // If nothing is processing AND not waiting for blob, return immediately
    if (!this.waitingForFinalBlob && !this.isProcessing && this.pendingChunks.length === 0) {
      console.log('[GroqWhisper] Returning immediately with transcript:', this.fullTranscript.slice(0, 50));
      return this.fullTranscript;
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        // Remove from resolvers and return what we have
        const idx = this.transcriptResolvers.indexOf(resolverWithCleanup);
        if (idx > -1) this.transcriptResolvers.splice(idx, 1);
        console.log('[GroqWhisper] waitForFinalTranscript timeout, returning:', this.fullTranscript.slice(0, 50));
        resolve(this.fullTranscript);
      }, timeoutMs);

      // Resolver that clears timeout
      const resolverWithCleanup = (transcript: string) => {
        clearTimeout(timeoutId);
        console.log('[GroqWhisper] waitForFinalTranscript resolved with:', transcript.slice(0, 50));
        resolve(transcript);
      };

      this.transcriptResolvers.push(resolverWithCleanup);
    });
  }

  async sendAudio(audioData: ArrayBuffer | Blob): Promise<void> {
    if (!this.connected) {
      throw new Error('Cannot send audio: not connected');
    }

    const blob = audioData instanceof Blob ? audioData : new Blob([audioData]);
    await this.transcribeAudio(blob);
  }

  isConnected(): boolean {
    return this.connected;
  }

  isRecording(): boolean {
    return this.recording;
  }

  getProvider(): STTProvider {
    return this.providerType;
  }

  // ========================================================================
  // Strategy 1: Simple - Send entire recording
  // ========================================================================

  private async startSimpleRecording(): Promise<void> {
    this.mediaRecorder = new MediaRecorder(this.stream!, { mimeType: 'audio/webm' });
    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = async () => {
      // Clear the waiting flag - we have the blob now
      this.waitingForFinalBlob = false;
      console.log('[GroqWhisper] Got final audio blob, transcribing...');

      const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
      await this.transcribeAudio(blob);
      this.audioChunks = [];
      // Don't cleanup audio - keep mic stream open for faster next recording
    };

    this.mediaRecorder.start();
  }

  // ========================================================================
  // Strategy 2: VAD-based chunking
  // ========================================================================

  private async startVADBasedRecording(): Promise<void> {
    // Check if VAD is available (loaded from CDN in index.html)
    if (typeof (window as any).vad === 'undefined') {
      console.warn('VAD not available, falling back to simple chunking');
      return this.startSimpleRecording();
    }

    // Initialize VAD
    this.vad = await (window as any).vad.MicVAD.new({
      onSpeechStart: () => {
        console.log('Speech started');
      },
      onSpeechEnd: async (audio: Float32Array) => {
        const chunkDuration = audio.length / 16000;
        console.log('[VAD] Speech ended, duration:', chunkDuration.toFixed(2), 'seconds');

        // Accumulate this speech chunk (silence is discarded)
        this.vadAudioChunks.push(audio);
        this.vadAccumulatedDuration += chunkDuration;

        console.log('[VAD] Total accumulated speech:', this.vadAccumulatedDuration.toFixed(2), 'seconds');

        // Send if we have at least 10 seconds of speech and silence continues
        if (this.vadAccumulatedDuration >= CHUNK_MIN_DURATION) {
          console.log('[VAD] Sending accumulated speech chunks to API');
          await this.processVADChunks();
        } else {
          console.log('[VAD] Waiting for more speech (need', CHUNK_MIN_DURATION, 'seconds minimum)');
        }
      },
    });

    this.vad.start();
  }

  private async processVADChunks(): Promise<void> {
    if (this.vadAudioChunks.length === 0) return;

    // Combine all speech chunks into single Float32Array
    const totalLength = this.vadAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.vadAudioChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    console.log('[VAD] Combined', this.vadAudioChunks.length, 'speech chunks into', this.vadAccumulatedDuration.toFixed(2), 'seconds');

    // Convert to WAV
    const blob = this.float32ToWav(combined, 16000);

    // Clear accumulated chunks
    this.vadAudioChunks = [];
    this.vadAccumulatedDuration = 0;

    // Send to API
    this.queueTranscription(blob);
  }

  private float32ToWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);

    // Convert samples
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // ========================================================================
  // Transcription Queue Management
  // ========================================================================

  private async queueTranscription(blob: Blob): Promise<void> {
    const chunk: AudioChunk = {
      blob,
      startTime: 0,
      endTime: 0,
      duration: 0,
    };

    this.pendingChunks.push(chunk);

    // Process queue if not already processing
    if (!this.isProcessing) {
      this.processTranscriptionQueue();
    }
  }

  private async processTranscriptionQueue(): Promise<void> {
    if (this.pendingChunks.length === 0) {
      this.isProcessing = false;
      // Notify any waiting resolvers that queue is empty
      this.notifyTranscriptReady();
      return;
    }

    this.isProcessing = true;
    const chunk = this.pendingChunks.shift()!;

    try {
      await this.transcribeAudio(chunk.blob, false); // Don't send final event
    } catch (err) {
      console.error('Failed to transcribe chunk:', err);
    }

    // Process next chunk
    this.processTranscriptionQueue();
  }

  // ========================================================================
  // Transcription
  // ========================================================================

  private async transcribeAudio(audioBlob: Blob, isFinal = true): Promise<void> {
    try {
      console.log('[GroqWhisper] Transcribing audio blob:', {
        size: audioBlob.size,
        type: audioBlob.type,
        hasApiKey: !!this.config.apiKey,
        apiKeyLength: this.config.apiKey?.length
      });

      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', this.config.model || 'whisper-large-v3-turbo');
      formData.append('apiKey', this.config.apiKey);

      const response = await fetch(`${WORKER_URL}/api/groq-whisper`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Transcription failed: ${errorData.error || response.statusText}`);
      }

      const data = await response.json();
      const text = data.text || '';

      if (text.trim()) {
        // Accumulate to full transcript
        this.fullTranscript += (this.fullTranscript ? ' ' : '') + text.trim();

        // Send interim result (accumulated so far)
        this.callbacks.onTranscript?.({
          text: this.fullTranscript,
          isFinal,
          timestamp: Date.now(),
        });
      }

      // Check if this was the last pending chunk and notify resolvers
      if (this.pendingChunks.length === 0 && !this.isProcessing) {
        this.notifyTranscriptReady();
      }
    } catch (err) {
      this.callbacks.onError?.({
        code: 'TRANSCRIPTION_ERROR',
        message: err instanceof Error ? err.message : 'Failed to transcribe audio',
        provider: this.providerType,
      });

      // Still notify on error so waiters don't hang
      if (this.pendingChunks.length === 0) {
        this.notifyTranscriptReady();
      }
    }
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  private cleanupChunkingResources(): void {
    // VAD cleanup
    if (this.vad) {
      // VAD doesn't have a destroy method, just set to null
      this.vad = null;
    }
    this.vadAudioChunks = [];
    this.vadAccumulatedDuration = 0;
  }

  private cleanupAudio(): void {
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
  }

  private cleanup(): void {
    this.cleanupChunkingResources();
    this.cleanupAudio();
    this.recording = false;
    this.pendingChunks = [];
    this.isProcessing = false;
  }
}
