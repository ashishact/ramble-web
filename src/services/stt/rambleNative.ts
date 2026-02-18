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
// 'enhancing' = native app is post-processing the transcription (LLM grammar pass)
// 'error'     = recording failed; payload.error contains the reason
export type RambleNativeState = 'idle' | 'recording' | 'transcribing' | 'enhancing' | 'done' | 'error';

// Event types from Ramble native
interface RambleStateChangedEvent {
  type: 'state_changed';
  id: string;
  payload: {
    state: RambleNativeState;
    audioType?: string;
    ts?: number;
    /** Present when state === 'error' */
    error?: string;
  };
}

interface RambleIntermediateTextEvent {
  type: 'intermediate_text';
  id: string;
  payload: {
    text: string;
    ts?: number;
    audioType?: string;
    /** VAD segment start time (Unix ms) */
    speechStartMs?: number;
    /** VAD segment end time (Unix ms) */
    speechEndMs?: number;
  };
}

interface RambleTranscriptionCompleteEvent {
  type: 'transcription_complete';
  id: string;
  payload: {
    text: string;
    duration?: number;
    ts?: number;
    audioType?: string;
  };
}

interface RambleDurationUpdateEvent {
  type: 'duration_update';
  id: string;
  payload: {
    duration: number;
  };
}

interface RambleModeChangedEvent {
  type: 'mode_changed';
  id: string;
  payload: {
    mode: 'meeting' | 'solo';
    ts?: number;
  };
}

interface RambleRecordingCancelledEvent {
  type: 'recording_cancelled';
  id: string;
  payload: {
    reason: string;
  };
}

type RambleNativeEvent =
  | RambleStateChangedEvent
  | RambleIntermediateTextEvent
  | RambleTranscriptionCompleteEvent
  | RambleDurationUpdateEvent
  | RambleModeChangedEvent
  | RambleRecordingCancelledEvent;

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

  /**
   * Deduplication guard for WebSocket messages.
   *
   * The native app may occasionally send the same message twice (network
   * retransmit, buffering quirk, etc.).  The dedup key is:
   *   `${eventType}:${audioType}:${ts}`
   * — the combination of event type, audio source, and the server-assigned
   * timestamp is unique per logical message.  If ts is absent we cannot
   * deduplicate reliably, so we let the message through.
   *
   * Each key is auto-removed after 10 s so the Set never accumulates stale
   * entries across a long session.
   */
  private seenMessageKeys = new Set<string>();

  private isDuplicateMessage(eventType: string, audioType: string, ts: number | undefined): boolean {
    if (ts === undefined) return false; // no timestamp → can't deduplicate, allow through

    const key = `${eventType}:${audioType}:${ts}`;
    if (this.seenMessageKeys.has(key)) {
      console.warn(`[RambleNative] Duplicate message dropped: ${key}`);
      return true;
    }

    this.seenMessageKeys.add(key);
    // Auto-expire after 10 s — duplicates only matter within a very short window
    window.setTimeout(() => this.seenMessageKeys.delete(key), 10_000);
    return false;
  }

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
   * Check if currently recording, transcribing, or enhancing (user is providing input)
   */
  isUserInputActive(): boolean {
    return (
      this.currentState === 'recording' ||
      this.currentState === 'transcribing' ||
      this.currentState === 'enhancing'
    );
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

        case 'intermediate_text': {
          const audioType = event.payload.audioType === 'system' ? 'system' : 'mic';
          if (this.isDuplicateMessage('intermediate_text', audioType, event.payload.ts)) break;
          this.callbacks.onIntermediateText?.(event.payload.text);
          eventBus.emit('native:transcription-intermediate', {
            text: event.payload.text,
            audioType,
            ts: event.payload.ts ?? Date.now(),
            speechStartMs: event.payload.speechStartMs,
            speechEndMs: event.payload.speechEndMs,
          });
          break;
        }

        case 'transcription_complete': {
          const audioType = event.payload.audioType === 'system' ? 'system' : 'mic';
          if (this.isDuplicateMessage('transcription_complete', audioType, event.payload.ts)) break;
          console.log('[RambleNative] transcription_complete:', event.payload.text);
          this.callbacks.onTranscriptionComplete?.(
            event.payload.text,
            event.payload.duration
          );
          eventBus.emit('native:transcription-final', {
            text: event.payload.text,
            audioType,
            ts: event.payload.ts ?? Date.now(),
            duration: event.payload.duration,
          });
          break;
        }

        case 'duration_update':
          // Could expose this if needed in the future
          break;

        case 'mode_changed':
          eventBus.emit('native:mode-changed', {
            mode: event.payload.mode,
            ts: event.payload.ts ?? Date.now(),
          });
          break;

        case 'recording_cancelled':
          console.log('[RambleNative] Recording cancelled:', event.payload.reason);
          eventBus.emit('native:recording-cancelled', {
            reason: event.payload.reason,
            ts: Date.now(),
          });
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

    // When recording, transcribing, or enhancing — user input is active, stop TTS
    if (state === 'recording' || state === 'transcribing' || state === 'enhancing') {
      console.log('[RambleNative] User input detected, stopping TTS');
      eventBus.emit('tts:stop', {});
    }

    // Emit recording lifecycle events so widgets can track meeting boundaries
    if (state === 'recording') {
      eventBus.emit('native:recording-started', { ts: Date.now() });
    } else if (state === 'done') {
      eventBus.emit('native:recording-ended', { ts: Date.now() });
    } else if (state === 'error') {
      // Treat an error state as a cancelled recording so widgets can flush/clean up
      eventBus.emit('native:recording-cancelled', {
        reason: 'app_error',
        ts: Date.now(),
      });
    }

    this.callbacks.onStateChange?.(state);
  }
}

export const rambleNative = RambleNative.getInstance();

// Legacy alias for backward compatibility
export const rambleChecker = rambleNative;
