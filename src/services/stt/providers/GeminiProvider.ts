/**
 * Gemini STT Provider
 *
 * Uses Google Gemini 2.5 Flash API for audio transcription via Cloudflare AI Gateway
 * Supports VAD-based chunking (same as Groq Whisper)
 */

import type {
  ISTTProvider,
  STTConfig,
  STTServiceCallbacks,
  STTProvider,
} from '../types';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

// Chunking configuration (same as Groq)
const CHUNK_MIN_DURATION = 10; // seconds

export interface GeminiSTTConfig extends STTConfig {
  chunkingStrategy?: 'simple' | 'vad';
}

interface AudioChunk {
  blob: Blob;
  startTime: number;
  endTime: number;
  duration: number;
}

export class GeminiProvider implements ISTTProvider {
  private config: GeminiSTTConfig;
  private callbacks: STTServiceCallbacks = {};
  private connected = false;
  private recording = false;
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private chunkingStrategy: 'simple' | 'vad';
  private providerType: STTProvider;

  // For VAD-based chunking
  private vad: any = null;
  private vadAudioChunks: Float32Array[] = [];
  private vadAccumulatedDuration = 0;

  // Accumulated transcript
  private fullTranscript = '';
  private pendingChunks: AudioChunk[] = [];
  private isProcessing = false;

  constructor(config: GeminiSTTConfig) {
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

  async startRecording(): Promise<void> {
    if (!this.connected) {
      throw new Error('Not connected');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      provider: this.providerType,
    });
  }

  stopRecording(): void {
    if (this.mediaRecorder && this.recording) {
      this.mediaRecorder.stop();
      this.recording = false;
    }

    // For VAD: send any remaining accumulated chunks
    if (this.chunkingStrategy === 'vad' && this.vadAudioChunks.length > 0) {
      console.log('[Gemini] Sending remaining chunks on stop:', this.vadAccumulatedDuration.toFixed(2), 'seconds');
      this.processVADChunks();
    }

    // Cleanup strategy-specific resources
    this.cleanupChunkingResources();

    this.callbacks.onStatusChange?.({
      connected: this.connected,
      recording: false,
      provider: this.providerType,
    });
  }

  sendAudio(_audioData: ArrayBuffer | Blob): void {
    throw new Error('Gemini STT does not support external audio input');
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
  // Strategy 1: Simple recording (send entire recording)
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
      this.audioChunks = [];

      // Convert to base64 and transcribe
      await this.transcribeAudio(blob, true);
    };

    this.mediaRecorder.start(100);
  }

  // ========================================================================
  // Strategy 2: VAD-based chunking
  // ========================================================================

  private async startVADBasedRecording(): Promise<void> {
    // Check if VAD is available
    if (typeof (window as any).vad === 'undefined') {
      console.warn('[Gemini] VAD not available, falling back to simple');
      return this.startSimpleRecording();
    }

    // Initialize VAD
    this.vad = await (window as any).vad.MicVAD.new({
      onSpeechStart: () => {
        console.log('[Gemini] Speech started');
      },
      onSpeechEnd: async (audio: Float32Array) => {
        const chunkDuration = audio.length / 16000;
        console.log('[Gemini] Speech ended, duration:', chunkDuration.toFixed(2), 'seconds');

        // Accumulate this speech chunk (silence is discarded)
        this.vadAudioChunks.push(audio);
        this.vadAccumulatedDuration += chunkDuration;

        console.log('[Gemini] Total accumulated speech:', this.vadAccumulatedDuration.toFixed(2), 'seconds');

        // Send if we have at least 10 seconds of speech and silence continues
        if (this.vadAccumulatedDuration >= CHUNK_MIN_DURATION) {
          console.log('[Gemini] Sending accumulated speech chunks to API');
          await this.processVADChunks();
        } else {
          console.log('[Gemini] Waiting for more speech (need', CHUNK_MIN_DURATION, 'seconds minimum)');
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

    console.log('[Gemini] Combined', this.vadAudioChunks.length, 'speech chunks into', this.vadAccumulatedDuration.toFixed(2), 'seconds');

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

    // PCM samples
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  // ========================================================================
  // Transcription
  // ========================================================================

  private queueTranscription(blob: Blob): void {
    const chunk: AudioChunk = {
      blob,
      startTime: 0,
      endTime: 0,
      duration: 0,
    };

    this.pendingChunks.push(chunk);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.pendingChunks.length === 0) return;

    this.isProcessing = true;
    const chunk = this.pendingChunks.shift()!;

    try {
      await this.transcribeAudio(chunk.blob, false);
    } catch (err) {
      console.error('[Gemini] Transcription error:', err);
    }

    this.isProcessing = false;
    this.processQueue();
  }

  private async transcribeAudio(audioBlob: Blob, isFinal = true): Promise<void> {
    try {
      console.log('[Gemini] Transcribing audio blob:', {
        size: audioBlob.size,
        type: audioBlob.type,
        hasApiKey: !!this.config.apiKey,
      });

      // Convert blob to base64
      const base64Audio = await this.blobToBase64(audioBlob);

      // Call worker API (using simple format that gets transformed to Gemini native)
      const response = await fetch(`${WORKER_URL}/api/cf-gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: this.config.apiKey,
          model: `google/${this.config.model || 'gemini-2.5-flash'}`,
          system: 'Transcribe this audio accurately. Only return the transcription text, nothing else.',
          audio: {
            mime_type: 'audio/wav',
            data: base64Audio,
          },
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(`Transcription failed: ${errorData.error || response.statusText}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      if (text.trim()) {
        // Accumulate to full transcript
        this.fullTranscript += (this.fullTranscript ? ' ' : '') + text.trim();

        // Send accumulated result
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
        provider: this.providerType,
      });
    }
  }

  private async blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ========================================================================
  // Cleanup
  // ========================================================================

  private cleanupChunkingResources(): void {
    // VAD cleanup
    if (this.vad) {
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
    this.fullTranscript = '';
    this.pendingChunks = [];
  }
}
