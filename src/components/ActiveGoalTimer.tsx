/**
 * Active Goal Timer
 *
 * Displays a session timer and the most recently referenced active goal.
 * Single line, no wrapping, prominent styling.
 */

import { useState, useEffect } from 'react';
import { Q } from '@nozbe/watermelondb';
import { database } from '../db/database';
import type Goal from '../db/models/Goal';
import { Target } from 'lucide-react';

// Format duration as HH:MM:SS
function formatDuration(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = seconds % 60;
	return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function ActiveGoalTimer() {
	const [elapsed, setElapsed] = useState(0);
	const [activeGoal, setActiveGoal] = useState<Goal | null>(null);

	// Timer: update every second based on when goal was first expressed
	useEffect(() => {
		if (!activeGoal) return;

		// Calculate elapsed time since goal was created
		const updateElapsed = () => {
			const seconds = Math.floor((Date.now() - activeGoal.firstExpressed) / 1000);
			setElapsed(seconds);
		};

		// Update immediately
		updateElapsed();

		// Then update every second
		const interval = setInterval(updateElapsed, 1000);

		return () => clearInterval(interval);
	}, [activeGoal]);

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

	// Don't render if no active goal
	if (!activeGoal) {
		return null;
	}

	return (
		<div
			className="flex-1 flex items-center gap-2 px-2 py-0.5 bg-primary/10 rounded text-xs min-w-0"
			data-doc='{"title":"Active Goal","desc":"Shows your current session timer and most recently referenced active goal."}'
		>
			{/* Timer */}
			<span
				className="font-mono text-primary/70 flex-shrink-0"
				data-doc='{"title":"Goal Age","desc":"Time elapsed since this goal was first created."}'
			>
				{formatDuration(elapsed)}
			</span>

			{/* Separator */}
			<span className="text-primary/30 flex-shrink-0">|</span>

			{/* Goal icon */}
			<Target size={12} className="text-primary flex-shrink-0" />

			{/* Goal statement - truncate with ellipsis, takes remaining space */}
			<span
				className="text-primary font-medium truncate"
				title={activeGoal.statement}
				data-doc='{"title":"Current Goal","desc":"Your most recently referenced active goal. Click to see full text."}'
			>
				{activeGoal.statement}
			</span>
		</div>
	);
}
