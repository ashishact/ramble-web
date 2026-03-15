/**
 * Goal Bar — Spotlight bar for active goal tracking.
 *
 * Uses DuckDB graph data via useGraphData.
 * Shows timer since goal creation, progress, and hover actions.
 */

import { useState, useEffect } from 'react';
import { Target, CheckCircle, XCircle, Pencil } from 'lucide-react';
import { useGraphData, graphMutations } from '../../../graph/data';
import type { GoalItem } from '../../../graph/data';
import { GoalManager } from '../../../components/v2/GoalManager';
import { formatDuration } from '../../../program/utils/time';
import type { SpotlightBarDefinition, SpotlightBarData } from '../types';

interface GoalBarData extends SpotlightBarData {
	goal: GoalItem | null;
	elapsed: number;
}

function useGoalBarData(): GoalBarData {
	const [elapsed, setElapsed] = useState(0);

	const { data: goals } = useGraphData<GoalItem>('goal', {
		where: { status: 'active' },
		orderBy: { field: 'lastReferenced', dir: 'desc' },
		limit: 1,
	});

	const activeGoal = goals[0] ?? null;

	// Timer: update every second based on when goal was first expressed
	useEffect(() => {
		if (!activeGoal) return;

		const updateElapsed = () => {
			const seconds = Math.floor((Date.now() - activeGoal.firstExpressed) / 1000);
			setElapsed(seconds);
		};

		updateElapsed();
		const interval = setInterval(updateElapsed, 1000);
		return () => clearInterval(interval);
	}, [activeGoal]);

	return {
		hasContent: !!activeGoal,
		label: activeGoal?.statement ?? 'No active goal',
		goal: activeGoal,
		elapsed,
	};
}

function GoalBarComponent({ data }: { data: GoalBarData }) {
	const [showGoalManager, setShowGoalManager] = useState(false);
	const { goal, elapsed } = data;

	if (!goal) {
		return <span className="text-violet-700/50 italic text-xs">No active goal</span>;
	}

	const handleUpdateStatus = async (status: string) => {
		await graphMutations.updateNodeProperties(goal.id, { status });
	};

	return (
		<>
			{/* Timer */}
			<span
				className="font-mono text-violet-700/70 flex-shrink-0"
				data-doc='{"title":"Goal Age","desc":"Time elapsed since this goal was first created."}'
			>
				{formatDuration(elapsed)}
			</span>

			{/* Separator */}
			<span className="text-violet-700/30 flex-shrink-0">|</span>

			{/* Goal icon */}
			<Target size={12} className="text-violet-700 flex-shrink-0" />

			{/* Goal statement */}
			<span
				className="text-violet-700 font-medium truncate"
				title={goal.statement}
				data-doc='{"title":"Current Goal","desc":"Your most recently referenced active goal."}'
			>
				{goal.statement}
			</span>

			{/* Progress */}
			<span className="flex-shrink-0 font-mono text-violet-700/50 ml-2">{goal.progress}%</span>

			{/* Separator + Action buttons */}
			<span className="ml-auto text-violet-700/30 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">|</span>
			<div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
				<button
					onClick={() => handleUpdateStatus('achieved')}
					className="p-0.5 text-green-600/60 hover:scale-125 rounded transition-transform"
					title="Done — mark as achieved"
				>
					<CheckCircle size={11} />
				</button>
				<button
					onClick={() => handleUpdateStatus('abandoned')}
					className="p-0.5 text-red-500/60 hover:scale-125 rounded transition-transform"
					title="Dismiss — no longer required"
				>
					<XCircle size={11} />
				</button>
				<button
					onClick={() => setShowGoalManager(true)}
					className="p-0.5 text-violet-700/60 hover:scale-125 rounded transition-transform"
					title="Edit goal"
				>
					<Pencil size={11} />
				</button>
			</div>

			{showGoalManager && (
				<GoalManager
					onClose={() => setShowGoalManager(false)}
					editGoalId={goal.id}
				/>
			)}
		</>
	);
}

export const goalBar: SpotlightBarDefinition<GoalBarData> = {
	type: 'goal',
	name: 'Active Goal',
	icon: Target,
	bgClass: 'bg-violet-50',
	textClass: 'text-violet-700',
	useData: useGoalBarData,
	Component: GoalBarComponent,
};
