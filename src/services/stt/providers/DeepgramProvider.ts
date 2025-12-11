/**
 * Deepgram STT Provider
 *
 * Supports both Nova (v1) and Flux (v2) models
 */

import type {
  ISTTProvider,
  STTConfig,
  STTServiceCallbacks,
  STTProvider,
} from '../types';

export class DeepgramProvider implements ISTTProvider {
  private config: STTConfig;
  private callbacks: STTServiceCallbacks = {};
  private ws: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private connected = false;
  private recording = false;
  private isManualClose = false;
  private finalTranscript = '';
  private version: 'v1' | 'v2';
  private keepaliveInterval: number | null = null;
  private providerType: STTProvider;

  constructor(config: STTConfig) {
    if (!config.provider) {
      throw new Error('Provider must be specified in config');
    }
    this.config = config;
    this.providerType = config.provider;
    this.version = config.provider === 'deepgram-flux' ? 'v2' : 'v1';
  }

  async connect(callbacks: STTServiceCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.isManualClose = false;

    console.log('[Deepgram] Connecting:', {
      version: this.version,
      hasApiKey: !!this.config.apiKey,
      apiKeyLength: this.config.apiKey?.length
    });

    // Build WebSocket URL
    const params = new URLSearchParams({
      encoding: this.config.encoding || 'linear16',
      sample_rate: String(this.config.sampleRate || 16000),
    });

    // Add model parameter
    if (this.version === 'v2') {
      params.append('model', this.config.model || 'flux-general-en');
    } else {
      params.append('model', this.config.model || 'nova-3');
      params.append('channels', '1');
    }

    const wsUrl = `wss://api.deepgram.com/${this.version}/listen?${params}`;

    // Create WebSocket with authentication
    this.ws = new WebSocket(wsUrl, ['token', this.config.apiKey]);

    this.ws.onopen = () => {
      console.log('[Deepgram] WebSocket opened successfully');
      this.connected = true;
      this.callbacks.onStatusChange?.({
        connected: true,
        recording: false,
        provider: this.providerType,
      });

      // Send keepalive to prevent timeout
      this.startKeepalive();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Deepgram] Received message:', data);

        // Handle v1 (Nova) response format
        if (this.version === 'v1' && data.channel?.alternatives?.[0]?.transcript) {
          const text = data.channel.alternatives[0].transcript;
          const isFinal = data.is_final || false;

          if (text.trim()) {
            if (isFinal) {
              // Accumulate final transcripts
              this.finalTranscript += (this.finalTranscript ? ' ' : '') + text;
              this.callbacks.onTranscript?.({
                text: this.finalTranscript,
                isFinal: true,
                confidence: data.channel.alternatives[0].confidence,
                timestamp: Date.now(),
              });
            } else {
              // Show interim result with accumulated text
              const fullText = this.finalTranscript + (this.finalTranscript ? ' ' : '') + text;
              this.callbacks.onTranscript?.({
                text: fullText,
                isFinal: false,
                confidence: data.channel.alternatives[0].confidence,
                timestamp: Date.now(),
              });
            }
          }
        }

        // Handle v2 (Flux) response format
        if (this.version === 'v2' && data.type === 'TurnInfo') {
          const text = data.transcript;

          if (data.event === 'EndOfTurn' && text && text.trim()) {
            // Final result
            this.finalTranscript += (this.finalTranscript ? ' ' : '') + text;
            this.callbacks.onTranscript?.({
              text: this.finalTranscript,
              isFinal: true,
              confidence: data.end_of_turn_confidence,
              timestamp: Date.now(),
            });
          } else if (data.event === 'Update' && text) {
            // Interim result
            const fullText = this.finalTranscript + (this.finalTranscript ? ' ' : '') + text;
            this.callbacks.onTranscript?.({
              text: fullText,
              isFinal: false,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        this.callbacks.onError?.({
          code: 'PARSE_ERROR',
          message: err instanceof Error ? err.message : 'Failed to parse message',
          provider: this.providerType,
        });
      }
    };

    this.ws.onerror = (error) => {
      console.error('[Deepgram] WebSocket error:', error);
      this.callbacks.onError?.({
        code: 'CONNECTION_ERROR',
        message: 'WebSocket connection error',
        provider: this.providerType,
      });
    };

    this.ws.onclose = (event) => {
      console.log('[Deepgram] WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        isManualClose: this.isManualClose
      });

      this.connected = false;
      this.recording = false;
      this.callbacks.onStatusChange?.({
        connected: false,
        recording: false,
        provider: this.providerType,
      });

      if (!this.isManualClose && event.code !== 1000) {
        this.callbacks.onError?.({
          code: 'CONNECTION_CLOSED',
          message: `WebSocket closed unexpectedly: ${event.code} - ${event.reason || 'No reason provided'}`,
          provider: this.providerType,
        });
      }

      this.cleanup();
    };

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
      this.ws!.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.ws!.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Connection failed'));
      });
    });
  }

  disconnect(): void {
    this.isManualClose = true;
    this.cleanup();
  }

  async startRecording(): Promise<void> {
    if (!this.connected || this.recording) {
      throw new Error('Cannot start recording: not connected or already recording');
    }

    console.log('[Deepgram] Starting recording...');

    // Stop keepalive when starting to record actual audio
    this.stopKeepalive();

    // Get microphone access
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    console.log('[Deepgram] Got microphone access');

    // Create audio processing pipeline
    this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate || 16000 });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    console.log('[Deepgram] Audio pipeline created, sample rate:', this.audioContext.sampleRate);

    this.source.connect(this.processor);
    this.processor.connect(this.audioContext.destination);

    let audioChunksSent = 0;
    this.processor.onaudioprocess = (e) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array (linear16 PCM)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        this.ws.send(pcmData.buffer);
        audioChunksSent++;

        if (audioChunksSent % 100 === 0) {
          console.log('[Deepgram] Sent', audioChunksSent, 'audio chunks');
        }
      } else {
        console.warn('[Deepgram] Cannot send audio - WebSocket not open, state:', this.ws?.readyState);
      }
    };

    this.recording = true;
    this.callbacks.onStatusChange?.({
      connected: true,
      recording: true,
      provider: this.providerType,
    });
  }

  stopRecording(): void {
    this.recording = false;
    this.cleanupAudio();

    // Restart keepalive after stopping recording
    if (this.connected) {
      this.startKeepalive();
    }

    this.callbacks.onStatusChange?.({
      connected: this.connected,
      recording: false,
      provider: this.providerType,
    });
  }

  sendAudio(audioData: ArrayBuffer | Blob): void {
    if (!this.connected) {
      throw new Error('Cannot send audio: not connected');
    }

    if (audioData instanceof Blob) {
      audioData.arrayBuffer().then((buffer) => {
        this.ws?.send(buffer);
      });
    } else {
      this.ws?.send(audioData);
    }
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

  private cleanupAudio(): void {
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  private startKeepalive(): void {
    // Send keepalive message every 10 seconds to prevent timeout
    this.keepaliveInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN && !this.recording) {
        console.log('[Deepgram] Sending keepalive');
        // Send empty audio buffer as keepalive
        const silence = new Int16Array(160); // 10ms of silence at 16kHz
        this.ws.send(silence.buffer);
      }
    }, 10000);
  }

  private stopKeepalive(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  private cleanup(): void {
    this.stopKeepalive();
    this.cleanupAudio();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.recording = false;
    this.finalTranscript = '';
  }
}
