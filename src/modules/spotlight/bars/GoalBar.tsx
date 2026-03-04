/**
 * Goal Bar — Spotlight bar for active goal tracking.
 *
 * Refactored from ActiveGoalTimer. Same WatermelonDB observe query,
 * same timer, same hover actions (done/dismiss/edit).
 */

import { useState, useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../../../db/database';
import type Goal from '../../../db/models/Goal';
import { Target, CheckCircle, XCircle, Pencil } from 'lucide-react';
import { goalStore } from '../../../db/stores/goalStore';
import { GoalManager } from '../../../components/v2/GoalManager';
import { formatDuration } from '../../../program/utils/time';
import type { SpotlightBarDefinition, SpotlightBarData } from '../types';

interface GoalBarData extends SpotlightBarData {
	goal: Goal | null;
	elapsed: number;
}

function useGoalBarData(): GoalBarData {
	const [elapsed, setElapsed] = useState(0);
	const [activeGoal, setActiveGoal] = useState<Goal | null>(null);

	// Observe the most recently referenced active goal
	useEffect(() => {
		const goals = database.get<Goal>('goals');
		const query = goals.query(
			Q.where('status', 'active'),
			Q.sortBy('lastReferenced', Q.desc),
			Q.take(1)
		);

		const subscription = query.observe().subscribe((results) => {
			setActiveGoal(results[0] || null);
		});

		return () => subscription.unsubscribe();
	}, []);

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
					onClick={() => goalStore.updateStatus(goal.id, 'achieved')}
					className="p-0.5 text-green-600/60 hover:scale-125 rounded transition-transform"
					title="Done — mark as achieved"
				>
					<CheckCircle size={11} />
				</button>
				<button
					onClick={() => goalStore.updateStatus(goal.id, 'abandoned')}
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
