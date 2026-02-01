/**
 * useLensWidget - React Hook for Lens Widget Implementation
 *
 * ARCHITECTURE DECISION: Optional Helper Hook
 * ============================================
 * This hook simplifies lens widget implementation for React components.
 * It's OPTIONAL - widgets can also use eventBus directly or window events.
 *
 * The hook handles:
 * 1. Generating a unique lens ID
 * 2. Mouse enter/leave event handlers for activation
 * 3. Subscribing to input events for this specific lens
 * 4. Cleanup on unmount
 *
 * EVENT BUS USAGE:
 * ================
 * This hook uses eventBus for lens events:
 * - Emits: lens:activate, lens:deactivate (on mouse enter/leave)
 * - Listens: lens:input (receives routed input when active)
 *
 * Internal React components use eventBus.emit() directly.
 * External Web Components use window.dispatchEvent(new CustomEvent('ramble:lens:activate', ...))
 * See eventBus.ts for the full event pattern documentation.
 *
 * WHY A HOOK (not HOC or render props):
 * - Hooks compose better with other hooks
 * - No wrapper component overhead
 * - TypeScript inference works well
 * - Easy to understand the data flow
 *
 * USAGE:
 * ```tsx
 * function MyLensWidget() {
 *   const { lensId, isActive, input, handlers, clearInput } = useLensWidget('meta-query');
 *
 *   return (
 *     <div {...handlers} className={isActive ? 'lens-widget-active' : ''}>
 *       {input ? <p>Processing: {input.text}</p> : <p>Hover and speak...</p>}
 *     </div>
 *   );
 * }
 * ```
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { eventBus, type EventPayloads } from '../../lib/eventBus';

export interface LensInput {
	text: string;
	source: 'speech' | 'paste' | 'keyboard';
	timestamp: number;
}

export interface UseLensWidgetResult {
	/** Unique identifier for this lens instance */
	lensId: string;

	/** Whether this lens is currently active (cursor is over it) */
	isActive: boolean;

	/** The most recent input received while active, or null */
	input: LensInput | null;

	/** Event handlers to spread onto the widget container */
	handlers: {
		onMouseEnter: () => void;
		onMouseLeave: () => void;
	};

	/** Clear the current input (after processing) */
	clearInput: () => void;
}

/**
 * Hook for implementing a lens widget in React
 *
 * @param lensType - Type identifier for this lens (e.g., 'meta-query', 'search')
 * @param lensName - Optional display name (e.g., 'Meta Query'). Falls back to type if not provided.
 * @returns Object with lens state, handlers, and utilities
 */
export function useLensWidget(lensType: string, lensName?: string): UseLensWidgetResult {
	// Generate a stable unique ID for this lens instance
	const reactId = useId();
	const lensId = useRef(`lens-${lensType}-${reactId.replace(/:/g, '')}`).current;

	const [isActive, setIsActive] = useState(false);
	const [input, setInput] = useState<LensInput | null>(null);

	// Track active state in ref for event handler
	const isActiveRef = useRef(false);

	// Mouse enter handler - activate lens
	const onMouseEnter = useCallback(() => {
		setIsActive(true);
		isActiveRef.current = true;
		eventBus.emit('lens:activate', { lensId, lensType, lensName });
	}, [lensId, lensType, lensName]);

	// Mouse leave handler - deactivate lens
	const onMouseLeave = useCallback(() => {
		setIsActive(false);
		isActiveRef.current = false;
		eventBus.emit('lens:deactivate', { lensId });
	}, [lensId]);

	// Subscribe to input events for this lens
	useEffect(() => {
		const unsubscribe = eventBus.on(
			'lens:input',
			(payload: EventPayloads['lens:input']) => {
				// Only process if this input is for our lens
				if (payload.lensId === lensId) {
					setInput({
						text: payload.text,
						source: payload.source,
						timestamp: Date.now(),
					});
				}
			}
		);

		// Cleanup subscription on unmount
		return () => {
			unsubscribe();
			// Also deactivate if we were active when unmounting
			if (isActiveRef.current) {
				eventBus.emit('lens:deactivate', { lensId });
			}
		};
	}, [lensId]);

	// Clear input after processing
	const clearInput = useCallback(() => {
		setInput(null);
	}, []);

	return {
		lensId,
		isActive,
		input,
		handlers: {
			onMouseEnter,
			onMouseLeave,
		},
		clearInput,
	};
}
