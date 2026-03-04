/**
 * Widget Pause Hook
 *
 * Provides pause/resume functionality for on-demand widgets.
 * When paused:
 * - Widget should not process or make LLM calls
 * - An overlay is shown indicating paused state
 * - State persists across page reloads
 *
 * Storage shape: Record<nodeId, WidgetState>
 * Each widget's state is a JSON object so additional fields can be added later.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';
import { Pause, Play } from 'lucide-react';
import { profileStorage } from '../../lib/profileStorage';

const STORAGE_KEY = 'widget-states';

const WidgetStateSchema = z.object({
	paused: z.boolean().optional(),
}).passthrough();

const WidgetStatesSchema = z.record(z.string(), WidgetStateSchema);

type WidgetState = z.infer<typeof WidgetStateSchema>;
type WidgetStates = z.infer<typeof WidgetStatesSchema>;

function loadWidgetStates(): WidgetStates {
	try {
		const raw = profileStorage.getJSON<unknown>(STORAGE_KEY);
		if (raw == null) return {};
		const result = WidgetStatesSchema.safeParse(raw);
		if (!result.success) {
			console.warn('[widgetStates] Stored widget states failed validation — resetting:', result.error.issues);
			return {};
		}
		return result.data;
	} catch {
		return {};
	}
}

function saveWidgetStates(states: WidgetStates): void {
	try {
		profileStorage.setJSON(STORAGE_KEY, states);
	} catch (error) {
		console.warn('Failed to save widget states:', error);
	}
}

function getWidgetState(nodeId: string): WidgetState {
	const states = loadWidgetStates();
	return states[nodeId] ?? {};
}

function updateWidgetState(nodeId: string, patch: Partial<WidgetState>): void {
	const states = loadWidgetStates();
	states[nodeId] = { ...states[nodeId], ...patch };
	saveWidgetStates(states);
}

/**
 * Toggle pause for a widget externally (e.g. from a keyboard shortcut).
 * Dispatches a DOM event so any mounted useWidgetPause hook for that nodeId stays in sync.
 */
export function toggleWidgetPauseExternal(nodeId: string): void {
	const state = getWidgetState(nodeId);
	const newValue = !(state.paused ?? false);
	updateWidgetState(nodeId, { paused: newValue });
	window.dispatchEvent(new CustomEvent('widget-pause-changed', {
		detail: { widgetId: nodeId, isPaused: newValue },
	}));
}

/** Remove all persisted state for a widget (e.g. when a leaf node is deleted). */
export function removeWidgetState(nodeId: string): void {
	try {
		const states = loadWidgetStates();
		delete states[nodeId];
		saveWidgetStates(states);
	} catch (error) {
		console.warn('Failed to remove widget state:', error);
	}
}

interface UseWidgetPauseResult {
	/** Whether the widget is currently paused */
	isPaused: boolean;
	/** Toggle pause state */
	togglePause: () => void;
	/** Pause button component to render in the header */
	PauseButton: React.FC<{ className?: string }>;
	/** Overlay component to render when paused */
	PauseOverlay: React.FC;
}

/**
 * Hook to add pause functionality to on-demand widgets
 *
 * @param widgetId Unique identifier — scoped to the bento leaf node ID for per-instance pause
 * @param _widgetName Display name for the widget (reserved for future use)
 */
export function useWidgetPause(widgetId: string, _widgetName?: string): UseWidgetPauseResult {
	const [isPaused, setIsPaused] = useState<boolean>(() => {
		const state = getWidgetState(widgetId);
		return state.paused ?? false;
	});

	const hasInitialized = useRef(false);

	// Load initial state from storage (for SSR compatibility)
	useEffect(() => {
		if (hasInitialized.current) return;
		hasInitialized.current = true;

		const state = getWidgetState(widgetId);
		if (state.paused !== undefined) {
			setIsPaused(state.paused);
		}
	}, [widgetId]);

	// Sync with external pause toggles (e.g. Space shortcut from BentoApp)
	useEffect(() => {
		const handler = (e: Event) => {
			const { widgetId: id, isPaused: paused } = (e as CustomEvent).detail;
			if (id === widgetId) setIsPaused(paused);
		};
		window.addEventListener('widget-pause-changed', handler);
		return () => window.removeEventListener('widget-pause-changed', handler);
	}, [widgetId]);

	const togglePause = useCallback(() => {
		setIsPaused((prev) => {
			const newValue = !prev;
			updateWidgetState(widgetId, { paused: newValue });
			return newValue;
		});
	}, [widgetId]);

	// Pause button/indicator for the header
	// When paused, shows a more prominent indicator with "Paused" text
	const PauseButton: React.FC<{ className?: string }> = useCallback(
		({ className = '' }) =>
			isPaused ? (
				<button
					onClick={togglePause}
					className={`flex items-center gap-1 px-1.5 py-0.5 bg-warning/20 hover:bg-warning/30 rounded transition-colors ${className}`}
					title="Resume widget"
					data-doc='{"title":"Widget Paused","desc":"This widget is paused and will not process new input. Click to resume automatic processing."}'
				>
					<Play size={10} className="text-warning" />
					<span className="text-[10px] font-medium text-warning">Paused</span>
				</button>
			) : (
				<button
					onClick={togglePause}
					className={`p-1 hover:bg-base-200 rounded transition-colors ${className}`}
					title="Pause widget"
					data-doc='{"title":"Pause Widget","desc":"Pause this widget to stop automatic processing. Useful to save resources when not needed."}'
				>
					<Pause size={12} className="text-base-content/40" />
				</button>
			),
		[isPaused, togglePause]
	);

	// No overlay - widget content stays visible when paused
	const PauseOverlay: React.FC = useCallback(() => null, []);

	return {
		isPaused,
		togglePause,
		PauseButton,
		PauseOverlay,
	};
}
