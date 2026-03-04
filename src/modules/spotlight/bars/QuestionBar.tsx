/**
 * Question Bar — Spotlight bar for highest-priority question.
 *
 * Subscribes to eventBus 'questions:updated' and loads initial state
 * from loadQuestionsFromStorage() on mount.
 * Shows highest-priority question with topic badge.
 */

import { useState, useEffect } from 'react';
import { HelpCircle } from 'lucide-react';
import { eventBus } from '../../../lib/eventBus';
import { loadQuestionsFromStorage, type Question } from '../../../widgets/on-demand/questions/process';
import { formatRelativeTime } from '../../../program/utils/time';
import type { SpotlightBarDefinition, SpotlightBarData } from '../types';

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

interface QuestionBarData extends SpotlightBarData {
	question: Question | null;
	generatedAt: number | null;
}

function useQuestionBarData(): QuestionBarData {
	const [questions, setQuestions] = useState<Question[]>([]);
	const [generatedAt, setGeneratedAt] = useState<number | null>(null);
	// Force re-render every 30s to update relative time
	const [, setTick] = useState(0);

	// Load initial questions from storage
	useEffect(() => {
		loadQuestionsFromStorage().then((result) => {
			if (result) {
				setQuestions(result.questions);
				setGeneratedAt(result.generatedAt);
			}
		});
	}, []);

	// Subscribe to live updates
	useEffect(() => {
		return eventBus.on('questions:updated', ({ questions: updated }) => {
			setQuestions(updated as Question[]);
			setGeneratedAt(Date.now());
		});
	}, []);

	// Tick for relative time updates
	useEffect(() => {
		const interval = setInterval(() => setTick(t => t + 1), 30_000);
		return () => clearInterval(interval);
	}, []);

	// Pick highest priority question
	const sorted = [...questions].sort(
		(a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1)
	);
	const top = sorted[0] ?? null;

	return {
		hasContent: !!top,
		label: top?.text ?? 'Waiting for questions...',
		question: top,
		generatedAt,
	};
}

function QuestionBarComponent({ data }: { data: QuestionBarData }) {
	const { question, generatedAt } = data;

	if (!question) {
		return <span className="text-sky-700/50 italic text-xs">Waiting for questions...</span>;
	}

	return (
		<>
			{/* Timer — when questions were generated */}
			<span className="font-mono text-sky-700/70 flex-shrink-0">
				{generatedAt ? formatRelativeTime(generatedAt) : '—'}
			</span>

			{/* Separator */}
			<span className="text-sky-700/30 flex-shrink-0">|</span>

			{/* Question icon */}
			<HelpCircle size={12} className="text-sky-700 flex-shrink-0" />

			{/* Question text */}
			<span
				className="text-sky-700 font-medium truncate"
				title={question.text}
			>
				{question.text}
			</span>

			{/* Topic badge */}
			<span className="flex-shrink-0 text-sky-700/50 text-[10px] uppercase tracking-wider ml-2">
				{question.topic}
			</span>
		</>
	);
}

export const questionBar: SpotlightBarDefinition<QuestionBarData> = {
	type: 'question',
	name: 'Top Question',
	icon: HelpCircle,
	bgClass: 'bg-sky-50',
	textClass: 'text-sky-700',
	useData: useQuestionBarData,
	Component: QuestionBarComponent,
};
