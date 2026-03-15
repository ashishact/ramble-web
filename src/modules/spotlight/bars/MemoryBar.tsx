/**
 * Memory Bar — Spotlight bar for latest memory.
 *
 * Uses DuckDB graph data via useGraphData.
 * Shows relative time since last reinforced, memory content, type badge.
 * Hover action: edit (opens MemoryManager with editMemoryId).
 */

import { useState, useEffect } from 'react';
import { Brain, Pencil } from 'lucide-react';
import { useGraphData } from '../../../graph/data';
import type { MemoryItem } from '../../../graph/data';
import { formatRelativeTime } from '../../../program/utils/time';
import { MemoryManager } from '../../../components/v2/MemoryManager';
import type { SpotlightBarDefinition, SpotlightBarData } from '../types';

interface MemoryBarData extends SpotlightBarData {
	memory: MemoryItem | null;
}

function useMemoryBarData(): MemoryBarData {
	// Force re-render every 30s to update relative time
	const [, setTick] = useState(0);

	const { data: memories } = useGraphData<MemoryItem>('memory', {
		orderBy: { field: 'created_at', dir: 'desc' },
		limit: 1,
	});

	// Filter out superseded
	const latestMemory = memories.find(m => m.state !== 'superseded' && !m.supersededBy) ?? null;

	// Tick for relative time updates
	useEffect(() => {
		const interval = setInterval(() => setTick(t => t + 1), 30_000);
		return () => clearInterval(interval);
	}, []);

	return {
		hasContent: !!latestMemory,
		label: latestMemory?.content ?? 'No memories yet',
		memory: latestMemory,
	};
}

function MemoryBarComponent({ data }: { data: MemoryBarData }) {
	const [showMemoryManager, setShowMemoryManager] = useState(false);
	const { memory } = data;

	if (!memory) {
		return <span className="text-teal-700/50 italic text-xs">No memories yet</span>;
	}

	return (
		<>
			{/* Relative time */}
			<span className="font-mono text-teal-700/70 flex-shrink-0">
				{formatRelativeTime(memory.lastReinforced)}
			</span>

			{/* Separator */}
			<span className="text-teal-700/30 flex-shrink-0">|</span>

			{/* Brain icon */}
			<Brain size={12} className="text-teal-700 flex-shrink-0" />

			{/* Memory content */}
			<span
				className="text-teal-700 font-medium truncate"
				title={memory.content}
			>
				{memory.content}
			</span>

			{/* Type badge */}
			<span className="flex-shrink-0 text-teal-700/50 text-[10px] uppercase tracking-wider ml-2">
				{memory.type}
			</span>

			{/* Separator + Edit button */}
			<span className="ml-auto text-teal-700/30 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">|</span>
			<div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
				<button
					onClick={() => setShowMemoryManager(true)}
					className="text-teal-700/60 hover:scale-125 rounded transition-transform"
					title="Edit memory"
				>
					<Pencil size={12} />
				</button>
			</div>

			{showMemoryManager && (
				<MemoryManager
					onClose={() => setShowMemoryManager(false)}
					editMemoryId={memory.id}
				/>
			)}
		</>
	);
}

export const memoryBar: SpotlightBarDefinition<MemoryBarData> = {
	type: 'memory',
	name: 'Latest Memory',
	icon: Brain,
	bgClass: 'bg-teal-50',
	textClass: 'text-teal-700',
	useData: useMemoryBarData,
	Component: MemoryBarComponent,
};
