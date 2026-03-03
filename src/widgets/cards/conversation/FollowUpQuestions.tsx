/**
 * FollowUpQuestions — Inline follow-up prompts below the conversation
 *
 * Loads latest questions from DB on mount, then listens for `questions:updated`
 * events to stay in sync. Renders as subtle pill-style prompts that help the
 * user know what to talk about next.
 */

import { useState, useEffect, useRef } from 'react';
import { Icon } from '@iconify/react';
import { loadQuestionsFromStorage, type Question } from '../../on-demand/questions/process';
import { eventBus } from '../../../lib/eventBus';

export function FollowUpQuestions() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const hasLoadedRef = useRef(false);

  // Load from DB on mount
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    loadQuestionsFromStorage().then(stored => {
      if (stored?.questions) setQuestions(stored.questions);
    }).catch(() => {});
  }, []);

  // Listen for updates from the questions widget
  useEffect(() => {
    return eventBus.on('questions:updated', ({ questions: updated }) => {
      setQuestions(updated as Question[]);
    });
  }, []);

  if (questions.length === 0) return null;

  return (
    <div className="mt-4 mb-2 px-1">
      <div className="flex items-center gap-1.5 mb-2 text-base-content/30">
        <Icon icon="mdi:comment-question-outline" className="w-3.5 h-3.5" />
        <span className="text-[10px] uppercase tracking-wider font-medium">Follow-up</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {questions.map((q) => (
          <div
            key={q.id}
            className="px-3 py-1.5 text-xs text-base-content/60 bg-base-200/50 rounded-full
                       border border-base-300/30 leading-snug"
          >
            {q.text}
          </div>
        ))}
      </div>
    </div>
  );
}
