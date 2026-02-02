/**
 * RambleNative - Connection to Ramble native application (macOS/Windows)
 *
 * NOTE: "Ramble Native" refers to the native desktop application (currently macOS),
 * not this Ramble web app. The native app handles speech-to-text locally and
 * communicates with this web app through WebSocket.
 *
 * This module:
 * 1. Maintains a persistent WebSocket connection to the Ramble native app
 * 2. Exposes connection status (isAvailable)
 * 3. Listens for state change events (recording, transcribing, etc.)
 * 4. Emits 'tts:stop' via eventBus when recording starts (user input takes priority over TTS)
 * 5. Exposes state and events for UI feedback
 *
 * EVENT BUS USAGE:
 * ================
 * This module emits events via eventBus.emit() for cross-component communication.
 * Internal React components use eventBus.emit() directly.
 * External Web Components use window.dispatchEvent(new CustomEvent('ramble:tts:stop', ...))
 * See eventBus.ts for the full event pattern documentation.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │                    Ramble Native WebSocket Events                          │
 * ├────────────────────────┬──────────────────────┬────────────────────────────┤
 * │         Event          │         When         │          Payload           │
 * ├────────────────────────┼──────────────────────┼────────────────────────────┤
 * │ state_changed          │ State transitions    │ {state: "idle" |           │
 * │                        │                      │  "recording" |             │
 * │                        │                      │  "transcribing" | "done"}  │
 * ├────────────────────────┼──────────────────────┼────────────────────────────┤
 * │ intermediate_text      │ During transcription │ {text: "partial...", ts}   │
 * ├────────────────────────┼──────────────────────┼────────────────────────────┤
 * │ transcription_complete │ Final result         │ {text, duration, ts}       │
 * ├────────────────────────┼──────────────────────┼────────────────────────────┤
 * │ duration_update        │ During recording     │ {duration: 3.5}            │
 * └────────────────────────┴──────────────────────┴────────────────────────────┘
 *
 * Sample WebSocket messages:
 *   {"id":"uuid","type":"state_changed","payload":{"state":"recording","ts":1706367000000}}
 *   {"id":"uuid","type":"intermediate_text","payload":{"text":"Hello wor","ts":1706367001000}}
 *   {"id":"uuid","type":"state_changed","payload":{"state":"transcribing","ts":1706367005000}}
 *   {"id":"uuid","type":"transcription_complete","payload":{"text":"Hello world","duration":5.2,"ts":1706367007000}}
 *   {"id":"uuid","type":"state_changed","payload":{"state":"done","ts":1706367007000}}
 */

import { eventBus } from '../../lib/eventBus';

// Ramble native app states
export type RambleNativeState = 'idle' | 'recording' | 'transcribing' | 'done';

// Event types from Ramble native
interface RambleStateChangedEvent {
  type: 'state_changed';
  id: string;
  payload: {
    state: RambleNativeState;
    ts?: number;
  };
}

interface RambleIntermediateTextEvent {
  type: 'intermediate_text';
  id: string;
  payload: {
    text: string;
    ts?: number;
  };
}

interface RambleTranscriptionCompleteEvent {
  type: 'transcription_complete';
  id: string;
  payload: {
    text: string;
    duration?: number;
    ts?: number;
  };
}

interface RambleDurationUpdateEvent {
  type: 'duration_update';
  id: string;
  payload: {
    duration: number;
  };
}

type RambleNativeEvent =
  | RambleStateChangedEvent
  | RambleIntermediateTextEvent
  | RambleTranscriptionCompleteEvent
  | RambleDurationUpdateEvent;

// Callbacks for UI updates
export interface RambleNativeCallbacks {
  onStateChange?: (state: RambleNativeState | null) => void;
  onIntermediateText?: (text: string) => void;
  onTranscriptionComplete?: (text: string, duration?: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}

class RambleNative {
  private static instance: RambleNative;

  private ws: WebSocket | null = null;
  private currentState: RambleNativeState | null = null;
  private isConnected = false;
  private reconnectTimeout: number | null = null;
  private callbacks: RambleNativeCallbacks = {};

  // Config
  private readonly WEBSOCKET_URL = 'ws://localhost:49999';
  private readonly RECONNECT_DELAY = 3000;
  private readonly MAX_RECONNECT_DELAY = 30000;
  private reconnectAttempts = 0;

  private constructor() {}

  static getInstance(): RambleNative {
    if (!this.instance) {
      this.instance = new RambleNative();
    }
    return this.instance;
  }

  /**
   * Set callbacks for UI updates
   */
  setCallbacks(callbacks: RambleNativeCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * Clear all callbacks
   */
  clearCallbacks(): void {
    this.callbacks = {};
  }

  /**
   * Start the persistent connection to Ramble native app
   */
  connect(): void {
    if (this.ws) return; // Already connecting/connected
    this.attemptConnection();
  }

  /**
   * Disconnect and stop reconnecting
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setConnectionState(false);
    this.currentState = null;
    this.callbacks.onStateChange?.(null);
  }

  /**
   * Check if Ramble native app is available (connected)
   * This is the main check used by other parts of the app
   */
  isRambleAvailable(): boolean {
    return this.isConnected;
  }

  /**
   * Get current state of the Ramble native app
   * Returns null if not connected
   */
  getState(): RambleNativeState | null {
    return this.isConnected ? this.currentState : null;
  }

  /**
   * Check if currently recording or transcribing (user is providing input)
   */
  isUserInputActive(): boolean {
    return this.currentState === 'recording' || this.currentState === 'transcribing';
  }

  private attemptConnection(): void {
    try {
      console.log('[RambleNative] Attempting connection...');
      this.ws = new WebSocket(this.WEBSOCKET_URL);

      this.ws.onopen = () => {
        console.log('[RambleNative] Connected to Ramble native app');
        this.reconnectAttempts = 0; // Reset backoff on success
        this.setConnectionState(true);
        this.currentState = 'idle';
        this.callbacks.onStateChange?.('idle');
      };

      this.ws.onclose = () => {
        console.log('[RambleNative] Disconnected from Ramble native app');
        this.ws = null;
        this.setConnectionState(false);
        this.currentState = null;
        this.callbacks.onStateChange?.(null);
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        // onclose will be called after onerror, so we just log here
        // Don't spam console when Ramble is simply not running
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    } catch (err) {
      console.error('[RambleNative] Failed to create WebSocket:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return; // Already scheduled

    // Exponential backoff
    const delay = Math.min(
      this.RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY
    );
    this.reconnectAttempts++;

    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.attemptConnection();
    }, delay);
  }

  private setConnectionState(connected: boolean): void {
    if (this.isConnected !== connected) {
      this.isConnected = connected;
      this.callbacks.onConnectionChange?.(connected);
    }
  }

  private handleMessage(data: string): void {
    try {
      const event = JSON.parse(data) as RambleNativeEvent;

      switch (event.type) {
        case 'state_changed':
          this.handleStateChanged(event.payload.state);
          break;

        case 'intermediate_text':
          this.callbacks.onIntermediateText?.(event.payload.text);
          break;

        case 'transcription_complete':
          console.log('[RambleNative] transcription_complete:', event.payload.text);
          this.callbacks.onTranscriptionComplete?.(
            event.payload.text,
            event.payload.duration
          );
          break;

        case 'duration_update':
          // Could expose this if needed in the future
          break;
      }
    } catch (err) {
      console.error('[RambleNative] Failed to parse message:', err);
    }
  }

  private handleStateChanged(state: RambleNativeState): void {
    const previousState = this.currentState;
    this.currentState = state;

    console.log(`[RambleNative] State: ${previousState} -> ${state}`);

    // When recording or transcribing starts, stop the narrator (TTS)
    // User input (speech) takes priority over TTS output
    if (state === 'recording' || state === 'transcribing') {
      console.log('[RambleNative] User input detected, stopping TTS');
      eventBus.emit('tts:stop', {});
    }

    this.callbacks.onStateChange?.(state);
  }
}

export const rambleNative = RambleNative.getInstance();

// Legacy alias for backward compatibility
export const rambleChecker = rambleNative;
