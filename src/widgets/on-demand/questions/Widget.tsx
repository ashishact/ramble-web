/**
 * QuestionWidget — Interview Mode
 *
 * Displays questions from the InterviewEngine. Each time the user speaks,
 * the engine pipes the text to an AI and receives exactly ONE follow-up
 * question. This widget shows:
 *   - The latest question prominently in a hero card
 *   - Previous questions in a timeline below
 *   - Status indicators for engine state
 *   - Retry button when there are unsent conversations
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { eventBus } from '../../../lib/eventBus';
import { getInterviewEngine } from '../../../modules/interview';
import { useWidgetPause } from '../useWidgetPause';
import type { InterviewQuestion, InterviewState } from '../../../modules/interview/InterviewEngine';
import { MessageCircleQuestion, WifiOff, AlertCircle, RefreshCw, Sparkles, Mic, RotateCcw, History } from 'lucide-react';

export function QuestionWidget({ nodeId }: { nodeId: string }) {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [engineState, setEngineState] = useState<InterviewState>('idle');
  const [pendingCount, setPendingCount] = useState(0);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const streamingTextRef = useRef<string | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  const { isPaused, PauseButton, PauseOverlay } = useWidgetPause(nodeId, 'Questions');

  // Load existing state on mount
  useEffect(() => {
    const engine = getInterviewEngine();
    setQuestions(engine.getHistory());
    setEngineState(engine.getState());
    setPendingCount(engine.getPendingCount());
  }, []);

  // Subscribe to interview events
  useEffect(() => {
    if (isPaused) return;

    const unsubQuestion = eventBus.on('interview:question', (payload) => {
      const finalText = payload.response?.trim() || '';
      const streamedText = streamingTextRef.current?.trim() || '';
      const responseText = finalText || streamedText;

      if (responseText) {
        // Dedup: don't add if last entry has the same response text
        setQuestions(qs => {
          const last = qs[qs.length - 1];
          if (last && last.response === responseText) return qs;
          return [...qs, { ...payload, response: responseText }];
        });
      }

      setStreamingText(null);
      streamingTextRef.current = null;
      setPendingCount(getInterviewEngine().getPendingCount());
    });

    const unsubState = eventBus.on('interview:state', (payload) => {
      setEngineState(payload.state);
      setPendingCount(getInterviewEngine().getPendingCount());
    });

    const unsubStream = eventBus.on('interview:stream', (payload) => {
      setStreamingText(payload.text);
      streamingTextRef.current = payload.text;
    });

    return () => {
      unsubQuestion();
      unsubState();
      unsubStream();
    };
  }, [isPaused]);

  // Auto-scroll history when new question arrives
  useEffect(() => {
    if (historyRef.current && questions.length > 1) {
      historyRef.current.scrollTop = 0;
    }
  }, [questions.length]);

  const handleRetry = useCallback(() => {
    getInterviewEngine().retry();
  }, []);

  const handleNewSession = useCallback(() => {
    getInterviewEngine().resetSession();
    setQuestions([]);
    setPendingCount(0);
  }, []);

  const handleRestartWithContext = useCallback(() => {
    setQuestions([]);
    setPendingCount(0);
    getInterviewEngine().resetSession({ withContext: true });
  }, []);

  const latest = questions.length > 0 ? questions[questions.length - 1] : null;
  const history = questions.length > 1 ? questions.slice(0, -1).reverse() : [];
  const showRetry = engineState !== 'sending' && pendingCount > 0;

  // ── Action button components ─────────────────────────────────────

  const NewSessionButton = () => (
    <button
      onClick={handleNewSession}
      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-slate-100 hover:bg-slate-200/80 text-slate-500 rounded-full transition-all duration-200"
      title="Start a blank ChatGPT conversation"
    >
      <RotateCcw size={10} />
      <span>New</span>
    </button>
  );

  const RestartWithContextButton = () => (
    <button
      onClick={handleRestartWithContext}
      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 rounded-full transition-all duration-200"
      title="New session with recent conversations as context"
    >
      <History size={10} />
      <span>Restart</span>
    </button>
  );

  const RetryButton = () => showRetry ? (
    <button
      onClick={handleRetry}
      className="flex items-center gap-1 px-2 py-1 text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 rounded-full transition-all duration-200"
      title={`${pendingCount} unsent — click to retry`}
    >
      <RefreshCw size={10} />
      <span>{pendingCount} unsent</span>
    </button>
  ) : null;

  // ── No-transport state ────────────────────────────────────────────

  if (engineState === 'no-transport' && !latest) {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center p-6"
        data-doc='{"icon":"mdi:help-circle","title":"Interview","desc":"Intelligent interview questions powered by AI. Requires Chrome extension (ChatGPT) or direct LLM API key."}'
      >
        <PauseOverlay />
        <div className="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
          <WifiOff className="w-5 h-5 text-slate-400" />
        </div>
        <span className="text-[12px] font-semibold text-slate-500">No AI transport</span>
        <span className="text-[10px] text-slate-400 text-center mt-1 max-w-[200px] leading-relaxed">
          Install the Chrome extension or add an LLM API key in settings
        </span>
        <div className="flex items-center gap-2 mt-4">
          <PauseButton />
          <RetryButton />
          <RestartWithContextButton />
          <NewSessionButton />
        </div>
      </div>
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────

  if (!latest && !streamingText) {
    return (
      <div
        className="w-full h-full relative flex flex-col items-center justify-center p-6"
        data-doc='{"icon":"mdi:help-circle","title":"Interview","desc":"Intelligent interview questions powered by AI. Start speaking and questions will appear."}'
      >
        <PauseOverlay />
        {engineState === 'sending' ? (
          <>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500/10 to-blue-500/10 flex items-center justify-center mb-3">
              <Sparkles className="w-5 h-5 text-violet-500 animate-pulse" />
            </div>
            <span className="text-[12px] font-semibold text-violet-600">Thinking...</span>
            {pendingCount > 1 && (
              <span className="text-[10px] text-slate-400 mt-1">{pendingCount} messages queued</span>
            )}
          </>
        ) : engineState === 'error' ? (
          <>
            <div className="w-10 h-10 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
            <span className="text-[12px] font-semibold text-red-500">Couldn't reach AI</span>
            <span className="text-[10px] text-slate-400 mt-1">Tap retry to try again</span>
          </>
        ) : (
          <>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center mb-3">
              <Mic className="w-5 h-5 text-slate-300" />
            </div>
            <span className="text-[12px] font-semibold text-slate-500">
              {isPaused ? 'Paused' : 'Start speaking'}
            </span>
            <span className="text-[10px] text-slate-400 mt-1 max-w-[180px] text-center leading-relaxed">
              {isPaused ? 'Resume to continue the interview' : 'AI will ask you follow-up questions'}
            </span>
          </>
        )}
        <div className="flex items-center gap-2 mt-4">
          <PauseButton />
          <RetryButton />
          <RestartWithContextButton />
          <NewSessionButton />
        </div>
      </div>
    );
  }

  // ── Main view ───────────────────────────────────────────────────────

  return (
    <div
      className="w-full h-full relative flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:help-circle","title":"Interview","desc":"AI asks intelligent follow-up questions based on what you say. Questions adapt to the conversation depth and topic."}'
    >
      <PauseOverlay />

      {/* Latest question or streaming response — hero card */}
      <div className="flex-shrink-0 p-3">
        <div className="relative rounded-xl bg-gradient-to-br from-violet-500/[0.06] to-blue-500/[0.04] border border-violet-200/30 p-4">
          {/* Accent line */}
          <div className="absolute top-0 left-4 right-4 h-[2px] rounded-full bg-gradient-to-r from-violet-400/60 via-blue-400/40 to-transparent" />

          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              {streamingText ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                  </span>
                  <span className="text-[10px] font-medium text-violet-500">Streaming...</span>
                </>
              ) : engineState === 'sending' ? (
                <>
                  <Sparkles size={13} className="text-violet-500 animate-pulse" />
                  <span className="text-[10px] font-medium text-violet-500">Thinking...</span>
                </>
              ) : (
                <>
                  <MessageCircleQuestion size={13} className="text-violet-400/70" />
                  <span className="text-[10px] font-medium text-slate-400">
                    Q{questions.length}
                  </span>
                  <span className="text-[9px] text-slate-300">
                    {latest && formatTime(latest.timestamp)}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <RetryButton />
              <RestartWithContextButton />
              <NewSessionButton />
              <PauseButton />
            </div>
          </div>

          {/* Intent chip */}
          {latest?.intent && latest.intent !== 'ASSERT' && (
            <span className={`inline-block mb-2 px-2 py-0.5 text-[9px] font-semibold rounded-full uppercase tracking-wide ${intentChipClass(latest.intent)}`}>
              {latest.intent}
            </span>
          )}

          {/* Response text or streaming text */}
          <p className="text-[14px] leading-[1.6] text-slate-700 font-medium">
            {streamingText || latest?.response}
          </p>
        </div>
      </div>

      {/* History — timeline style */}
      {history.length > 0 && (
        <div ref={historyRef} className="flex-1 overflow-auto px-3 pb-2">
          <div className="relative pl-4">
            {/* Timeline line */}
            <div className="absolute left-[7px] top-1 bottom-1 w-[1.5px] bg-gradient-to-b from-slate-200 to-transparent" />

            {history.map((q, i) => (
              <div key={q.timestamp} className="relative mb-2 last:mb-0">
                {/* Timeline dot */}
                <div className="absolute -left-4 top-[7px] w-[7px] h-[7px] rounded-full bg-slate-200 border-2 border-white" />

                <div className="rounded-lg bg-slate-50/80 hover:bg-slate-100/80 transition-colors duration-150 px-3 py-2">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[9px] font-semibold text-slate-300">
                      {questions.length - 1 - i}
                    </span>
                    {q.intent && q.intent !== 'ASSERT' && (
                      <span className={`px-1.5 py-px text-[8px] font-semibold rounded-full uppercase tracking-wide ${intentChipClass(q.intent)}`}>
                        {q.intent}
                      </span>
                    )}
                    {q.topic && (
                      <span className="text-[9px] text-slate-300">{q.topic}</span>
                    )}
                    <span className="text-[9px] text-slate-300 ml-auto">
                      {formatTime(q.timestamp)}
                    </span>
                  </div>
                  <p className="text-[12px] text-slate-500 leading-relaxed">
                    {q.response}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error bar at bottom */}
      {engineState === 'error' && (
        <div className="flex-shrink-0 mx-3 mb-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <AlertCircle size={12} className="text-red-400" />
            <span className="text-[10px] text-red-500 font-medium">
              Failed to reach AI{pendingCount > 0 && ` · ${pendingCount} unsent`}
            </span>
          </div>
          <button
            onClick={handleRetry}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-red-100 hover:bg-red-200/80 text-red-600 rounded-full transition-all duration-200"
          >
            <RefreshCw size={10} />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function intentChipClass(intent: string): string {
  switch (intent) {
    case 'QUERY':   return 'bg-blue-500/10 text-blue-600';
    case 'CORRECT': return 'bg-amber-500/10 text-amber-600';
    case 'EXPLORE': return 'bg-violet-500/10 text-violet-600';
    case 'COMMAND': return 'bg-emerald-500/10 text-emerald-600';
    case 'SOCIAL':  return 'bg-slate-100 text-slate-400';
    default:        return 'bg-slate-100 text-slate-400';
  }
}
