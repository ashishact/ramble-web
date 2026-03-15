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
 * - lens:*        - Lens widget activation, deactivation, input routing
 * - stt:*         - Speech-to-text events (recording, transcription)
 * - tts:*         - Text-to-speech events (speak, started, ended)
 * - recording:*   - Universal recording lifecycle (voice, text, paste, document, image)
 * - processing:*  - Unified pipeline output (System I, System II, Consolidation)
 * - custom:*      - Future extensibility
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ARCHITECTURAL OVERVIEW: TWO PARADIGMS × TWO FOCUS CONTEXTS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * PARADIGM A — STREAMING (live / meeting mode)
 *   Triggered when native app is in 'meeting' mode.
 *   Events: native:transcription-intermediate (continuous, per VAD segment)
 *   Consumers: meetingStatus (accumulates segments) → MeetingTranscription
 *              widget (own LLM loop, 8s throttle) + Questions/Suggestions
 *              widgets (30s throttle, 200 char threshold).
 *   Key property: LLM is called WHILE recording is still in progress.
 *   Data flow: intermediate text → meetingStatus.segments → widget LLM calls
 *
 * PARADIGM B — BATCH (stop-and-process / solo mode)
 *   Triggered when a recording ends (native:transcription-final) or user
 *   types/pastes content directly into Ramble.
 *   Events: native:transcription-final, or direct processInput() call
 *   Consumers: processor.ts (WorkingMemory + LLM extraction → DB) →
 *              pipelineStatus notifies → Questions/Suggestions/SpeakBetter
 *              widgets refresh after pipeline completes.
 *   Key property: LLM is called AFTER recording stops and text is final.
 *   Data flow: final text → processInput → DB → pipelineStatus → widgets
 *
 * FOCUS CONTEXT 1 — IN-APP
 *   User is actively using the Ramble web app.
 *   Input arrives via typing, paste, or speech (solo mode).
 *   Conversation source: 'typed' | 'pasted' | 'speech' (solo)
 *
 * FOCUS CONTEXT 2 — OUT-OF-APP
 *   User is in another app (Zoom, Meet, browser, etc.).
 *   Ramble native runs in the background and sends data via WebSocket.
 *   Conversation source: 'speech' (solo out-of-app) | 'meeting' (meeting mode)
 *   NOTE: The app currently does NOT track whether window has focus.
 *         Both contexts are processed identically — document.hasFocus() is
 *         never checked. This is a known gap: behaviour cannot yet be tuned
 *         based on whether the user is looking at Ramble or not.
 *
 * GAP — FOCUS CONTEXT NOT TRACKED:
 *   No code checks document.hasFocus() or Page Visibility API.
 *   Future: emit a 'focus:changed' event here so widgets can adapt
 *   (e.g. louder TTS when out-of-app, silent when Ramble is in foreground).
 * ═══════════════════════════════════════════════════════════════════════════
 */

import type { Recording, RecordingChunk, NormalizationHints, ConsolidationResult } from '../program/types/recording';
import type { ProcessingResult } from '../program/kernel/processor';
import type { WorkingMemoryData } from '../program/WorkingMemory';

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
	'stt:vad-activity': { speechDuration: number; speaking: boolean };

	// Native recording lifecycle events (from Ramble native app via rambleNative.ts)
	'native:recording-started': { ts: number; recordingId?: string };
	'native:recording-ended': { ts: number; recordingId?: string };
	// Emitted when recording is aborted (e.g. owner disconnected, app error)
	'native:recording-cancelled': { reason: string; ts: number };
	// Emitted when the native app switches between meeting mode and solo mode
	'native:mode-changed': { mode: 'meeting' | 'solo'; ts: number };

	// Native meeting transcript (sent once at meeting recording end)
	// Contains the full interleaved transcript with speaker labels
	'native:meeting-transcript-complete': {
		recordingId?: string;
		duration?: number;
		ts: number;
		segments: Array<{ source: 'mic' | 'system'; text: string; startMs: number; endMs: number; speakerIndex?: number }>;
		transcript: string;  // Pre-formatted "Speaker N: text\n..." or "source: text\n..." string
	};

	// Native transcription events (from Ramble native app via rambleNative.ts)
	// These carry audioType so widgets can distinguish mic vs. system audio
	'native:transcription-intermediate': {
		text: string;
		audioType: 'mic' | 'system';
		mode?: 'solo' | 'meeting';
		ts: number;
		/** VAD segment start time (Unix ms), present when native app provides timing */
		speechStartMs?: number;
		/** VAD segment end time (Unix ms), present when native app provides timing */
		speechEndMs?: number;
		/** Same for all chunks in this recording (optional — older native versions omit) */
		recordingId?: string;
		/** Speaker index in meeting mode (0, 1, 2...). Omitted in solo or when attribution fails. */
		speakerIndex?: number;
	};
	// Async entity extraction results (sent independently of text segments)
	'native:intermediate-entities': {
		ts: number;
		recordingId?: string;
		entities?: Record<string, string[]>;
		nlTaggerEntities?: Record<string, string[]>;
		sessionEntities?: Record<string, string[]>;
	};
	'native:transcription-final': {
		text: string;
		audioType: 'mic' | 'system';
		mode?: 'solo' | 'meeting';
		ts: number;
		duration?: number;
		recordingId?: string;
		/** Accumulated session entities at end of recording */
		entities?: Record<string, string[]>;
	};

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

	// ── Recording lifecycle events ──────────────────────────────────────────
	// Universal recording concept: voice, text, paste, document, image all
	// flow through the same lifecycle. RecordingManager emits these.
	'recording:started': { recording: Recording };
	'recording:chunk': { chunk: RecordingChunk; recording: Recording };
	'recording:ended': { recording: Recording; fullText: string };

	// ── Processing result events ────────────────────────────────────────────
	// Unified pipeline output — System I (fast/shallow) and System II (slow/deep)
	// use the SAME pipeline, different context depth. All widgets subscribe to
	// these instead of checking pipelineStatus directly.
	'processing:system-i': {
		recordingId: string;
		chunkIndex: number;
		result: ProcessingResult;
		hints: NormalizationHints;
	};
	'processing:system-ii': {
		recordingId?: string;  // Optional for recovery paths (resumePendingTasks, reprocessFailed)
		conversationId?: string;  // The conversation record created for this final text
		result: ProcessingResult;
		/** The exact WorkingMemoryData that was sent to the LLM for this step.
		 *  Widgets can display this to show what the LLM actually saw. */
		context?: WorkingMemoryData;
	};
	'processing:consolidation': {
		result: ConsolidationResult;
	};

	// Widget data events
	'questions:updated': { questions: Array<{ id: string; text: string; topic: string; category: string; priority: string }> };

	// Meeting companion cards streamed from ChatGPT via Chrome extension
	'ext:meeting-cards': {
		status: 'active' | 'waiting' | 'summary';
		cards: Array<{
			type: 'question' | 'insight' | 'decision' | 'action_item' | 'summary_point';
			text: string;
			category?: string;
			reasoning?: string;
		}>;
	};

	// Google Search via Chrome extension
	'ext:google-search': { query: string; requestId: string };
	'ext:google-search-result': { query: string; result: string; requestId: string };
	'ext:google-search-error': { query: string; error: string; requestId: string };

	// Interview engine events (SYS-I)
	'interview:question': {
		/** What was spoken to the user */
		response: string;
		/** Isolated question text for ASSERT/EXPLORE; null for QUERY/CORRECT/etc. */
		question: string | null;
		intent: 'ASSERT' | 'QUERY' | 'CORRECT' | 'EXPLORE' | 'COMMAND' | 'SOCIAL';
		topic: string;
		timestamp: number;
	};
	'interview:stream': { text: string; conversationId: string };
	'interview:state': { state: 'idle' | 'sending' | 'error' | 'no-transport' };

	// Knowledge tree navigation events
	'navigate:entity': { entityId: string };
	'highlight:node': { nodeId: string };

	// Knowledge tree activity events (pipeline visibility)
	'tree:activity': {
		type: 'entity-created' | 'entity-resolved' | 'curation-start' | 'curation-llm-call'
			| 'curation-llm-response' | 'curation-llm-error' | 'curation-actions-applied'
			| 'curation-complete' | 'tree-created' | 'curation-action';
		entityName?: string;
		entityId?: string;
		message: string;
		detail?: string;
		timestamp: number;
	};

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

// ============================================================================
// Bridge: Old EventBus ↔ GraphEventBus
// ============================================================================
// Lazy import to avoid circular dependency. The bridge is set up once on first
// access. Graph events that match old event names are forwarded here,
// and vice versa. This allows gradual migration without breaking existing code.

let bridgeInitialized = false;

export function initEventBusBridge(): void {
	if (bridgeInitialized) return;
	bridgeInitialized = true;

	// Lazy import to avoid top-level circular dep
	import('../graph/events/EventBus').then(({ graphEventBus }) => {
		// Forward graph:tables:changed → old bus (for widgets that listen)
		graphEventBus.on('graph:tables:changed', (payload) => {
			eventBus.emit('graph:tables:changed' as keyof EventPayloads, payload as never);
		});

		// Forward graph:node:created → old bus
		graphEventBus.on('graph:node:created', (payload) => {
			eventBus.emit('graph:node:created' as keyof EventPayloads, payload as never);
		});

		// Forward graph:edge:created → old bus
		graphEventBus.on('graph:edge:created', (payload) => {
			eventBus.emit('graph:edge:created' as keyof EventPayloads, payload as never);
		});
	});
}
