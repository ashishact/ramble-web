import { useState, useEffect, useCallback, useRef } from 'react';
import {
  generateQuestions,
  generateMeetingQuestions,
  saveQuestionsToStorage,
  loadQuestionsFromStorage,
  type Question,
  type QuestionResult,
} from './process';
import { pipelineStatus, type PipelineState } from '../../../program/kernel/pipelineStatus';
import { meetingStatus, type MeetingSegment } from '../../../program/kernel/meetingStatus';
import { useWidgetPause } from '../useWidgetPause';
import { Icon } from '@iconify/react';
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

// Meeting mode accumulation thresholds
const MEETING_MIN_CHARS = 200;
const MEETING_THROTTLE_MS = 30_000;

export function QuestionWidget() {
  const [result, setResult] = useState<QuestionResult | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isMeetingMode, setIsMeetingMode] = useState(() => meetingStatus.getState().isActive);

  // Pause functionality
  const { isPaused, PauseButton, PauseOverlay } = useWidgetPause('questions', 'Questions');

  const wasRunningRef = useRef(false);
  const hasLoadedFromStorageRef = useRef(false);

  // Meeting mode accumulation refs
  const pendingMeetingCharsRef = useRef(0);
  const lastMeetingGenRef = useRef(0);

  // ── BATCH mode: generate from working memory (solo / in-app) ─────────────
  // Triggered after pipelineStatus completes (new speech or typed input committed).
  // Uses WorkingMemory (DB conversations, entities, topics, memories).
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

  // ── STREAMING mode: generate from live meeting transcript (meeting / out-of-app) ──
  // Triggered by meetingStatus accumulation (200 chars, 30s throttle).
  // Uses the raw live segments — NOT WorkingMemory — so questions are about
  // what's being said right now, not the user's past conversation history.
  const fetchMeetingQuestions = useCallback(async (segments: MeetingSegment[]) => {
    setLoadingState('loading');
    setError(null);
    const previousQuestions = result?.questions.map(q => q.text) ?? [];
    try {
      const questions = await generateMeetingQuestions(segments, previousQuestions);
      setResult(questions);
      setLoadingState('success');
      saveQuestionsToStorage(questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate meeting questions');
      setLoadingState('error');
    }
  }, [result]);

  // Keep a stable ref so the meetingStatus effect never needs fetchMeetingQuestions in its deps
  const fetchMeetingQuestionsRef = useRef(fetchMeetingQuestions);
  fetchMeetingQuestionsRef.current = fetchMeetingQuestions;

  // ── Load persisted result on mount ─────────────────────────────────────────
  useEffect(() => {
    if (hasLoadedFromStorageRef.current) return;
    hasLoadedFromStorageRef.current = true;
    loadQuestionsFromStorage().then(stored => {
      if (stored) { setResult(stored); setLoadingState('success'); }
    }).catch(() => {});
  }, []);

  // ── Track meeting mode ─────────────────────────────────────────────────────
  useEffect(() => {
    return meetingStatus.subscribe((state) => {
      setIsMeetingMode(state.isActive);
    });
  }, []);

  // ── Normal pipeline trigger (disabled in meeting mode) ────────────────────
  useEffect(() => {
    if (isPaused || isMeetingMode) return;

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
  }, [fetchQuestions, isPaused, isMeetingMode]);

  // ── Meeting mode accumulation trigger ─────────────────────────────────────
  useEffect(() => {
    if (!isMeetingMode || isPaused) return;

    let lastSegCount = meetingStatus.getState().segments.length;
    pendingMeetingCharsRef.current = 0;

    return meetingStatus.subscribe((state) => {
      if (!state.isActive) return;

      const newSegs = state.segments.slice(lastSegCount);
      if (newSegs.length === 0) return;
      lastSegCount = state.segments.length;

      pendingMeetingCharsRef.current += newSegs.reduce((acc, s) => acc + s.text.length, 0);

      const now = Date.now();
      const throttleOk = now - lastMeetingGenRef.current >= MEETING_THROTTLE_MS;

      if (pendingMeetingCharsRef.current >= MEETING_MIN_CHARS && throttleOk) {
        pendingMeetingCharsRef.current = 0;
        lastMeetingGenRef.current = now;
        fetchMeetingQuestionsRef.current(state.segments);
      }
    });
  }, [isMeetingMode, isPaused]);

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
    if (isMeetingMode) {
      const segments = meetingStatus.getState().segments;
      if (segments.length > 0) {
        fetchMeetingQuestionsRef.current(segments);
      }
    } else {
      fetchQuestions();
    }
  }, [fetchQuestions, isMeetingMode]);

  // Error state
  if (loadingState === 'error') {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center text-base-content/50 p-2"
        data-doc='{"icon":"mdi:help-circle","title":"Questions","desc":"AI-generated questions to prompt you for more info. Click Retry to try again."}'
      >
        <PauseOverlay />
        <AlertCircle className="w-5 h-5 mb-1 text-error" />
        <span className="text-[10px] text-base-content/60">{error}</span>
        <button onClick={() => fetchQuestions()} className="btn btn-xs btn-ghost mt-2">
          Retry
        </button>
      </div>
    );
  }

  // Empty state
  if (!result || result.questions.length === 0) {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center text-base-content/50 p-2"
        data-doc='{"icon":"mdi:help-circle","title":"Questions","desc":"AI-generated questions will appear here after you start a conversation. In meeting mode, questions update live from the meeting transcript."}'
      >
        <PauseOverlay />
        <HelpCircle className="w-5 h-5 mb-1 opacity-40" />
        {isMeetingMode ? (
          <>
            <span className="text-[10px]">Listening to meeting...</span>
            <span className="text-[9px] opacity-50">Questions will appear as conversation accumulates</span>
          </>
        ) : (
          <>
            <span className="text-[10px]">No questions</span>
            <span className="text-[9px] opacity-50">Start talking first</span>
          </>
        )}
        {!isMeetingMode && (
          <button onClick={handleRefresh} className="btn btn-xs btn-ghost mt-2 gap-1">
            <RefreshCw size={10} />
            Refresh
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      className="w-full h-full relative flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:help-circle","title":"Questions","desc":"AI questions to prompt you for more info. In meeting mode (Group), generates questions to ask other participants based on the live transcript."}'
    >
      <PauseOverlay />
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
              {isMeetingMode && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-400/15 border border-violet-400/25">
                  <Icon icon="mdi:account-group" width={9} height={9} className="text-violet-500/80" />
                  <span className="text-[8px] font-semibold text-violet-500/80 tracking-wide">Group</span>
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <PauseButton />
          <button
            onClick={handleRefresh}
            className="p-1 hover:bg-base-200 rounded transition-colors"
            title="Refresh"
            disabled={loadingState === 'loading'}
          >
            <RefreshCw size={12} className="text-base-content/40" />
          </button>
        </div>
      </div>

      {/* Questions List */}
      <div className="flex-1 overflow-auto p-1.5">
        {result.questions.map((question, index) => {
          const Icon = categoryIcons[question.category];
          const isOdd = index % 2 === 1;
          const topicParts = question.topic.split(' / ').map(p => p.trim());
          const domain = topicParts.length > 1 ? topicParts[0] : null;
          const topicName = topicParts.length > 1 ? topicParts.slice(1).join(' / ') : topicParts[0];
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
                  <div className="flex items-center gap-1 mb-0.5">
                    {domain && (
                      <span className="text-[9px] font-medium text-primary/70 uppercase">{domain}</span>
                    )}
                    {domain && <span className="text-[9px] text-base-content/30">/</span>}
                    <span className="text-[9px] text-base-content/50">{topicName}</span>
                  </div>
                  <p className="text-xs text-base-content/70 leading-snug">{question.text}</p>
                  <span className="text-[9px] text-base-content/40 mt-0.5">
                    {categoryLabels[question.category]}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Topic Filters */}
      {result.availableTopics.length > 0 && (
        <div className={`flex-shrink-0 px-2 py-1 border-t border-base-200/50 ${loadingState === 'loading' ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[9px] text-base-content/40 uppercase tracking-wide">Topics</span>
            {selectedTopic && (
              <button
                onClick={() => { setSelectedTopic(null); fetchQuestions(); }}
                disabled={loadingState === 'loading'}
                className="ml-auto p-0.5 hover:bg-base-200 rounded disabled:opacity-50"
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
                disabled={loadingState === 'loading'}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
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
