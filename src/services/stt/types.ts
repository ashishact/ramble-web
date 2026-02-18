/**
 * Speech-to-Text Service Types
 *
 * Core type definitions for the STT module
 */

import type { STTTier } from '../../program/types/llmTiers';

export type STTProvider = 'groq-whisper' | 'deepgram-nova' | 'deepgram-flux' | 'gemini' | 'mistral';

export interface STTConfig {
  /** Use tier abstraction (small/medium/large/live) - preferred */
  tier?: STTTier;
  /** Legacy: direct provider selection - will be resolved from tier if tier is set */
  provider?: STTProvider;
  apiKey: string;
  // Optional configuration
  language?: string;
  model?: string;
  sampleRate?: number;
  encoding?: string;
  // Groq Whisper specific
  chunkingStrategy?: 'simple' | 'vad';
}

export interface STTTranscript {
  text: string;
  isFinal: boolean;
  confidence?: number;
  timestamp?: number;
}

export interface STTError {
  code: string;
  message: string;
  provider: STTProvider;
}

export interface STTConnectionStatus {
  connected: boolean;
  recording: boolean;
  provider: STTProvider;
}

export type STTTranscriptCallback = (transcript: STTTranscript) => void;
export type STTErrorCallback = (error: STTError) => void;
export type STTStatusCallback = (status: STTConnectionStatus) => void;

export interface STTServiceCallbacks {
  onTranscript?: STTTranscriptCallback;
  onError?: STTErrorCallback;
  onStatusChange?: STTStatusCallback;
}

/**
 * Base interface for all STT providers
 */
export interface ISTTProvider {
  connect(callbacks: STTServiceCallbacks): Promise<void>;
  disconnect(): void;

  // For integrated mode (with microphone)
  startRecording(): Promise<void>;
  stopRecording(): void;

  // For headless mode (external audio source)
  sendAudio(audioData: ArrayBuffer | Blob): void;

  // Status
  isConnected(): boolean;
  isRecording(): boolean;
  getProvider(): STTProvider;

  // Wait for final transcript after stopRecording
  waitForFinalTranscript?(timeoutMs?: number): Promise<string>;
}
