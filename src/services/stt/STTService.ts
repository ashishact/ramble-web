/**
 * STT Service (Singleton)
 *
 * Main entry point for Speech-to-Text functionality
 * Provides a unified interface for all STT providers
 *
 * This service lives outside React and is shared across all components
 */

import type {
  ISTTProvider,
  STTConfig,
  STTServiceCallbacks,
  STTProvider,
} from './types';
import { DeepgramProvider } from './providers/DeepgramProvider';
import { GroqWhisperProvider } from './providers/GroqWhisperProvider';
import { MistralProvider } from './providers/MistralProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import { resolveSTTTier } from '../../program';

export class STTService {
  private static instance: STTService | null = null;
  private provider: ISTTProvider | null = null;
  private currentConfig: STTConfig | null = null;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): STTService {
    if (!STTService.instance) {
      STTService.instance = new STTService();
    }
    return STTService.instance;
  }

  /**
   * Resolve config tier to actual provider
   */
  private resolveConfig(config: STTConfig): STTConfig {
    // If tier is specified, resolve it to provider
    if (config.tier) {
      const resolved = resolveSTTTier(config.tier);
      return {
        ...config,
        provider: resolved.provider,
        model: resolved.model || config.model,
      };
    }
    // Otherwise use provider directly (legacy mode)
    return config;
  }

  /**
   * Check if config has meaningfully changed
   */
  private configChanged(newConfig: STTConfig): boolean {
    if (!this.currentConfig) return true;

    // Resolve both configs for comparison
    const resolvedCurrent = this.resolveConfig(this.currentConfig);
    const resolvedNew = this.resolveConfig(newConfig);

    // Check if provider changed
    if (resolvedCurrent.provider !== resolvedNew.provider) return true;

    // Check if apiKey changed (important!)
    if (resolvedCurrent.apiKey !== resolvedNew.apiKey) return true;

    // Check other important config changes
    if (resolvedCurrent.model !== resolvedNew.model) return true;
    if (resolvedCurrent.chunkingStrategy !== resolvedNew.chunkingStrategy) return true;

    return false;
  }

  /**
   * Create and connect to an STT provider
   */
  async connect(config: STTConfig, callbacks: STTServiceCallbacks): Promise<void> {
    // Resolve tier to actual provider
    const resolvedConfig = this.resolveConfig(config);

    // If already connected with same provider and config, just update callbacks
    if (this.provider && this.provider.getProvider() === resolvedConfig.provider &&
        this.provider.isConnected() && !this.configChanged(config)) {
      // Provider already connected with same config, no need to reconnect
      return;
    }

    // Cleanup any existing provider
    if (this.provider) {
      this.provider.disconnect();
    }

    // Store new config
    this.currentConfig = config;

    // Create provider instance using resolved config
    this.provider = this.createProvider(resolvedConfig);

    // Connect
    await this.provider.connect(callbacks);
  }

  /**
   * Disconnect from the current provider
   */
  disconnect(): void {
    if (this.provider) {
      this.provider.disconnect();
      this.provider = null;
    }
  }

  /**
   * Start recording from microphone
   * (Integrated mode: microphone + transcription)
   */
  async startRecording(): Promise<void> {
    if (!this.provider) {
      throw new Error('No provider connected. Call connect() first or the provider will be created automatically.');
    }
    await this.provider.startRecording();
  }

  /**
   * Ensure provider exists with current config, create if needed
   */
  async ensureProvider(config: STTConfig, callbacks: STTServiceCallbacks): Promise<void> {
    if (!this.provider || this.configChanged(config)) {
      await this.connect(config, callbacks);
    }
  }

  /**
   * Stop recording
   */
  stopRecording(): void {
    if (!this.provider) {
      throw new Error('No provider connected');
    }
    this.provider.stopRecording();
  }

  /**
   * Stop recording and wait for final transcript
   * Returns the final accumulated transcript after all pending audio is processed
   */
  async stopRecordingAndWait(timeoutMs = 10000): Promise<string> {
    if (!this.provider) {
      throw new Error('No provider connected');
    }

    this.provider.stopRecording();

    // If provider supports waiting, use it
    if (this.provider.waitForFinalTranscript) {
      return this.provider.waitForFinalTranscript(timeoutMs);
    }

    // Fallback: just wait a bit for any pending transcriptions
    await new Promise(resolve => setTimeout(resolve, 1000));
    return '';
  }

  /**
   * Send audio data for transcription
   * (Headless mode: external audio source)
   */
  sendAudio(audioData: ArrayBuffer | Blob): void {
    if (!this.provider) {
      throw new Error('No provider connected');
    }
    this.provider.sendAudio(audioData);
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.provider?.isConnected() ?? false;
  }

  /**
   * Check recording status
   */
  isRecording(): boolean {
    return this.provider?.isRecording() ?? false;
  }

  /**
   * Get current provider
   */
  getProvider(): STTProvider | null {
    return this.provider?.getProvider() ?? null;
  }

  /**
   * Factory method to create provider instances
   */
  private createProvider(config: STTConfig): ISTTProvider {
    if (!config.provider) {
      throw new Error('Provider must be specified in config (or resolved from tier)');
    }

    switch (config.provider) {
      case 'groq-whisper':
        return new GroqWhisperProvider(config);
      case 'deepgram-nova':
      case 'deepgram-flux':
        return new DeepgramProvider(config);
      case 'mistral':
        return new MistralProvider(config);
      case 'gemini':
        return new GeminiProvider(config);
      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }
}

/**
 * Get the singleton STT service instance
 */
export function getSTTService(): STTService {
  return STTService.getInstance();
}

// Re-export types for convenience
export * from './types';
