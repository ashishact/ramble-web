/**
 * Memory Bar — Spotlight bar for latest memory.
 *
 * Observes the most recent non-superseded memory via WatermelonDB.
 * Shows relative time since last reinforced, memory content, type badge.
 * Hover action: edit (opens MemoryManager with editMemoryId).
 */

import { useState, useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../db/database';
import type Memory from '../../../db/models/Memory';
import { Brain, Pencil } from 'lucide-react';
import { formatRelativeTime } from '../../../program/utils/time';
import { MemoryManager } from '../../../components/v2/MemoryManager';
import type { SpotlightBarDefinition, SpotlightBarData } from '../types';

interface MemoryBarData extends SpotlightBarData {
	memory: Memory | null;
}

function useMemoryBarData(): MemoryBarData {
	const [latestMemory, setLatestMemory] = useState<Memory | null>(null);
	// Force re-render every 30s to update relative time
	const [, setTick] = useState(0);

	useEffect(() => {
		const col = database.get<Memory>('memories');
		const query = col.query(
			Q.where('supersededBy', null),
			Q.where('state', Q.notEq('superseded')),
			Q.sortBy('createdAt', Q.desc),
			Q.take(1)
		);

		const subscription = query.observe().subscribe((results) => {
			setLatestMemory(results[0] || null);
		});

		return () => subscription.unsubscribe();
	}, []);

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
