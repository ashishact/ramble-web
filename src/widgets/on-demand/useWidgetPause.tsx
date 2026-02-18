/**
 * Widget Pause Hook
 *
 * Provides pause/resume functionality for on-demand widgets.
 * When paused:
 * - Widget should not process or make LLM calls
 * - An overlay is shown indicating paused state
 * - State persists across page reloads
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { z } from 'zod';
import { Pause, Play } from 'lucide-react';
import { profileStorage } from '../../lib/profileStorage';

const PAUSE_STORAGE_KEY = 'widget-pause-states';

const PauseStatesSchema = z.record(z.string(), z.boolean());

type PauseStates = z.infer<typeof PauseStatesSchema>;

function loadPauseStates(): PauseStates {
	try {
		const raw = profileStorage.getJSON<unknown>(PAUSE_STORAGE_KEY);
		if (raw == null) return {};
		const result = PauseStatesSchema.safeParse(raw);
		if (!result.success) {
			console.warn('[useWidgetPause] Stored pause states failed validation — resetting:', result.error.issues);
			return {};
		}
		return result.data;
	} catch {
		return {};
	}
}

function savePauseState(widgetId: string, isPaused: boolean): void {
	try {
		const states = loadPauseStates();
		states[widgetId] = isPaused;
		profileStorage.setJSON(PAUSE_STORAGE_KEY, states);
	} catch (error) {
		console.warn('Failed to save widget pause state:', error);
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
 * @param widgetId Unique identifier for this widget type (e.g., 'questions', 'suggestions', 'speak-better')
 * @param _widgetName Display name for the widget (reserved for future use)
 */
export function useWidgetPause(widgetId: string, _widgetName?: string): UseWidgetPauseResult {
	const [isPaused, setIsPaused] = useState<boolean>(() => {
		const states = loadPauseStates();
		return states[widgetId] ?? false;
	});

	const hasInitialized = useRef(false);

	// Load initial state from storage (for SSR compatibility)
	useEffect(() => {
		if (hasInitialized.current) return;
		hasInitialized.current = true;

		const states = loadPauseStates();
		if (states[widgetId] !== undefined) {
			setIsPaused(states[widgetId]);
		}
	}, [widgetId]);

	const togglePause = useCallback(() => {
		setIsPaused((prev) => {
			const newValue = !prev;
			savePauseState(widgetId, newValue);
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
