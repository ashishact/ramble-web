/**
 * Groq Whisper STT Provider
 *
 * Ultra-fast Whisper API with intelligent chunking
 * Supports 3 chunking strategies:
 *   1. Simple: Send entire recording (default)
 *   2. Silence-based: Split on silence detection using frequency analysis
 *   3. VAD-based: Split using Voice Activity Detection (@ricky0123/vad-web)
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
const CHUNK_OPTIMAL_MAX = 30; // seconds
const CHUNK_SOFT_MAX = 60; // seconds (1 minute)
const CHUNK_HARD_MAX = 180; // seconds (3 minutes - absolute max)
const SILENCE_THRESHOLD = 0.01; // RMS threshold for silence
const SILENCE_MIN_DURATION = 0.5; // seconds of silence to trigger split

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
  private recordingStartTime = 0;
  private chunkingStrategy: ChunkingStrategy;

  // For silence-based chunking
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private silenceStartTime: number | null = null;
  private lastChunkTime = 0;

  // For VAD-based chunking
  private vad: any = null;
  private vadAudioChunks: Float32Array[] = [];
  private vadAccumulatedDuration = 0; // Total duration of accumulated speech in seconds

  // Accumulated transcript
  private fullTranscript = '';
  private pendingChunks: AudioChunk[] = [];
  private isProcessing = false;

  constructor(config: GroqWhisperConfig) {
    this.config = config;
    this.chunkingStrategy = config.chunkingStrategy || 'simple';
  }

  async connect(callbacks: STTServiceCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.connected = true;
    this.fullTranscript = '';
    this.callbacks.onStatusChange?.({
      connected: true,
      recording: false,
      provider: this.config.provider,
    });
  }

  disconnect(): void {
    this.cleanup();
    this.connected = false;
    this.callbacks.onStatusChange?.({
      connected: false,
      recording: false,
      provider: this.config.provider,
    });
  }

  async startRecording(): Promise<void> {
    if (!this.connected || this.recording) {
      throw new Error('Cannot start recording: not connected or already recording');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.recordingStartTime = Date.now();
      this.lastChunkTime = 0;
      this.fullTranscript = '';
      this.pendingChunks = [];

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
        provider: this.config.provider,
      });
    } catch (err) {
      this.callbacks.onError?.({
        code: 'MICROPHONE_ERROR',
        message: err instanceof Error ? err.message : 'Failed to access microphone',
        provider: this.config.provider,
      });
      throw err;
    }
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.recording) {
      this.mediaRecorder.stop();
      this.recording = false;
    }

    // For VAD: send any remaining accumulated chunks
    if (this.chunkingStrategy === 'vad' && this.vadAudioChunks.length > 0) {
      console.log('[VAD] Sending remaining chunks on stop:', this.vadAccumulatedDuration.toFixed(2), 'seconds');
      this.processVADChunks();
    }

    // Cleanup strategy-specific resources
    this.cleanupChunkingResources();

    this.callbacks.onStatusChange?.({
      connected: this.connected,
      recording: false,
      provider: this.config.provider,
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
    return this.config.provider;
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
      const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
      await this.transcribeAudio(blob);
      this.audioChunks = [];
      this.cleanupAudio();
    };

    this.mediaRecorder.start();
  }

  // ========================================================================
  // Strategy 2: Silence-based chunking (frequency analysis)
  // ========================================================================

  private async startSilenceBasedRecording(): Promise<void> {
    // Setup audio analysis
    this.audioContext = new AudioContext();
    this.source = this.audioContext.createMediaStreamSource(this.stream!);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;

    this.source.connect(this.analyser);

    // Setup MediaRecorder
    this.mediaRecorder = new MediaRecorder(this.stream!, { mimeType: 'audio/webm' });
    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    // Start recording
    this.mediaRecorder.start(100); // Collect data every 100ms

    // Monitor for silence
    this.monitorSilence();
  }

  private monitorSilence(): void {
    if (!this.analyser || !this.recording) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteTimeDomainData(dataArray);

    // Calculate RMS (Root Mean Square) for volume
    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / bufferLength);

    const currentTime = (Date.now() - this.recordingStartTime) / 1000;
    const timeSinceLastChunk = currentTime - this.lastChunkTime;

    // Detect silence
    if (rms < SILENCE_THRESHOLD) {
      if (this.silenceStartTime === null) {
        this.silenceStartTime = Date.now();
      }

      const silenceDuration = (Date.now() - this.silenceStartTime) / 1000;

      // Should we split here?
      const shouldSplitOptimal = timeSinceLastChunk >= CHUNK_OPTIMAL_MAX && silenceDuration >= SILENCE_MIN_DURATION;
      const shouldSplitSoft = timeSinceLastChunk >= CHUNK_SOFT_MAX && silenceDuration >= SILENCE_MIN_DURATION / 2;
      const shouldSplitHard = timeSinceLastChunk >= CHUNK_HARD_MAX;

      if ((shouldSplitOptimal || shouldSplitSoft || shouldSplitHard) && timeSinceLastChunk >= CHUNK_MIN_DURATION) {
        console.log('[Silence] Splitting chunk:', { timeSinceLastChunk, silenceDuration });
        this.splitAndTranscribe();
      }
    } else {
      this.silenceStartTime = null;
    }

    // Continue monitoring
    if (this.recording) {
      requestAnimationFrame(() => this.monitorSilence());
    }
  }

  private async splitAndTranscribe(): Promise<void> {
    if (this.audioChunks.length === 0) {
      console.log('[Silence] No audio chunks to transcribe');
      return;
    }

    console.log('[Silence] Creating blob from', this.audioChunks.length, 'chunks');

    // Create blob from current chunks
    const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
    this.audioChunks = [];

    const currentTime = (Date.now() - this.recordingStartTime) / 1000;
    this.lastChunkTime = currentTime;
    this.silenceStartTime = null;

    // Transcribe in background
    this.queueTranscription(blob);
  }

  // ========================================================================
  // Strategy 3: VAD-based chunking
  // ========================================================================

  private async startVADBasedRecording(): Promise<void> {
    // Check if VAD is available (loaded from CDN in index.html)
    if (typeof (window as any).vad === 'undefined') {
      console.warn('VAD not available, falling back to silence-based chunking');
      return this.startSilenceBasedRecording();
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
      startTime: this.lastChunkTime,
      endTime: (Date.now() - this.recordingStartTime) / 1000,
      duration: blob.size / (16000 * 2), // Rough estimate
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
    } catch (err) {
      this.callbacks.onError?.({
        code: 'TRANSCRIPTION_ERROR',
        message: err instanceof Error ? err.message : 'Failed to transcribe audio',
        provider: this.config.provider,
      });
    }
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  private cleanupChunkingResources(): void {
    // Silence-based cleanup
    if (this.analyser) {
      this.analyser.disconnect();
      this.analyser = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    // VAD cleanup
    if (this.vad) {
      // VAD doesn't have a destroy method, just set to null
      this.vad = null;
    }
    this.vadAudioChunks = [];
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
