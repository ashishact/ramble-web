/**
 * Meeting Transcription Widget
 *
 * Live meeting intelligence HUD.
 *
 * File responsibilities:
 *   Widget.tsx        — orchestration, state, event wiring, layout
 *   process.ts        — LLM state machine, types, storage
 *   SettingsPanel.tsx — user name + meeting context settings
 *   MeetingDetailView.tsx — archived meeting detail view
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import { Radio, RefreshCw, Clock, ChevronLeft, Plus, Settings } from 'lucide-react';
import { eventBus } from '../../../lib/eventBus';
import { useWidgetPause } from '../useWidgetPause';
import {
  processMeetingUpdate,
  loadMeetingState,
  loadArchivedMeetings,
  loadMeetingSettings,
  archiveCurrentMeeting,
  createInitialMeetingState,
  saveMeetingState,
  NEW_MEETING_GAP_MS,
  MIN_ACCUMULATED_CHARS,
  STALE_TEXT_TIMEOUT_MS,
  type MeetingState,
  type ArchivedMeeting,
  type FeedEntry,
  type SentimentLevel,
  type MeetingSettings,
  type ActionItem,
  type OverviewItem,
} from './process';
import { SettingsPanel } from './SettingsPanel';
import { MeetingDetailView } from './MeetingDetailView';

// ============================================================================
// Helpers
// ============================================================================

import { FeedEntryRow, formatShortDate, formatDurationBetween } from './shared';

function formatLiveDuration(startedAt: number): string {
  const ms = Date.now() - startedAt;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTalkPct(micMs: number, systemMs: number): string {
  const total = micMs + systemMs;
  if (total === 0) return '';
  return `you ${Math.round((micMs / total) * 100)}%`;
}

// ============================================================================
// Sentiment config
// ============================================================================

const SENTIMENT_CONFIG: Record<SentimentLevel, { label: string; icon: string; className: string }> = {
  neutral:  { label: 'Neutral',  icon: 'mdi:emoticon-neutral-outline',  className: 'text-base-content/30' },
  positive: { label: 'Positive', icon: 'mdi:emoticon-happy-outline',    className: 'text-emerald-500/70' },
  tense:    { label: 'Tense',    icon: 'mdi:emoticon-confused-outline', className: 'text-amber-500/80' },
  negative: { label: 'Negative', icon: 'mdi:emoticon-angry-outline',    className: 'text-red-500/70' },
};

// ============================================================================
// Sub-components
// ============================================================================

function OverviewPanel({ items }: { items: OverviewItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(-3);

  return (
    <div className="bg-blue-400/[0.06] rounded-xl px-3 py-2 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon icon="mdi:flag-outline" width={12} height={12} className="text-blue-500/70" />
        <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">Overview</span>
        {items.length > 3 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto text-[8px] text-base-content/30 hover:text-base-content/60 transition-colors"
          >
            {expanded ? 'less' : `+${items.length - 3} more`}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-[9px] text-base-content/20 italic">Waiting for key moments...</p>
      ) : (
        <ol className="space-y-0.5 list-none">
          {visible.map((item, i) => {
            const idx = expanded ? i : items.length - visible.length + i;
            return (
              <li key={idx} className="flex items-start gap-1.5">
                <span className="text-[8px] text-blue-500/40 font-mono flex-shrink-0 mt-[1px]">
                  {idx + 1}.
                </span>
                <span className="text-[10px] text-base-content/60 leading-relaxed">{item.text}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function TopicPanel({
  text, icon, topicStartedAt,
}: { text: string; icon: string; topicStartedAt: number }) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!topicStartedAt) return;
    const tick = () => setElapsed(formatElapsed(Date.now() - topicStartedAt));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [topicStartedAt]);

  const resolvedIcon = icon && icon.includes(':') ? icon : 'mdi:comment-multiple-outline';

  return (
    <div className="bg-violet-400/[0.06] rounded-xl px-3 py-2 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon icon={resolvedIcon} width={13} height={13} className="text-violet-500/70" />
        <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">Topic</span>
        {elapsed && (
          <span className="ml-auto text-[8px] text-base-content/25 tabular-nums">{elapsed}</span>
        )}
      </div>
      {text ? (
        <p className="text-[11px] text-base-content/70 leading-relaxed">{text}</p>
      ) : (
        <p className="text-[9px] text-base-content/20 italic">Waiting...</p>
      )}
    </div>
  );
}

function NowPanel({ text, icon }: { text: string; icon: string }) {
  const resolvedIcon = icon && icon.includes(':') ? icon : 'mdi:lightning-bolt-outline';
  return (
    <div className="bg-amber-400/[0.06] rounded-xl px-3 py-2 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon icon={resolvedIcon} width={14} height={14} className="text-amber-500/70" />
        <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">Now</span>
        {text && (
          <span className="relative flex-shrink-0 w-[7px] h-[7px] ml-0.5">
            <span className="absolute inset-0 rounded-full bg-amber-400/50 animate-ping" />
            <span className="absolute inset-[1px] rounded-full bg-amber-400" />
          </span>
        )}
      </div>
      {text ? (
        <p className="text-[11px] text-base-content/80 leading-relaxed">{text}</p>
      ) : (
        <p className="text-[9px] text-base-content/20 italic">Waiting...</p>
      )}
    </div>
  );
}

function ActionItemsList({
  items,
  onToggle,
}: {
  items: ActionItem[];
  onToggle: (id: string) => void;
}) {
  const open = items.filter((a) => !a.done);
  const done = items.filter((a) => a.done);
  if (items.length === 0) return null;

  return (
    <div className="bg-emerald-400/[0.06] border border-emerald-400/15 rounded-xl px-3 py-2 space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon icon="mdi:checkbox-marked-circle-outline" width={13} height={13} className="text-emerald-500/70" />
        <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">Action Items</span>
        {open.length > 0 && (
          <span className="ml-auto text-[8px] bg-emerald-400/20 text-emerald-600/70 px-1.5 py-0.5 rounded-full">
            {open.length}
          </span>
        )}
      </div>
      <div className="space-y-1">
        {open.map((item, idx) => (
          <button
            key={item.id}
            onClick={() => onToggle(item.id)}
            className={`w-full flex items-start gap-1.5 text-left group ${idx === open.length - 1 ? 'opacity-100' : 'opacity-70'}`}
          >
            <span className="w-1.5 h-1.5 rounded-full border border-emerald-400/60 flex-shrink-0 mt-[4px] group-hover:bg-emerald-400/40 transition-colors" />
            <div className="min-w-0">
              <span className="text-[10px] text-base-content/75">{item.text}</span>
              {(item.owner || item.deadline) && (
                <span className="text-[8px] text-base-content/35 ml-1">
                  {item.owner && `[${item.owner}]`}{item.deadline && ` — ${item.deadline}`}
                </span>
              )}
            </div>
          </button>
        ))}
        {done.map((item) => (
          <button
            key={item.id}
            onClick={() => onToggle(item.id)}
            className="w-full flex items-start gap-1.5 text-left opacity-35"
          >
            <Icon icon="mdi:check-circle" width={10} height={10} className="text-emerald-500 flex-shrink-0 mt-[2px]" />
            <span className="text-[10px] text-base-content/50 line-through">{item.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ArchivedMeetingRow({ meeting, onSelect }: { meeting: ArchivedMeeting; onSelect: () => void }) {
  const preview = meeting.overviewItems.length > 0
    ? meeting.overviewItems[meeting.overviewItems.length - 1].text
    : meeting.summaryTree.topic.text || '(no summary)';

  return (
    <button
      onClick={onSelect}
      className="w-full text-left px-2 py-2 hover:bg-base-200/40 rounded-lg transition-colors border border-transparent hover:border-base-200"
    >
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <span className="text-[11px] font-medium text-base-content/80">
          {formatShortDate(meeting.startedAt)}
        </span>
        <div className="flex items-center gap-1.5 text-[9px] text-base-content/40 flex-shrink-0">
          <Clock size={9} />
          <span>{formatDurationBetween(meeting.startedAt, meeting.endedAt)}</span>
          <span>·</span>
          <span>{meeting.segmentCount} seg</span>
        </div>
      </div>
      <p className="text-[10px] text-base-content/50 leading-relaxed line-clamp-2">{preview}</p>
    </button>
  );
}

// ============================================================================
// Widget
// ============================================================================

type View = 'live' | 'archive-list' | 'archive-detail' | 'settings';

export function MeetingTranscriptionWidget() {
  const [meetingState, setMeetingState] = useState<MeetingState>(() =>
    loadMeetingState() ?? createInitialMeetingState()
  );
  const [archivedMeetings, setArchivedMeetings] = useState<ArchivedMeeting[]>(() =>
    loadArchivedMeetings()
  );
  const [settings, setSettings] = useState<MeetingSettings>(() => loadMeetingSettings());
  const [view, setView] = useState<View>('live');
  const [selectedArchiveMeeting, setSelectedArchiveMeeting] = useState<ArchivedMeeting | null>(null);
  const [isLLMRunning, setIsLLMRunning] = useState(false);
  const [durationDisplay, setDurationDisplay] = useState('');
  const [nativeMode, setNativeMode] = useState<'meeting' | 'solo' | null>(null);
  // Track when current topic text last changed (for elapsed timer)
  const [topicStartedAt, setTopicStartedAt] = useState(0);
  const prevTopicTextRef = useRef('');

  const stateRef = useRef<MeetingState>(meetingState);
  stateRef.current = meetingState;

  const settingsRef = useRef<MeetingSettings>(settings);
  settingsRef.current = settings;

  const pendingTextRef = useRef('');
  const latestAudioTypeRef = useRef<'mic' | 'system'>('mic');
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLLMRunningRef = useRef(false);

  const { isPaused, PauseButton } = useWidgetPause('meeting-transcription', 'Meeting');
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const feedBottomRef = useRef<HTMLDivElement>(null);

  // Track topic change time
  useEffect(() => {
    const topicText = meetingState.summaryTree.topic.text;
    if (topicText && topicText !== prevTopicTextRef.current) {
      prevTopicTextRef.current = topicText;
      setTopicStartedAt(Date.now());
    }
  }, [meetingState.summaryTree.topic.text]);

  // -------------------------------------------------------------------------
  // Core LLM trigger
  // -------------------------------------------------------------------------
  const triggerLLM = useCallback(async (forceImmediate = false) => {
    if (isLLMRunningRef.current) return;
    const pendingText = pendingTextRef.current;
    if (pendingText.length === 0) return;
    if (!forceImmediate && pendingText.length < MIN_ACCUMULATED_CHARS) return;

    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }

    pendingTextRef.current = '';
    const audioType = latestAudioTypeRef.current;

    isLLMRunningRef.current = true;
    setIsLLMRunning(true);
    try {
      const { state: newState, llmRan } = await processMeetingUpdate(
        stateRef.current,
        pendingText,
        audioType,
        settingsRef.current,
        forceImmediate
      );
      if (llmRan) {
        const merged: MeetingState = {
          ...newState,
          displayFeed: stateRef.current.displayFeed,
          segmentCount: stateRef.current.segmentCount,
          talkTime: stateRef.current.talkTime,
        };
        stateRef.current = merged;
        setMeetingState(merged);
      }
    } catch {
      // process.ts handles and logs errors internally
    } finally {
      isLLMRunningRef.current = false;
      setIsLLMRunning(false);
    }
  }, []);

  // -------------------------------------------------------------------------
  // Handle a new transcription segment
  // -------------------------------------------------------------------------
  const handleTranscription = useCallback(
    (
      text: string,
      audioType: 'mic' | 'system',
      segmentStartMs?: number,
      speechDurationMs?: number
    ) => {
      if (isPausedRef.current) return;

      const now = Date.now();
      const newEntry: FeedEntry = {
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        audioType,
        ts: segmentStartMs ?? now,
      };

      const currentState = stateRef.current;

      // Update talk time when duration is available
      const updatedTalkTime = speechDurationMs && speechDurationMs > 0
        ? {
            micMs: currentState.talkTime.micMs + (audioType === 'mic' ? speechDurationMs : 0),
            systemMs: currentState.talkTime.systemMs + (audioType === 'system' ? speechDurationMs : 0),
          }
        : currentState.talkTime;

      const updatedFeed = [...currentState.displayFeed, newEntry];
      if (updatedFeed.length > 60) updatedFeed.splice(0, updatedFeed.length - 60);

      const updated: MeetingState = {
        ...currentState,
        displayFeed: updatedFeed,
        segmentCount: currentState.segmentCount + 1,
        talkTime: updatedTalkTime,
        lastUpdatedAt: now,
      };
      stateRef.current = updated;
      setMeetingState(updated);

      pendingTextRef.current = pendingTextRef.current
        ? `${pendingTextRef.current} ${text}`
        : text;
      latestAudioTypeRef.current = audioType;

      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
      staleTimerRef.current = setTimeout(() => {
        staleTimerRef.current = null;
        triggerLLM(true);
      }, STALE_TEXT_TIMEOUT_MS);

      if (pendingTextRef.current.length >= MIN_ACCUMULATED_CHARS) {
        triggerLLM();
      }
    },
    [triggerLLM]
  );

  // -------------------------------------------------------------------------
  // Recording lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    const unsubStart = eventBus.on('native:recording-started', () => {
      const state = stateRef.current;
      const now = Date.now();
      const gapSinceLastSegment = now - state.lastUpdatedAt;
      const isNewMeeting = state.segmentCount > 0 && gapSinceLastSegment >= NEW_MEETING_GAP_MS;

      if (isNewMeeting) {
        const updatedArchive = archiveCurrentMeeting(state);
        setArchivedMeetings(updatedArchive);
        pendingTextRef.current = '';
        if (staleTimerRef.current) { clearTimeout(staleTimerRef.current); staleTimerRef.current = null; }
        const fresh = createInitialMeetingState();
        saveMeetingState(fresh);
        setMeetingState(fresh);
        stateRef.current = fresh;
      }
    });

    const flushOnEnd = (label: string) => {
      if (isPausedRef.current) return;
      const state = stateRef.current;
      if (state.segmentCount === 0) return;

      if (pendingTextRef.current.length > 0) {
        console.log(`[MeetingTranscription] ${label} — flushing pending text`);
        triggerLLM(true);
      } else if (state.lastUpdatedAt > state.lastLLMCallAt) {
        const latest = state.displayFeed[state.displayFeed.length - 1];
        if (latest) {
          pendingTextRef.current = latest.text;
          latestAudioTypeRef.current = latest.audioType;
          triggerLLM(true);
        }
      }
    };

    const unsubEnd = eventBus.on('native:recording-ended', () => flushOnEnd('Recording ended'));
    const unsubCancelled = eventBus.on('native:recording-cancelled', () => flushOnEnd('Recording cancelled'));

    return () => { unsubStart(); unsubEnd(); unsubCancelled(); };
  }, [triggerLLM]);

  // -------------------------------------------------------------------------
  // Subscribe to transcription events (intermediate only — final is a duplicate)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (isPaused) return;

    const unsubIntermediate = eventBus.on('native:transcription-intermediate', (payload) => {
      const speechDurationMs =
        payload.speechStartMs && payload.speechEndMs && payload.speechEndMs > payload.speechStartMs
          ? payload.speechEndMs - payload.speechStartMs
          : undefined;
      handleTranscription(
        payload.text,
        payload.audioType,
        payload.speechStartMs ?? payload.ts,
        speechDurationMs
      );
    });

    return () => { unsubIntermediate(); };
  }, [isPaused, handleTranscription]);

  // -------------------------------------------------------------------------
  // Native mode
  // -------------------------------------------------------------------------
  useEffect(() => {
    const unsub = eventBus.on('native:mode-changed', (payload) => setNativeMode(payload.mode));
    return unsub;
  }, []);

  // -------------------------------------------------------------------------
  // Live duration ticker + auto-scroll
  // -------------------------------------------------------------------------
  useEffect(() => {
    const timer = setInterval(() => {
      setDurationDisplay(formatLiveDuration(stateRef.current.startedAt));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    feedBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [meetingState.displayFeed.length]);

  useEffect(() => {
    return () => { if (staleTimerRef.current) clearTimeout(staleTimerRef.current); };
  }, []);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const handleNewMeeting = useCallback(() => {
    const state = stateRef.current;
    if (state.segmentCount > 0) setArchivedMeetings(archiveCurrentMeeting(state));
    pendingTextRef.current = '';
    if (staleTimerRef.current) { clearTimeout(staleTimerRef.current); staleTimerRef.current = null; }
    const fresh = createInitialMeetingState();
    saveMeetingState(fresh);
    setMeetingState(fresh);
    stateRef.current = fresh;
  }, []);

  const handleRefresh = useCallback(async () => {
    if (isLLMRunningRef.current) return;
    if (pendingTextRef.current.length > 0) { await triggerLLM(true); return; }
    const state = stateRef.current;
    if (state.displayFeed.length === 0) return;
    const lastEntries = state.displayFeed.slice(-3);
    pendingTextRef.current = lastEntries.map((e) => e.text).join(' ');
    latestAudioTypeRef.current = lastEntries[lastEntries.length - 1].audioType;
    await triggerLLM(true);
  }, [triggerLLM]);

  const handleToggleActionItem = useCallback((id: string) => {
    const state = stateRef.current;
    const updated: MeetingState = {
      ...state,
      actionItems: state.actionItems.map((a) => a.id === id ? { ...a, done: !a.done } : a),
    };
    stateRef.current = updated;
    setMeetingState(updated);
    saveMeetingState(updated);
  }, []);

  // -------------------------------------------------------------------------
  // Routing
  // -------------------------------------------------------------------------
  if (view === 'settings') {
    return (
      <SettingsPanel
        initialSettings={settings}
        onClose={(saved) => { setSettings(saved); settingsRef.current = saved; setView('live'); }}
      />
    );
  }

  if (view === 'archive-detail' && selectedArchiveMeeting) {
    return (
      <MeetingDetailView
        meeting={selectedArchiveMeeting}
        onBack={() => setView('archive-list')}
      />
    );
  }

  if (view === 'archive-list') {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden text-base-content">
        <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center gap-2">
          <button onClick={() => setView('live')} className="p-1 hover:bg-base-200 rounded transition-colors">
            <ChevronLeft size={14} className="text-base-content/60" />
          </button>
          <span className="text-[11px] font-medium text-base-content/70">Past Meetings</span>
          <span className="text-[10px] text-base-content/30 ml-auto">{archivedMeetings.length} saved</span>
        </div>
        <div className="flex-1 overflow-auto px-1 py-1">
          {archivedMeetings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-1 text-base-content/30">
              <Clock size={20} className="opacity-40" />
              <span className="text-[11px]">No past meetings yet</span>
              <span className="text-[9px] opacity-60">Archived when a new meeting starts</span>
            </div>
          ) : (
            <div className="space-y-1">
              {archivedMeetings.map((meeting) => (
                <ArchivedMeetingRow
                  key={meeting.id}
                  meeting={meeting}
                  onSelect={() => { setSelectedArchiveMeeting(meeting); setView('archive-detail'); }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: empty / waiting state
  // -------------------------------------------------------------------------
  const hasContent = meetingState.displayFeed.length > 0 || meetingState.overviewItems.length > 0;

  if (!hasContent) {
    const hasSettings = settings.userName || settings.meetingContext;
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-2 px-4"
        data-doc='{"icon":"mdi:radio-tower","title":"Meeting","desc":"Live meeting intelligence HUD. Speak or play audio to start."}'
      >
        {/* Icon */}
        <div className="relative">
          <div className="w-10 h-10 rounded-2xl bg-violet-500/10 flex items-center justify-center">
            <Radio size={20} className="text-violet-500/60" />
          </div>
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-violet-400/40 animate-ping" />
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-violet-400/70" />
        </div>

        <span className="text-[12px] font-semibold text-base-content/70">Waiting for audio...</span>
        <span className="text-[9px] text-base-content/35">Speak or play audio to begin</span>

        {/* Context card */}
        <button
          onClick={() => setView('settings')}
          className="w-full max-w-[210px] mt-1 px-3 py-2.5 rounded-2xl bg-indigo-500/[0.07] border border-indigo-400/20 hover:bg-indigo-500/[0.12] hover:border-indigo-400/35 transition-colors text-left space-y-1.5"
        >
          {/* Header row */}
          <div className="flex items-center justify-between">
            <span className="text-[8px] font-bold uppercase tracking-widest text-indigo-500/50">
              Meeting Setup
            </span>
            <Icon icon="mdi:pencil-outline" width={9} height={9} className="text-indigo-400/40" />
          </div>

          {hasSettings ? (
            <>
              {settings.userName && (
                <div className="flex items-center gap-1.5">
                  <Icon icon="mdi:account-circle-outline" width={11} height={11} className="text-indigo-400/60 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-indigo-300/80 truncate">{settings.userName}</span>
                </div>
              )}
              {settings.meetingContext ? (
                <div className="flex items-start gap-1.5">
                  <Icon icon="mdi:text-box-outline" width={11} height={11} className="text-indigo-400/50 flex-shrink-0 mt-[1px]" />
                  <span className="text-[9px] text-base-content/55 leading-relaxed line-clamp-2">{settings.meetingContext}</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5">
                  <Icon icon="mdi:text-box-outline" width={11} height={11} className="text-amber-400/50 flex-shrink-0" />
                  <span className="text-[9px] text-amber-500/60 italic">No context — tap to add</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-1.5">
              <Icon icon="mdi:account-plus-outline" width={11} height={11} className="text-indigo-400/50 flex-shrink-0" />
              <span className="text-[9px] text-indigo-400/60 italic">Set your name &amp; context</span>
            </div>
          )}
        </button>

        <div className="flex items-center gap-2 mt-0.5">
          <PauseButton />
          {archivedMeetings.length > 0 && (
            <button onClick={() => setView('archive-list')} className="flex items-center gap-1 text-[10px] text-base-content/40 hover:text-base-content/60 transition-colors">
              <Clock size={10} />
              {archivedMeetings.length} past
            </button>
          )}
          <button onClick={handleNewMeeting} className="flex items-center gap-1 text-[10px] text-base-content/40 hover:text-base-content/60 transition-colors">
            <Plus size={10} />
            New
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: live meeting HUD
  // -------------------------------------------------------------------------
  const { summaryTree: tree, talkTime } = meetingState;
  const sentiment = SENTIMENT_CONFIG[meetingState.sentiment];
  const talkPct = formatTalkPct(talkTime.micMs, talkTime.systemMs);

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden text-base-content"
      data-doc='{"icon":"mdi:radio-tower","title":"Meeting","desc":"Live meeting intelligence HUD with overview log, action items, and transcript."}'
    >
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <Radio size={12} className="text-base-content/40 flex-shrink-0" />
          {isLLMRunning ? (
            <>
              <span className="loading loading-spinner loading-xs text-primary" />
              <span className="text-[11px] font-medium text-primary">Analyzing...</span>
            </>
          ) : (
            <span className="text-[11px] font-medium text-base-content/60 truncate">Meeting</span>
          )}
          {nativeMode === 'meeting' && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-400/15 border border-violet-400/25 flex-shrink-0">
              <Icon icon="mdi:account-group" width={10} height={10} className="text-violet-500/80" />
              <span className="text-[8px] font-semibold text-violet-500/80 tracking-wide">Group</span>
            </span>
          )}
          {nativeMode === 'solo' && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-400/15 border border-blue-400/25 flex-shrink-0">
              <Icon icon="mdi:account" width={10} height={10} className="text-blue-500/80" />
              <span className="text-[8px] font-semibold text-blue-500/80 tracking-wide">Solo</span>
            </span>
          )}
          {/* Sentiment indicator — only show non-neutral */}
          {meetingState.sentiment !== 'neutral' && (
            <span title={sentiment.label}>
              <Icon icon={sentiment.icon} width={13} height={13} className={sentiment.className} />
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {archivedMeetings.length > 0 && (
            <button onClick={() => setView('archive-list')} className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-base-content/40 hover:text-base-content/70 hover:bg-base-200 rounded transition-colors" title="Past meetings">
              <Clock size={9} />
              {archivedMeetings.length}
            </button>
          )}
          <button onClick={handleNewMeeting} className="p-1 hover:bg-base-200 rounded transition-colors" title="New meeting">
            <Plus size={12} className="text-base-content/40" />
          </button>
          <PauseButton />
          <button onClick={() => setView('settings')} className="p-1 hover:bg-base-200 rounded transition-colors" title="Settings">
            <Settings size={12} className="text-base-content/40" />
          </button>
          <button onClick={handleRefresh} disabled={isLLMRunning} className="p-1 hover:bg-base-200 rounded transition-colors disabled:opacity-30" title="Force update">
            <RefreshCw size={12} className="text-base-content/40" />
          </button>
        </div>
      </div>

      {/* ── Intelligence section ── */}
      <div className="flex-shrink-0 overflow-auto px-2 pt-2 pb-1 space-y-1.5 max-h-[60%]">
        <OverviewPanel items={meetingState.overviewItems} />
        <TopicPanel
          text={tree.topic.text}
          icon={tree.topic.icon}
          topicStartedAt={topicStartedAt}
        />
        <NowPanel text={tree.now.text} icon={tree.now.icon} />
        <ActionItemsList items={meetingState.actionItems} onToggle={handleToggleActionItem} />

        {/* Participants */}
        {meetingState.participants.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {meetingState.participants.map((p) => (
              <span
                key={p.name}
                className={`text-[9px] px-2 py-0.5 rounded-full border ${
                  p.audioType === 'mic'
                    ? 'bg-blue-400/10 border-blue-400/20 text-blue-500/70'
                    : 'bg-purple-400/10 border-purple-400/20 text-purple-500/70'
                }`}
              >
                {p.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Live Feed ── */}
      <div className="flex-1 overflow-auto px-2 pb-1 border-t border-base-200/50 pt-1">
        <div className="text-[8px] uppercase tracking-widest text-base-content/30 mb-1 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400/70 animate-pulse inline-block" />
          Live
        </div>
        <div className="space-y-0">
          {meetingState.displayFeed.map((entry) => (
            <FeedEntryRow key={entry.id} entry={entry} />
          ))}
          <div ref={feedBottomRef} />
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex-shrink-0 px-2 py-1 border-t border-base-200/40 flex items-center justify-between text-[9px] text-base-content/30">
        <span>{durationDisplay}</span>
        <div className="flex items-center gap-2">
          {talkPct && <span>{talkPct}</span>}
          <span>{meetingState.segmentCount} seg</span>
          {meetingState.llmDurationMs > 0 && (
            <>
              <span>·</span>
              <span>{(meetingState.llmDurationMs / 1000).toFixed(1)}s</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
