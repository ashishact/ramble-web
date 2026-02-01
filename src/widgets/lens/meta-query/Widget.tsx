/**
 * Meta Query Lens Widget
 *
 * ARCHITECTURE DECISION: First Lens Widget Implementation
 * ========================================================
 * This is the first lens widget - it demonstrates the lens pattern:
 *
 * 1. **Hover Activation**: Widget activates immediately on mouse enter
 * 2. **Input Capture**: When active, all speech/paste input routes here (not kernel)
 * 3. **Ephemeral Processing**: Query is processed against WorkingMemory, not saved to DB
 * 4. **Profile Storage**: Results persist in localStorage, not conversation history
 *
 * USE CASE:
 * "What did I say about X?" - Query your conversation without adding to it
 * "Summarize my goals" - Get a meta-view without polluting the timeline
 * "How many times did I mention Y?" - Analytics on your data
 *
 * VISUAL FEEDBACK:
 * - Widget gets `.lens-widget-active` class when cursor is over it
 * - Other widgets dim via CSS (see lens.css)
 * - Badge indicates "Not saved" to remind user this is ephemeral
 */

import { useState, useEffect } from 'react';
import { Search, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import { useLensWidget } from '../useLensWidget';
import { processMetaQuery, loadLensData } from './process';

export function MetaQueryLensWidget() {
	const { isActive, input, handlers, clearInput } = useLensWidget('meta-query', 'Meta Query');

	const [isProcessing, setIsProcessing] = useState(false);
	const [response, setResponse] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [lastQuery, setLastQuery] = useState<string | null>(null);

	// Load previous state on mount
	useEffect(() => {
		const saved = loadLensData();
		if (saved) {
			setLastQuery(saved.lastQuery || null);
			setResponse(saved.lastResponse || null);
		}
	}, []);

	// Process input when received
	useEffect(() => {
		if (!input) return;

		const processInput = async () => {
			setIsProcessing(true);
			setError(null);
			setLastQuery(input.text);

			try {
				const result = await processMetaQuery(input.text);
				setResponse(result);
			} catch (err) {
				setError(err instanceof Error ? err.message : 'An error occurred');
				setResponse(null);
			} finally {
				setIsProcessing(false);
				clearInput();
			}
		};

		processInput();
	}, [input, clearInput]);

	return (
		<div
			{...handlers}
			data-lens-active={isActive}
			className={`
				w-full h-full flex flex-col
				${isActive ? 'lens-widget-active' : ''}
			`}
			data-doc='{"icon":"mdi:magnify-scan","title":"Meta Query","desc":"Ask questions about your conversation without saving to history"}'
		>
			{/* Header */}
			<div className="px-3 py-2 border-b border-base-200 flex items-center gap-2">
				<Search size={14} className={isActive ? 'text-primary' : 'text-base-content/50'} />
				<span className="text-xs font-bold text-base-content/80">Meta Query</span>
				<span className="text-[9px] px-1.5 py-0.5 rounded-full bg-warning/20 text-warning-content/70">
					Not saved
				</span>
			</div>

			{/* Content */}
			<div className="flex-1 p-3 overflow-auto">
				{/* Instructions when idle */}
				{!isProcessing && !response && !error && (
					<div className="h-full flex flex-col items-center justify-center text-center">
						<div
							className={`
								p-3 rounded-full mb-3 transition-colors
								${isActive ? 'bg-primary/20' : 'bg-base-200'}
							`}
						>
							<Sparkles
								size={24}
								className={isActive ? 'text-primary' : 'text-base-content/30'}
							/>
						</div>
						<p className="text-sm font-medium text-base-content/70 mb-1">
							{isActive ? 'Speak your question...' : 'Hover to activate'}
						</p>
						<p className="text-xs text-base-content/50 max-w-[200px]">
							Ask about your conversations without adding to history
						</p>
					</div>
				)}

				{/* Processing state */}
				{isProcessing && (
					<div className="h-full flex flex-col items-center justify-center">
						<Loader2 size={24} className="animate-spin text-primary mb-3" />
						<p className="text-xs text-base-content/60">Analyzing your data...</p>
						{lastQuery && (
							<p className="text-xs text-base-content/40 mt-2 italic max-w-[250px] truncate">
								"{lastQuery}"
							</p>
						)}
					</div>
				)}

				{/* Error state */}
				{error && !isProcessing && (
					<div className="h-full flex flex-col items-center justify-center text-center">
						<div className="p-3 rounded-full bg-error/20 mb-3">
							<AlertCircle size={24} className="text-error" />
						</div>
						<p className="text-sm font-medium text-error mb-1">Error</p>
						<p className="text-xs text-base-content/60 max-w-[250px]">{error}</p>
					</div>
				)}

				{/* Response */}
				{response && !isProcessing && !error && (
					<div className="space-y-3">
						{lastQuery && (
							<div className="text-xs text-base-content/50 italic border-l-2 border-primary/30 pl-2">
								{lastQuery}
							</div>
						)}
						<div className="text-sm text-base-content/90 whitespace-pre-wrap leading-relaxed">
							{response}
						</div>
					</div>
				)}
			</div>

			{/* Footer hint */}
			{!isActive && (response || error) && (
				<div className="px-3 py-1.5 border-t border-base-200 text-center">
					<span className="text-[10px] text-base-content/40">
						Hover to ask another question
					</span>
				</div>
			)}
		</div>
	);
}
