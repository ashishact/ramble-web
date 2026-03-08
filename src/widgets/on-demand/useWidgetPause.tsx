/**
 * Widget Pause Hook
 *
 * Provides pause/resume functionality for on-demand widgets.
 * Uses the shared widgetState module for persistence.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Pause, Play } from 'lucide-react';
import { getWidgetValue, updateWidgetState } from './widgetState';

// Re-export widgetState functions for convenience
export { getWidgetState, getWidgetValue, updateWidgetState, removeWidgetState } from './widgetState';

/**
 * Toggle pause for a widget externally (e.g. from a keyboard shortcut).
 * Dispatches a DOM event so any mounted useWidgetPause hook for that nodeId stays in sync.
 */
export function toggleWidgetPauseExternal(nodeId: string): void {
	const paused = getWidgetValue<boolean>(nodeId, 'paused', false);
	const newValue = !paused;
	updateWidgetState(nodeId, { paused: newValue });
	window.dispatchEvent(new CustomEvent('widget-pause-changed', {
		detail: { widgetId: nodeId, isPaused: newValue },
	}));
}

interface UseWidgetPauseResult {
	isPaused: boolean;
	togglePause: () => void;
	PauseButton: React.FC<{ className?: string }>;
	PauseOverlay: React.FC;
}

/**
 * Hook to add pause functionality to on-demand widgets
 *
 * @param widgetId Unique identifier — scoped to the bento leaf node ID for per-instance pause
 * @param _widgetName Display name for the widget (reserved for future use)
 */
export function useWidgetPause(widgetId: string, _widgetName?: string): UseWidgetPauseResult {
	const [isPaused, setIsPaused] = useState<boolean>(() =>
		getWidgetValue<boolean>(widgetId, 'paused', false)
	);

	const hasInitialized = useRef(false);

	useEffect(() => {
		if (hasInitialized.current) return;
		hasInitialized.current = true;
		const paused = getWidgetValue<boolean>(widgetId, 'paused', false);
		setIsPaused(paused);
	}, [widgetId]);

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

	const PauseOverlay: React.FC = useCallback(() => null, []);

	return { isPaused, togglePause, PauseButton, PauseOverlay };
}
