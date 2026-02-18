/**
 * Mistral STT Provider (Voxtral)
 *
 * Batch HTTP STT via Cloudflare worker proxy at /api/ramble/mistral-stt
 * Uses voxtral-mini-latest model (hardcoded on worker side)
 * Supports same chunking strategies as GroqWhisperProvider
 */

import type {
  ISTTProvider,
  STTConfig,
  STTServiceCallbacks,
  STTProvider,
} from '../types';
import { eventBus } from '../../../lib/eventBus';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

// Chunking configuration
const CHUNK_MIN_DURATION = 10; // seconds

export type ChunkingStrategy = 'simple' | 'vad';

export interface MistralSTTConfig extends STTConfig {
  chunkingStrategy?: ChunkingStrategy;
}

interface AudioChunk {
  blob: Blob;
  startTime: number;
  endTime: number;
  duration: number;
}

export class MistralProvider implements ISTTProvider {
  private config: MistralSTTConfig;
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
  private vadAccumulatedDuration = 0;
  private vadSpeechActive = false; // true between onSpeechStart and onSpeechEnd

  // Accumulated transcript
  private fullTranscript = '';
  private pendingChunks: AudioChunk[] = [];
  private isProcessing = false;
  private waitingForFinalBlob = false;

  constructor(config: MistralSTTConfig) {
    if (!config.provider) {
      throw new Error('Provider must be specified in config');
    }
    this.config = config;
    this.providerType = config.provider;
    this.chunkingStrategy = config.chunkingStrategy || 'simple';
  }

  async connect(callbacks: STTServiceCallbacks): Promise<void> {
    console.log('[Mistral STT] Connecting');
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
    console.log('[Mistral STT] Disconnecting — will destroy VAD');
    this.cleanup();
    this.connected = false;
    this.callbacks.onStatusChange?.({
      connected: false,
      recording: false,
      provider: this.providerType,
    });
  }

  private async ensureMicrophoneStream(): Promise<void> {
    if (this.stream) return;
    console.log('[Mistral STT] Opening microphone stream...');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[Mistral STT] Microphone stream opened');
  }

  async startRecording(): Promise<void> {
    if (!this.connected) {
      throw new Error('Cannot start recording: not connected');
    }
    if (this.recording) {
      console.log('[Mistral STT] Already recording, ignoring startRecording');
      return;
    }

    try {
      await this.ensureMicrophoneStream();

      this.fullTranscript = '';
      this.pendingChunks = [];
      this.transcriptResolvers = [];
      this.waitingForFinalBlob = false;
      this.vadSpeechActive = false;

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

  private transcriptResolvers: Array<(transcript: string) => void> = [];

  stopRecording(): void {
    if (!this.recording) {
      console.log('[Mistral STT] Not recording, ignoring stopRecording');
      return;
    }

    console.log('[Mistral STT] stopRecording called, vadSpeechActive:', this.vadSpeechActive, 'vadChunks:', this.vadAudioChunks.length);

    // Pause VAD FIRST — triggers onSpeechEnd for in-progress speech.
    // recording is still true here, so onSpeechEnd will accept the audio.
    // If onSpeechEnd fires async, vadSpeechActive stays true as a wait signal.
    if (this.chunkingStrategy === 'vad' && this.vad) {
      this.vad.pause();
    }

    // Send any accumulated VAD chunks (including from the pause flush above)
    if (this.chunkingStrategy === 'vad' && this.vadAudioChunks.length > 0) {
      console.log('[VAD] Sending remaining chunks on stop:', this.vadAccumulatedDuration.toFixed(2), 'seconds');
      this.processVADChunks();
    }

    if (this.chunkingStrategy === 'simple' && this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.waitingForFinalBlob = true;
      console.log('[Mistral STT] Waiting for final audio blob...');
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    this.recording = false;
    // Don't clear vadSpeechActive — let onSpeechEnd clear it naturally.
    // If onSpeechEnd hasn't fired yet, vadSpeechActive tells waitForFinalTranscript to wait.
    this.cleanupChunkingResources();

    this.callbacks.onStatusChange?.({
      connected: this.connected,
      recording: false,
      provider: this.providerType,
    });

    console.log('[Mistral STT] stopRecording complete, microphone stream kept open');
  }

  private notifyTranscriptReady(): void {
    const resolvers = this.transcriptResolvers;
    this.transcriptResolvers = [];
    for (const resolve of resolvers) {
      resolve(this.fullTranscript);
    }
  }

  async waitForFinalTranscript(timeoutMs = 10000): Promise<string> {
    console.log('[Mistral STT] waitForFinalTranscript called, state:', {
      waitingForFinalBlob: this.waitingForFinalBlob,
      isProcessing: this.isProcessing,
      pendingChunks: this.pendingChunks.length,
      vadSpeechActive: this.vadSpeechActive,
    });

    if (!this.waitingForFinalBlob && !this.isProcessing && this.pendingChunks.length === 0 && !this.vadSpeechActive) {
      console.log('[Mistral STT] Returning immediately with transcript:', this.fullTranscript.slice(0, 50));
      return this.fullTranscript;
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        const idx = this.transcriptResolvers.indexOf(resolverWithCleanup);
        if (idx > -1) this.transcriptResolvers.splice(idx, 1);
        console.log('[Mistral STT] waitForFinalTranscript timeout, returning:', this.fullTranscript.slice(0, 50));
        resolve(this.fullTranscript);
      }, timeoutMs);

      const resolverWithCleanup = (transcript: string) => {
        clearTimeout(timeoutId);
        console.log('[Mistral STT] waitForFinalTranscript resolved with:', transcript.slice(0, 50));
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
      this.waitingForFinalBlob = false;
      console.log('[Mistral STT] Got final audio blob, transcribing...');
      const blob = new Blob(this.audioChunks, { type: 'audio/webm' });
      await this.transcribeAudio(blob);
      this.audioChunks = [];
    };

    this.mediaRecorder.start();
  }

  // ========================================================================
  // Strategy 2: VAD-based chunking
  // ========================================================================

  private async startVADBasedRecording(): Promise<void> {
    if (typeof (window as any).vad === 'undefined') {
      console.warn('VAD not available, falling back to simple chunking');
      return this.startSimpleRecording();
    }

    // Reuse existing VAD instance if already initialized (kept alive between recordings)
    if (this.vad) {
      console.log('[Mistral STT] Reusing existing VAD instance');
      this.vad.start();
      return;
    }

    this.vad = await (window as any).vad.MicVAD.new({
      onSpeechStart: () => {
        this.vadSpeechActive = true;
        console.log('[VAD] Speech started');
        eventBus.emit('stt:vad-activity', { speechDuration: this.vadAccumulatedDuration, speaking: true });
      },
      onSpeechEnd: async (audio: Float32Array) => {
        // Accept audio if recording OR if speech was active when stop was called
        if (!this.recording && !this.vadSpeechActive) {
          console.log('[VAD] Speech ended but not active, ignoring');
          return;
        }

        this.vadSpeechActive = false;

        const chunkDuration = audio.length / 16000;
        console.log('[VAD] Speech ended, duration:', chunkDuration.toFixed(2), 'seconds');

        this.vadAudioChunks.push(audio);
        this.vadAccumulatedDuration += chunkDuration;

        eventBus.emit('stt:vad-activity', { speechDuration: this.vadAccumulatedDuration, speaking: false });

        // If recording already stopped, send immediately (post-stop flush)
        if (!this.recording) {
          console.log('[VAD] Post-stop flush, sending', this.vadAccumulatedDuration.toFixed(2), 'seconds to API');
          await this.processVADChunks();
          return;
        }

        console.log('[VAD] Total accumulated speech:', this.vadAccumulatedDuration.toFixed(2), 'seconds');

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

    const totalLength = this.vadAudioChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of this.vadAudioChunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    console.log('[VAD] Combined', this.vadAudioChunks.length, 'speech chunks into', this.vadAccumulatedDuration.toFixed(2), 'seconds');

    const blob = this.float32ToWav(combined, 16000);

    this.vadAudioChunks = [];
    this.vadAccumulatedDuration = 0;

    this.queueTranscription(blob);
  }

  private float32ToWav(samples: Float32Array, sampleRate: number): Blob {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

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

    if (!this.isProcessing) {
      this.processTranscriptionQueue();
    }
  }

  private async processTranscriptionQueue(): Promise<void> {
    if (this.pendingChunks.length === 0) {
      this.isProcessing = false;
      this.notifyTranscriptReady();
      return;
    }

    this.isProcessing = true;
    const chunk = this.pendingChunks.shift()!;

    try {
      await this.transcribeAudio(chunk.blob, false);
    } catch (err) {
      console.error('Failed to transcribe chunk:', err);
    }

    this.processTranscriptionQueue();
  }

  // ========================================================================
  // Transcription
  // ========================================================================

  private async transcribeAudio(audioBlob: Blob, isFinal = true): Promise<void> {
    try {
      console.log('[Mistral STT] Transcribing audio blob:', {
        size: audioBlob.size,
        type: audioBlob.type,
        hasApiKey: !!this.config.apiKey,
        apiKeyLength: this.config.apiKey?.length,
      });

      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('apiKey', this.config.apiKey);
      if (this.config.language) {
        formData.append('language', this.config.language);
      }

      const response = await fetch(`${WORKER_URL}/api/ramble/mistral-stt`, {
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
        this.fullTranscript += (this.fullTranscript ? ' ' : '') + text.trim();

        this.callbacks.onTranscript?.({
          text: this.fullTranscript,
          isFinal,
          timestamp: Date.now(),
        });
      }

      if (this.pendingChunks.length === 0 && !this.isProcessing) {
        this.notifyTranscriptReady();
      }
    } catch (err) {
      this.callbacks.onError?.({
        code: 'TRANSCRIPTION_ERROR',
        message: err instanceof Error ? err.message : 'Failed to transcribe audio',
        provider: this.providerType,
      });

      if (this.pendingChunks.length === 0) {
        this.notifyTranscriptReady();
      }
    }
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  private cleanupChunkingResources(): void {
    // Clear accumulated chunks but keep VAD alive for fast restart within same provider
    this.vadAudioChunks = [];
    this.vadAccumulatedDuration = 0;
  }

  private destroyVAD(): void {
    if (this.vad) {
      console.log('[Mistral STT] Destroying VAD instance');
      try {
        this.vad.pause();
        this.vad.destroy();
      } catch {
        // VAD may not have destroy method in all versions
      }
      this.vad = null;
    }
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
    console.log('[Mistral STT] Full cleanup — destroying VAD and releasing audio');
    this.cleanupChunkingResources();
    this.destroyVAD();
    this.cleanupAudio();
    this.recording = false;
    this.pendingChunks = [];
    this.isProcessing = false;
  }
}
