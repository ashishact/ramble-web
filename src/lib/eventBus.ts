/**
 * Centralized Event Bus for Ramble
 *
 * ARCHITECTURE DECISION: Event-Based Communication
 * ================================================
 * We use an event bus pattern instead of React Context for several reasons:
 *
 * 1. **Dynamic Widgets**: Some widgets may be loaded from database or as web components.
 *    These external widgets cannot import React contexts or internal modules.
 *
 * 2. **Framework Agnostic**: The event bus works with React components, Web Components,
 *    or any other framework. This enables future extensibility.
 *
 * 3. **Decoupled Architecture**: Producers don't need to know about consumers.
 *    The WebSocket handler doesn't need to import every component that cares about STT events.
 *
 * 4. **Dual Dispatch**: Every event is dispatched both to registered handlers AND as a
 *    CustomEvent on window. This allows:
 *    - Internal React components to use the faster handler pattern
 *    - External Web Components to listen via window.addEventListener('ramble:eventName', ...)
 *
 * USAGE PATTERN:
 * ==============
 * Internal React components:
 *   - Emit: eventBus.emit('tts:stop', {})
 *   - Listen: eventBus.on('tts:stop', handler) // returns unsubscribe function
 *
 * External Web Components (can't import eventBus):
 *   - Emit: window.dispatchEvent(new CustomEvent('ramble:tts:stop', { detail: {} }))
 *   - Listen: window.addEventListener('ramble:tts:stop', handler)
 *
 * Note: All events are dispatched with 'ramble:' prefix on window to avoid conflicts.
 *
 * EVENT NAMESPACES:
 * - lens:*   - Lens widget activation, deactivation, input routing
 * - stt:*    - Speech-to-text events (recording, transcription)
 * - tts:*    - Text-to-speech events (speak, started, ended)
 * - custom:* - Future extensibility
 */

type EventHandler<T = unknown> = (payload: T) => void;

/**
 * Type-safe event definitions
 * Add new event types here as the system grows
 */
export interface EventPayloads {
	// Lens events
	'lens:activate': { lensId: string; lensType: string; lensName?: string };
	'lens:deactivate': { lensId: string };
	'lens:input': { lensId: string; text: string; source: 'speech' | 'paste' | 'keyboard' };

	// Pipeline events
	'pipeline:input-received': { text: string; source: 'speech' | 'text' };

	// Speech-to-Text events (from WebSocket / Ramble macOS app)
	'stt:recording-started': Record<string, never>;
	'stt:recording-stopped': Record<string, never>;
	'stt:transcribing': Record<string, never>;
	'stt:intermediate': { text: string };
	'stt:final': { text: string };

	// Text-to-Speech / Narrator events
	// mode: 'replace' = stop current speech and speak immediately (default)
	// mode: 'queue' = add to the queue after current speech
	'tts:speak': { text: string; voice?: string; mode?: 'replace' | 'queue' };
	// Emitted when audio generation completes for a chunk (before playback starts)
	'tts:generated': { partId: string; text: string };
	// Emitted when audio playback starts
	'tts:started': { partId: string };
	// Emitted when all queued audio finishes playing naturally
	'tts:ended': { reason: 'completed' };
	// Emitted when user explicitly stops playback
	'tts:cancelled': { reason: 'user-stopped' };
	// Command to stop playback (received by TTSService)
	'tts:stop': Record<string, never>;

	// Generic fallback for custom events
	[key: string]: unknown;
}

class EventBus {
	private handlers = new Map<string, Set<EventHandler>>();

	/**
	 * Subscribe to an event type
	 * @returns Unsubscribe function - call this to stop listening
	 */
	on<K extends keyof EventPayloads>(
		event: K,
		handler: EventHandler<EventPayloads[K]>
	): () => void {
		const eventKey = event as string;
		if (!this.handlers.has(eventKey)) {
			this.handlers.set(eventKey, new Set());
		}
		this.handlers.get(eventKey)!.add(handler as EventHandler);

		// Return unsubscribe function for cleanup
		return () => this.handlers.get(eventKey)?.delete(handler as EventHandler);
	}

	/**
	 * Emit an event to all listeners
	 *
	 * DUAL DISPATCH: Events go to both:
	 * 1. Registered handlers (for internal React components)
	 * 2. Window CustomEvent with 'ramble:' prefix (for external Web Components)
	 */
	emit<K extends keyof EventPayloads>(event: K, payload?: EventPayloads[K]): void {
		const eventKey = event as string;
		// Call registered handlers
		this.handlers.get(eventKey)?.forEach((h) => h(payload));

		// Also dispatch as CustomEvent for web components
		// Web components listen via: window.addEventListener('ramble:lens:activate', handler)
		window.dispatchEvent(
			new CustomEvent(`ramble:${eventKey}`, {
				detail: payload,
				bubbles: false,
				cancelable: false,
			})
		);
	}

	/**
	 * Check if any handlers are registered for an event
	 * Useful for debugging
	 */
	hasListeners(event: string): boolean {
		return (this.handlers.get(event)?.size ?? 0) > 0;
	}

	/**
	 * Remove all handlers for an event type
	 * Use sparingly - mainly for testing
	 */
	clear(event?: string): void {
		if (event) {
			this.handlers.delete(event);
		} else {
			this.handlers.clear();
		}
	}
}

/**
 * Singleton instance - import this in your components
 *
 * Usage in React:
 *   import { eventBus } from '../lib/eventBus';
 *   useEffect(() => eventBus.on('stt:final', (p) => console.log(p.text)), []);
 *
 * Usage in Web Components (no import needed):
 *   window.addEventListener('ramble:stt:final', (e) => console.log(e.detail.text));
 */
export const eventBus = new EventBus();
