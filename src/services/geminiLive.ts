/**
 * Gemini Live WebSocket Service (System I - Fast Conversational)
 *
 * Direct browser WebSocket connection to Google Gemini Live API.
 * Handles real-time audio streaming and transcription.
 */

import { settingsHelpers } from '../stores/settingsStore';
import { conversationHelpers } from '../stores/conversationStore';
import { knowledgeHelpers } from '../stores/knowledgeStore';

// Types
export interface GeminiLiveConfig {
  apiKey: string;
  model?: string;
  voiceName?: string;
  systemPrompt?: string;
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
}

export interface GeminiLiveCallbacks {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  onAudioData?: (audioData: ArrayBuffer) => void;
  onUserTranscript?: (text: string, isFinal: boolean) => void;
  onModelTranscript?: (text: string, isFinal: boolean) => void;
  onTurnComplete?: () => void;
  onInterrupted?: () => void;
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// Build the system prompt with current context
const buildSystemPrompt = (): string => {
  const currentNodeId = settingsHelpers.getCurrentNodeId();
  const currentNode = currentNodeId ? knowledgeHelpers.getNode(currentNodeId) : null;
  const relatedNodes = currentNodeId ? knowledgeHelpers.getRelatedNodes(currentNodeId) : [];
  const recentMessages = conversationHelpers.getRecentMessages(5);

  let contextSection = '';
  if (currentNode) {
    contextSection = `
CURRENT CONTEXT:
You are currently focused on the topic: "${currentNode.title}"
Content: ${currentNode.content}
Tags: ${currentNode.tags.join(', ')}

Related topics:
${relatedNodes.map(n => `- ${n.title} (${n.relationshipDescription})`).join('\n')}
`;
  }

  let historySection = '';
  if (recentMessages.length > 0) {
    historySection = `
RECENT CONVERSATION:
${recentMessages.map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`).join('\n')}
`;
  }

  return `You are Amigoz, a helpful AI assistant with access to a personal knowledge graph.
You have a warm, conversational style and help users organize their thoughts and knowledge.

${contextSection}
${historySection}

GUIDELINES:
- Be conversational and natural
- Keep responses concise for voice
- Reference relevant knowledge when helpful
- Help users explore and connect ideas
- If asked to remember something, confirm you'll note it (the Observer system will handle storage)
`;
};

export class GeminiLiveService {
  private ws: WebSocket | null = null;
  private config: GeminiLiveConfig;
  private callbacks: GeminiLiveCallbacks;
  private state: ConnectionState = 'disconnected';
  private userTranscriptBuffer = '';
  private modelTranscriptBuffer = '';
  private currentResponseSessionId: string | null = null;

  constructor(config: GeminiLiveConfig, callbacks: GeminiLiveCallbacks = {}) {
    this.config = config;
    this.callbacks = callbacks;
  }

  getState(): ConnectionState {
    return this.state;
  }

  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.state = 'connecting';
    const model = this.config.model || 'models/gemini-2.5-flash-native-audio-preview-09-2025';

    // Debug: log API key prefix to verify it's being read
    console.log('[GeminiLive] API key prefix:', this.config.apiKey?.substring(0, 8) + '...');
    console.log('[GeminiLive] Model:', model);

    // WebSocket URL for Gemini Live API
    const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${this.config.apiKey}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('[GeminiLive] WebSocket connected');
        this.sendSetupMessage(model);
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (event) => {
        console.error('[GeminiLive] WebSocket error:', event);
        console.error('[GeminiLive] WebSocket readyState:', this.ws?.readyState);
        this.state = 'error';
        this.callbacks.onError?.(new Error('WebSocket connection error'));
      };

      this.ws.onclose = (event) => {
        console.log('[GeminiLive] WebSocket closed:', event.code, event.reason);
        console.log('[GeminiLive] Close event wasClean:', event.wasClean);
        this.state = 'disconnected';
        this.callbacks.onDisconnected?.();
      };
    } catch (error) {
      this.state = 'error';
      throw error;
    }
  }

  private sendSetupMessage(model: string): void {
    const voiceName = this.config.voiceName || 'Aoede';
    const systemPrompt = this.config.systemPrompt || buildSystemPrompt();

    const setupMessage = {
      setup: {
        model: model.startsWith('models/') ? model : `models/${model}`,
        generation_config: {
          response_modalities: ['AUDIO'],
          temperature: 1.2,
          top_p: 0.95,
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: voiceName,
              },
            },
          },
        },
        // Enable server-side VAD for interruption handling
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
            prefix_padding_ms: this.config.prefixPaddingMs ?? 300,
            silence_duration_ms: this.config.silenceDurationMs ?? 800,
          },
        },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
        system_instruction: {
          parts: [{ text: systemPrompt }],
        },
      },
    };

    this.ws?.send(JSON.stringify(setupMessage));
    console.log('[GeminiLive] Setup message sent');
  }

  private async handleMessage(data: string | ArrayBuffer | Blob): Promise<void> {
    let messageText: string;

    if (data instanceof Blob) {
      messageText = await data.text();
    } else if (data instanceof ArrayBuffer) {
      messageText = new TextDecoder().decode(data);
    } else {
      messageText = data;
    }

    try {
      const message = JSON.parse(messageText);

      // Handle setup complete
      if (message.setupComplete) {
        console.log('[GeminiLive] Setup complete');
        this.state = 'connected';
        this.callbacks.onConnected?.();
        return;
      }

      // Handle server content
      if (message.serverContent) {
        const serverContent = message.serverContent;

        // Handle interruption
        if (serverContent.interrupted) {
          console.log('[GeminiLive] Interrupted');
          this.currentResponseSessionId = null;
          this.modelTranscriptBuffer = '';
          this.callbacks.onInterrupted?.();
          return;
        }

        // Handle model turn (audio response)
        if (serverContent.modelTurn?.parts) {
          for (const part of serverContent.modelTurn.parts) {
            if (part.inlineData?.mimeType?.startsWith('audio/')) {
              // New response session
              if (!this.currentResponseSessionId) {
                this.currentResponseSessionId = `session_${Date.now()}`;
              }

              // Decode base64 audio and forward
              const audioData = this.base64ToArrayBuffer(part.inlineData.data);
              this.callbacks.onAudioData?.(audioData);
            }
          }
        }

        // Handle input transcription (user speech)
        if (serverContent.inputTranscription?.text) {
          this.userTranscriptBuffer += serverContent.inputTranscription.text;
          this.callbacks.onUserTranscript?.(this.userTranscriptBuffer, false);
        }

        // Handle output transcription (model speech)
        if (serverContent.outputTranscription?.text) {
          this.modelTranscriptBuffer += serverContent.outputTranscription.text;
          this.callbacks.onModelTranscript?.(this.modelTranscriptBuffer, false);
        }

        // Handle turn complete
        if (serverContent.turnComplete) {
          console.log('[GeminiLive] Turn complete');

          // Save completed user transcript
          if (this.userTranscriptBuffer.trim()) {
            conversationHelpers.addUserMessage(this.userTranscriptBuffer.trim());
            this.callbacks.onUserTranscript?.(this.userTranscriptBuffer.trim(), true);
            this.userTranscriptBuffer = '';
          }

          // Save completed model transcript
          if (this.modelTranscriptBuffer.trim()) {
            conversationHelpers.addModelMessage(this.modelTranscriptBuffer.trim());
            this.callbacks.onModelTranscript?.(this.modelTranscriptBuffer.trim(), true);
            this.modelTranscriptBuffer = '';
          }

          this.currentResponseSessionId = null;
          this.callbacks.onTurnComplete?.();
        }
      }

      // Handle tool calls (if any - for future expansion)
      if (message.toolCall) {
        console.log('[GeminiLive] Tool call received:', message.toolCall);
        // Handle function calls here if needed
      }
    } catch (error) {
      console.error('[GeminiLive] Error parsing message:', error);
    }
  }

  // Send audio data to Gemini (base64 encoded PCM)
  private audioSendCount = 0;
  sendAudio(base64Audio: string): void {
    if (this.state !== 'connected' || !this.ws) {
      if (this.audioSendCount === 0) {
        console.warn('[GeminiLive] Cannot send audio - not connected. State:', this.state);
      }
      return;
    }

    this.audioSendCount++;

    const message = {
      realtimeInput: {
        mediaChunks: [
          {
            mimeType: 'audio/pcm;rate=16000',
            data: base64Audio,
          },
        ],
      },
    };

    this.ws.send(JSON.stringify(message));

    if (this.audioSendCount % 50 === 1) {
      console.log(`[GeminiLive] Sent audio chunk #${this.audioSendCount}`);
    }
  }

  // Send text message to Gemini
  sendText(text: string): void {
    if (this.state !== 'connected' || !this.ws) {
      console.warn('[GeminiLive] Cannot send text - not connected');
      return;
    }

    // Add to conversation immediately
    conversationHelpers.addUserMessage(text);

    const message = {
      clientContent: {
        turns: [
          {
            role: 'user',
            parts: [{ text }],
          },
        ],
        turnComplete: true,
      },
    };

    this.ws.send(JSON.stringify(message));
    console.log('[GeminiLive] Text message sent:', text);
  }

  // Update system prompt (e.g., when context changes)
  updateSystemPrompt(): void {
    // Note: Gemini Live doesn't support mid-session prompt updates
    // We rebuild the prompt on next connection
    console.log('[GeminiLive] System prompt will be updated on next connection');
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
    this.userTranscriptBuffer = '';
    this.modelTranscriptBuffer = '';
    this.currentResponseSessionId = null;
  }

  // Utility: Convert base64 to ArrayBuffer
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// Singleton instance managed outside React
class GeminiLiveManager {
  private instance: GeminiLiveService | null = null;
  private callbacks: GeminiLiveCallbacks = {};

  setCallbacks(callbacks: GeminiLiveCallbacks) {
    this.callbacks = { ...this.callbacks, ...callbacks };
    if (this.instance) {
      Object.assign(this.instance['callbacks'], callbacks);
    }
  }

  async connect(): Promise<void> {
    // Already connected or connecting
    if (this.instance && (this.instance.getState() === 'connected' || this.instance.getState() === 'connecting')) {
      console.log('[GeminiLiveManager] Already connected/connecting');
      return;
    }

    const settings = settingsHelpers.getSettings();
    const apiKey = settings.providers.gemini.apiKey;

    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }

    console.log('[GeminiLiveManager] Creating new connection');

    this.instance = new GeminiLiveService(
      {
        apiKey,
        voiceName: settings.voice.name,
        silenceDurationMs: settings.voice.silenceDurationMs,
        prefixPaddingMs: settings.voice.prefixPaddingMs,
      },
      this.callbacks
    );

    await this.instance.connect();
  }

  disconnect() {
    if (this.instance) {
      console.log('[GeminiLiveManager] Disconnecting');
      this.instance.disconnect();
      this.instance = null;
    }
  }

  sendAudio(base64Audio: string) {
    this.instance?.sendAudio(base64Audio);
  }

  sendText(text: string) {
    this.instance?.sendText(text);
  }

  getState(): ConnectionState {
    return this.instance?.getState() ?? 'disconnected';
  }

  isConnected(): boolean {
    return this.instance?.getState() === 'connected';
  }
}

// Single global instance
export const geminiLive = new GeminiLiveManager();
