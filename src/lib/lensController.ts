/**
 * Lens Controller - Centralized Lens State Management
 *
 * ARCHITECTURE DECISION: Lens Widgets
 * ====================================
 * Lens Widgets are a special category that can intercept and fully consume the input stream,
 * bypassing the core pipeline entirely. They enable "meta queries" about the conversation
 * without polluting the conversation history.
 *
 * The name "Lens" conveys: *looking at your data through a different lens* - examining without modifying.
 *
 * KEY BEHAVIORS:
 * 1. **Activation**: Immediate on mouse hover (no delay needed)
 * 2. **Input Capture**: Both speech and Ramble paste are captured when lens is active
 * 3. **Bypass Pipeline**: Input doesn't go to kernel, not saved to DB
 * 4. **Ephemeral Results**: Lens query results are stored in profileStorage, not conversation DB
 *
 * WHY SINGLETON (not React Context):
 * - Lens widgets may be external Web Components that can't access React context
 * - The controller needs to be accessible from GlobalSTTController (input routing)
 * - State is simple (just active lens ID) - no need for React reactivity
 * - Auto-initializes on import - no explicit init() call needed
 * - Container element is queried lazily (handles React render timing)
 *
 * VISUAL FEEDBACK:
 * - Container gets `.lens-mode-active` class when any lens is active
 * - Individual lens widget gets `.lens-widget-active` or `data-lens-active="true"`
 * - CSS handles dimming of other widgets (no pointer-events changes)
 */

import { eventBus } from './eventBus';

/** CSS selector for the bento container element */
const CONTAINER_SELECTOR = '#bento-container';

class LensController {
	private activeLensId: string | null = null;
	private activeLensType: string | null = null;
	private activeLensName: string | null = null;

	constructor() {
		// Subscribe to events immediately - no DOM needed for this
		this.setupEventListeners();
	}

	/**
	 * Set up event listeners for lens activation/deactivation
	 * Called once in constructor - no DOM dependency
	 */
	private setupEventListeners(): void {
		// Listen for lens activation via event bus (internal React components)
		eventBus.on('lens:activate', (payload) => {
			this.activateLens(payload.lensId, payload.lensType, payload.lensName);
		});

		// Listen for lens deactivation
		eventBus.on('lens:deactivate', () => {
			this.deactivateLens();
		});

		// Also listen for window events (for Web Components that can't import eventBus)
		// This creates a bridge: window event → eventBus → handlers
		window.addEventListener('ramble:lens:activate', ((e: CustomEvent) => {
			// Only process if not already handled by eventBus.emit
			// (avoid double-processing when React component uses eventBus.emit)
			if (e.detail && !this.isLensActive()) {
				this.activateLens(e.detail.lensId, e.detail.lensType, e.detail.lensName);
			}
		}) as EventListener);

		window.addEventListener('ramble:lens:deactivate', (() => {
			if (this.isLensActive()) {
				this.deactivateLens();
			}
		}) as EventListener);
	}

	/**
	 * Get the container element lazily
	 * Queries the DOM each time - handles cases where element didn't exist earlier
	 */
	private getContainer(): HTMLElement | null {
		return document.querySelector(CONTAINER_SELECTOR);
	}

	/**
	 * Activate a lens - called when cursor enters a lens widget
	 */
	private activateLens(lensId: string, lensType: string, lensName?: string): void {
		this.activeLensId = lensId;
		this.activeLensType = lensType;
		this.activeLensName = lensName || null;

		// Add visual class to container for CSS-based dimming
		const container = this.getContainer();
		container?.classList.add('lens-mode-active');
		container?.setAttribute('data-active-lens', lensId);
	}

	/**
	 * Deactivate the current lens - called when cursor leaves
	 */
	private deactivateLens(): void {
		this.activeLensId = null;
		this.activeLensType = null;
		this.activeLensName = null;

		const container = this.getContainer();
		container?.classList.remove('lens-mode-active');
		container?.removeAttribute('data-active-lens');
	}

	/**
	 * Check if any lens is currently active
	 */
	isLensActive(): boolean {
		return this.activeLensId !== null;
	}

	/**
	 * Get the ID of the currently active lens
	 */
	getActiveLensId(): string | null {
		return this.activeLensId;
	}

	/**
	 * Get the type of the currently active lens
	 */
	getActiveLensType(): string | null {
		return this.activeLensType;
	}

	/**
	 * Get the display name of the currently active lens
	 */
	getActiveLensName(): string | null {
		return this.activeLensName;
	}

	/**
	 * Get all info about the currently active lens as an object
	 * Returns null if no lens is active
	 */
	getActiveLens(): { id: string; type: string; name: string } | null {
		if (!this.activeLensId || !this.activeLensType) return null;
		return {
			id: this.activeLensId,
			type: this.activeLensType,
			name: this.activeLensName || this.activeLensType,
		};
	}

	/**
	 * Route input to the active lens widget
	 *
	 * Called by GlobalSTTController before submitting to kernel.
	 * If a lens is active, the input is routed to it and never reaches the kernel.
	 *
	 * @returns true if input was captured by a lens, false to continue normal flow
	 */
	routeInput(text: string, source: 'speech' | 'paste' | 'keyboard'): boolean {
		if (this.activeLensId) {
			// Emit input event to the active lens
			eventBus.emit('lens:input', {
				lensId: this.activeLensId,
				text,
				source,
			});
			return true; // Input was captured
		}
		return false; // No lens active, proceed with normal flow
	}

	/**
	 * Route input to a specific lens widget by ID
	 *
	 * Used when the lens ID was captured earlier (e.g., when TranscriptReview opened)
	 * but the lens may have deactivated since (e.g., user moved mouse to click Submit).
	 *
	 * @param lensId - The lens ID to route to (captured earlier)
	 * @returns true if input was routed, false if lensId was null
	 */
	routeInputToLens(
		lensId: string | null,
		text: string,
		source: 'speech' | 'paste' | 'keyboard'
	): boolean {
		if (lensId) {
			eventBus.emit('lens:input', {
				lensId,
				text,
				source,
			});
			return true;
		}
		return false;
	}
}

/**
 * Singleton instance - auto-initializes on import, no init() call needed
 *
 * Usage:
 *   import { lensController } from '../lib/lensController';
 *
 *   // In input handler:
 *   if (lensController.routeInput(text, 'speech')) return; // Captured
 */
export const lensController = new LensController();
