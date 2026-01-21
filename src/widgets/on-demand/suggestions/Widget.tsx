import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generateSuggestions,
  saveSuggestionsToStorage,
  loadSuggestionsFromStorage,
  type Suggestion,
  type SuggestionResult,
} from './process';
import { pipelineStatus, type PipelineState } from '../../../program/kernel/pipelineStatus';
import {
  Lightbulb,
  RefreshCw,
  AlertCircle,
  X,
  HelpCircle,
  Target,
  Compass,
  MessageCircle,
  Search,
  type LucideIcon,
} from 'lucide-react';

type LoadingState = 'idle' | 'loading' | 'success' | 'error';

// Category icons (colored by category)
const categoryIcons: Record<Suggestion['category'], LucideIcon> = {
  missing_info: Search,
  follow_up: MessageCircle,
  clarification: HelpCircle,
  action: Target,
  explore: Compass,
};

// Muted category colors for icons
const categoryColors: Record<Suggestion['category'], string> = {
  missing_info: 'text-amber-400/70',
  follow_up: 'text-blue-400/70',
  clarification: 'text-purple-400/70',
  action: 'text-emerald-400/70',
  explore: 'text-cyan-400/70',
};

// Minimal category labels
const categoryLabels: Record<Suggestion['category'], string> = {
  missing_info: 'missing',
  follow_up: 'follow-up',
  clarification: 'clarify',
  action: 'action',
  explore: 'explore',
};

export function SuggestionWidget() {
  const [result, setResult] = useState<SuggestionResult | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track previous pipeline state to detect completion
  const wasRunningRef = useRef(false);
  // Track if we've loaded from localStorage (only do it once)
  const hasLoadedFromStorageRef = useRef(false);

  const fetchSuggestions = useCallback(async (focusTopic?: string) => {
    setLoadingState('loading');
    setError(null);

    try {
      const suggestions = await generateSuggestions(focusTopic);
      setResult(suggestions);
      setLoadingState('success');

      // Save to localStorage whenever we generate new suggestions
      saveSuggestionsToStorage(suggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate suggestions');
      setLoadingState('error');
    }
  }, []);

  // Load from localStorage once on mount
  useEffect(() => {
    if (hasLoadedFromStorageRef.current) return;
    hasLoadedFromStorageRef.current = true;

    const stored = loadSuggestionsFromStorage();
    if (stored) {
      setResult(stored);
      setLoadingState('success');
    }
  }, []);

  // Listen for pipeline completion to generate new suggestions
  useEffect(() => {
    const unsubscribe = pipelineStatus.subscribe((state: PipelineState) => {
      // Detect when pipeline just completed successfully
      // (was running, now not running, and 'done' step is success)
      const wasRunning = wasRunningRef.current;
      const isNowComplete = !state.isRunning;
      const doneStep = state.steps.find(s => s.id === 'done');
      const isSuccess = doneStep?.status === 'success';

      if (wasRunning && isNowComplete && isSuccess) {
        // Pipeline just completed successfully - generate suggestions
        fetchSuggestions();
      }

      wasRunningRef.current = state.isRunning;
    });

    return unsubscribe;
  }, [fetchSuggestions]);

  const handleTopicClick = useCallback((topic: string) => {
    if (selectedTopic === topic) {
      setSelectedTopic(null);
      fetchSuggestions();
    } else {
      setSelectedTopic(topic);
      fetchSuggestions(topic);
    }
  }, [selectedTopic, fetchSuggestions]);

  const handleRefresh = useCallback(() => {
    setSelectedTopic(null);
    fetchSuggestions();
  }, [fetchSuggestions]);

  // Loading state - Compact
  if (loadingState === 'loading') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2">
        <RefreshCw className="w-5 h-5 mb-1 animate-spin" />
        <span className="text-[10px]">Analyzing...</span>
        {selectedTopic && (
          <span className="text-[9px] opacity-50">{selectedTopic}</span>
        )}
      </div>
    );
  }

  // Error state - Compact
  if (loadingState === 'error') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2">
        <AlertCircle className="w-5 h-5 mb-1 text-slate-400" />
        <span className="text-[10px] text-slate-400">{error}</span>
        <button
          onClick={() => fetchSuggestions()}
          className="mt-2 px-2 py-1 text-[10px] bg-slate-100 hover:bg-slate-200 rounded transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  // Empty state - Compact
  if (!result || result.suggestions.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2">
        <Lightbulb className="w-5 h-5 mb-1 opacity-40" />
        <span className="text-[10px]">No suggestions</span>
        <span className="text-[9px] opacity-50">Start talking first</span>
        <button
          onClick={handleRefresh}
          className="mt-2 px-2 py-1 text-[10px] bg-slate-100 hover:bg-slate-200 rounded transition-colors flex items-center gap-0.5"
        >
          <RefreshCw size={10} />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden">
      {/* Header - Compact */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Lightbulb className="w-3.5 h-3.5 text-slate-400" />
          <span className="text-[11px] font-medium text-slate-500">
            {selectedTopic ? selectedTopic : 'Suggestions'}
          </span>
        </div>
        <button
          onClick={handleRefresh}
          className="p-0.5 hover:bg-slate-100 rounded transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className="text-slate-300" />
        </button>
      </div>

      {/* Suggestions List - Compact with odd/even backgrounds */}
      <div className="flex-1 overflow-auto p-1.5">
        {result.suggestions.map((suggestion, index) => {
          const Icon = categoryIcons[suggestion.category];
          const isOdd = index % 2 === 1;
          return (
            <div
              key={suggestion.id}
              className={`px-2 py-1.5 rounded transition-colors ${
                isOdd ? 'bg-slate-100/60' : 'bg-slate-50/40'
              } hover:bg-slate-100/80`}
            >
              <div className="flex items-start gap-1.5">
                <Icon size={14} className={`flex-shrink-0 mt-0.5 ${categoryColors[suggestion.category]}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-slate-600 leading-snug">{suggestion.text}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] text-slate-400">
                      {categoryLabels[suggestion.category]}
                    </span>
                    {suggestion.relatedTopics.slice(0, 2).map((topic) => (
                      <span
                        key={topic}
                        className="text-[9px] text-slate-300"
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

      {/* Topic Filters - Compact */}
      {result.availableTopics.length > 0 && (
        <div className="flex-shrink-0 px-2 py-1.5 border-t border-slate-100 bg-slate-50/30">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-[9px] text-slate-400 uppercase tracking-wide">
              Topics
            </span>
            {selectedTopic && (
              <button
                onClick={() => {
                  setSelectedTopic(null);
                  fetchSuggestions();
                }}
                className="ml-auto text-[9px] text-slate-300 hover:text-slate-500 flex items-center"
              >
                <X size={8} />
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
                    ? 'bg-slate-400 text-white'
                    : 'bg-white/50 text-slate-500 hover:bg-slate-100'
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
