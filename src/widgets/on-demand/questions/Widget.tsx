import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generateQuestions,
  saveQuestionsToStorage,
  loadQuestionsFromStorage,
  type Question,
  type QuestionResult,
} from './process';
import { pipelineStatus, type PipelineState } from '../../../program/kernel/pipelineStatus';
import {
  HelpCircle,
  RefreshCw,
  AlertCircle,
  X,
  Target,
  Compass,
  MessageCircle,
  Search,
  type LucideIcon,
} from 'lucide-react';

type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// Category icons
const categoryIcons: Record<Question['category'], LucideIcon> = {
  missing_info: Search,
  follow_up: MessageCircle,
  clarification: HelpCircle,
  action: Target,
  explore: Compass,
};

// Category colors using DaisyUI semantic colors
const categoryColors: Record<Question['category'], string> = {
  missing_info: 'text-warning',
  follow_up: 'text-info',
  clarification: 'text-secondary',
  action: 'text-success',
  explore: 'text-accent',
};

// Minimal category labels
const categoryLabels: Record<Question['category'], string> = {
  missing_info: 'missing',
  follow_up: 'follow-up',
  clarification: 'clarify',
  action: 'action',
  explore: 'explore',
};

export function QuestionWidget() {
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wasRunningRef = useRef(false);
  const hasLoadedFromStorageRef = useRef(false);

  const fetchQuestions = useCallback(async (focusTopic?: string) => {
    setLoadingState('loading');
    setError(null);

    const previousQuestions = result?.questions.map(q => q.text) ?? [];

    try {
      const questions = await generateQuestions(focusTopic, previousQuestions);
      setResult(questions);
      setLoadingState('success');
      saveQuestionsToStorage(questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
      setLoadingState('error');
    }
  }, [result]);

  useEffect(() => {
    if (hasLoadedFromStorageRef.current) return;
    hasLoadedFromStorageRef.current = true;

    const stored = loadQuestionsFromStorage();
    if (stored) {
      setResult(stored);
      setLoadingState('success');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = pipelineStatus.subscribe((state: PipelineState) => {
      const wasRunning = wasRunningRef.current;
      const isNowComplete = !state.isRunning;
      const doneStep = state.steps.find(s => s.id === 'done');
      const isSuccess = doneStep?.status === 'success';

      if (wasRunning && isNowComplete && isSuccess) {
        fetchQuestions();
      }

      wasRunningRef.current = state.isRunning;
    });

    return unsubscribe;
  }, [fetchQuestions]);

  const handleTopicClick = useCallback((topic: string) => {
    if (selectedTopic === topic) {
      setSelectedTopic(null);
      fetchQuestions();
    } else {
      setSelectedTopic(topic);
      fetchQuestions(topic);
    }
  }, [selectedTopic, fetchQuestions]);

  const handleRefresh = useCallback(() => {
    setSelectedTopic(null);
    fetchQuestions();
  }, [fetchQuestions]);

  // Error state
  if (loadingState === 'error') {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-base-content/50 p-2"
        data-doc='{"icon":"mdi:help-circle","title":"Questions","desc":"AI-generated questions to prompt you for more info. Click Retry to try again."}'
      >
        <AlertCircle className="w-5 h-5 mb-1 text-error" />
        <span className="text-[10px] text-base-content/60">{error}</span>
        <button
          onClick={() => fetchQuestions()}
          className="btn btn-xs btn-ghost mt-2"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (!result || result.questions.length === 0) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-base-content/50 p-2"
        data-doc='{"icon":"mdi:help-circle","title":"Questions","desc":"AI-generated questions will appear here after you start a conversation. Click Refresh to generate questions."}'
      >
        <HelpCircle className="w-5 h-5 mb-1 opacity-40" />
        <span className="text-[10px]">No questions</span>
        <span className="text-[9px] opacity-50">Start talking first</span>
        <button
          onClick={handleRefresh}
          className="btn btn-xs btn-ghost mt-2 gap-1"
        >
          <RefreshCw size={10} />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:help-circle","title":"Questions","desc":"AI questions to prompt you for more info. Categorized as: missing info, follow-up, clarification, action, or explore. Filter by topic at the bottom. Auto-refreshes after each conversation."}'
    >
      {/* Header */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {loadingState === 'loading' ? (
            <>
              <span className="loading loading-spinner loading-xs text-primary"></span>
              <span className="text-[11px] font-medium text-primary">Generating...</span>
            </>
          ) : (
            <>
              <HelpCircle className="w-3.5 h-3.5 text-base-content/40" />
              <span className="text-[11px] font-medium text-base-content/70">
                {selectedTopic ? selectedTopic : 'Questions'}
              </span>
            </>
          )}
        </div>
        <button
          onClick={handleRefresh}
          className="p-1 hover:bg-base-200 rounded transition-colors"
          title="Refresh"
          disabled={loadingState === 'loading'}
        >
          <RefreshCw size={12} className="text-base-content/40" />
        </button>
      </div>

      {/* Questions List */}
      <div className="flex-1 overflow-auto p-1.5">
        {result.questions.map((question, index) => {
          const Icon = categoryIcons[question.category];
          const isOdd = index % 2 === 1;
          return (
            <div
              key={question.id}
              className={`px-2 py-1.5 rounded transition-colors ${
                isOdd ? 'bg-base-200/60' : 'bg-base-200/30'
              } hover:bg-base-200`}
            >
              <div className="flex items-start gap-1.5">
                <Icon size={14} className={`flex-shrink-0 mt-0.5 opacity-70 ${categoryColors[question.category]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-base-content/70 leading-snug">{question.text}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] text-base-content/50">
                      {categoryLabels[question.category]}
                    </span>
                    {question.relatedTopics.slice(0, 2).map((topic) => (
                      <span
                        key={topic}
                        className="text-[9px] text-base-content/30"
                      >
                        · {topic}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Topic Filters */}
      {result.availableTopics.length > 0 && (
        <div className="flex-shrink-0 px-2 py-1 border-t border-base-200/50">
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[9px] text-base-content/40 uppercase tracking-wide">
              Topics
            </span>
            {selectedTopic && (
              <button
                onClick={() => {
                  setSelectedTopic(null);
                  fetchQuestions();
                }}
                className="ml-auto p-0.5 hover:bg-base-200 rounded"
              >
                <X size={8} className="text-base-content/30" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-0.5">
            {result.availableTopics.map((topic) => (
              <button
                key={topic}
                onClick={() => handleTopicClick(topic)}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                  selectedTopic === topic
                    ? 'bg-primary/20 text-primary'
                    : 'bg-base-200/50 text-base-content/60 hover:bg-base-300 hover:text-base-content'
                }`}
              >
                {topic}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
