/**
 * Meeting Transcription Widget
 *
 * Live meeting intelligence HUD: 3-level context tree (overview → topic → now)
 * + next-step coaching + raw transcription feed.
 *
 * Text accumulation:
 *   Segments accumulate in pendingTextRef. LLM fires when >= MIN_ACCUMULATED_CHARS
 *   or after STALE_TEXT_TIMEOUT_MS of silence. Prevents wasteful calls on short phrases.
 *
 * Recording lifecycle (via eventBus):
 *   native:recording-started    → gap >= 3 min ⇒ archive + fresh start
 *   native:recording-ended      → flush pending text as final LLM call
 *   native:recording-cancelled  → same flush (aborted recording still gets a summary)
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '@iconify/react';
import { Radio, RefreshCw, Clock, ChevronLeft, Plus } from 'lucide-react';
import { eventBus } from '../../../lib/eventBus';
import { useWidgetPause } from '../useWidgetPause';
import {
  processMeetingUpdate,
  loadMeetingState,
  loadArchivedMeetings,
  archiveCurrentMeeting,
  createInitialMeetingState,
  saveMeetingState,
  NEW_MEETING_GAP_MS,
  MIN_ACCUMULATED_CHARS,
  STALE_TEXT_TIMEOUT_MS,
  type MeetingState,
  type ArchivedMeeting,
  type FeedEntry,
  type SummaryLevel,
} from './process';

// ============================================================================
// Helpers
// ============================================================================

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatDurationBetween(startedAt: number, endedAt: number): string {
  const ms = endedAt - startedAt;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${totalSeconds}s`;
}

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

// ============================================================================
// Tree level visual config
// Hierarchy expressed through icon color + text weight/opacity — no borders, no indentation
// ============================================================================

const LEVEL_CONFIG = {
  overall: {
    label: 'Overview',
    defaultIcon: 'mdi:flag-outline',
    bgClass: 'bg-blue-400/[0.06]',
    iconClass: 'text-blue-500/70',
    labelClass: 'text-base-content/35',
    textClass: 'text-[10px] text-base-content/60',
    iconSize: 12,
    isLive: false,
  },
  topic: {
    label: 'Topic',
    defaultIcon: 'mdi:comment-multiple-outline',
    bgClass: 'bg-violet-400/[0.06]',
    iconClass: 'text-violet-500/70',
    labelClass: 'text-base-content/35',
    textClass: 'text-[11px] text-base-content/70',
    iconSize: 13,
    isLive: false,
  },
  now: {
    label: 'Now',
    defaultIcon: 'mdi:lightning-bolt-outline',
    bgClass: 'bg-amber-400/[0.06]',
    iconClass: 'text-amber-500/70',
    labelClass: 'text-base-content/35',
    textClass: 'text-[11px] text-base-content/80',
    iconSize: 14,
    isLive: true,
  },
} as const;

type LevelKey = keyof typeof LEVEL_CONFIG;

// ============================================================================
// Sub-components
// ============================================================================

function TreeNode({ levelKey, level }: { levelKey: LevelKey; level: SummaryLevel }) {
  const cfg = LEVEL_CONFIG[levelKey];
  const isEmpty = !level.text;
  const icon = level.icon && level.icon.includes(':') ? level.icon : cfg.defaultIcon;

  return (
    <div className={`${cfg.bgClass} rounded-xl px-3 py-2 space-y-1`}>
      {/* Label row */}
      <div className="flex items-center gap-1.5">
        <Icon icon={icon} width={cfg.iconSize} height={cfg.iconSize} className={cfg.iconClass} />
        <span className={`text-[8px] font-bold uppercase tracking-widest ${cfg.labelClass} flex-shrink-0`}>
          {cfg.label}
        </span>
        {cfg.isLive && !isEmpty && (
          <span className="relative flex-shrink-0 w-[7px] h-[7px]">
            <span className="absolute inset-0 rounded-full bg-amber-400/50 animate-ping" />
            <span className="absolute inset-[1px] rounded-full bg-amber-400" />
          </span>
        )}
      </div>

      {/* Content */}
      {isEmpty ? (
        <p className="text-[9px] text-base-content/20 italic">Waiting...</p>
      ) : (
        <p className={`${cfg.textClass} leading-relaxed`}>{level.text}</p>
      )}
    </div>
  );
}

const NEXT_STEP_FALLBACK_ICON = 'mdi:arrow-right-bold-circle-outline';

function NextStepCard({ text, icon }: { text: string; icon: string }) {
  const resolvedIcon = icon && icon.includes(':') ? icon : NEXT_STEP_FALLBACK_ICON;
  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 bg-emerald-400/[0.07] border border-emerald-400/25 rounded-xl">
      <Icon
        icon={resolvedIcon}
        width={16}
        height={16}
        className="text-emerald-500/80 flex-shrink-0 mt-0.5"
      />
      <div className="min-w-0">
        <span className="text-[8px] font-bold uppercase tracking-widest text-emerald-600/60 block mb-0.5">
          Next Step
        </span>
        <span className="text-[11px] font-medium text-base-content/80 leading-tight">{text}</span>
      </div>
    </div>
  );
}

function FeedEntryRow({ entry }: { entry: FeedEntry }) {
  const isMic = entry.audioType === 'mic';
  return (
    <div className="flex items-start gap-1.5 py-[3px]">
      <span className="text-[9px] text-base-content/25 font-mono flex-shrink-0 tabular-nums leading-[1.4]">
        {formatTime(entry.ts)}
      </span>
      <span className="flex items-center gap-[3px] flex-shrink-0 leading-[1.4]">
        <span
          className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${isMic ? 'bg-blue-400/70' : 'bg-purple-400/70'}`}
        />
        <span
          className={`text-[8px] font-semibold ${isMic ? 'text-blue-500/60' : 'text-purple-500/60'}`}
        >
          {isMic ? 'mic' : 'sys'}
        </span>
      </span>
      <span className="text-[10px] font-mono text-base-content/70 leading-[1.4] break-words min-w-0 flex-1">
        {entry.text}
      </span>
    </div>
  );
}

function ArchivedMeetingRow({
  meeting,
  isExpanded,
  onToggle,
}: {
  meeting: ArchivedMeeting;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
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
      {meeting.summary ? (
        <p
          className={`text-[10px] text-base-content/50 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}
        >
          {meeting.summary}
        </p>
      ) : (
        <p className="text-[10px] text-base-content/30 italic">No summary generated</p>
      )}
      {isExpanded && meeting.nextStep && (
        <div className="mt-1.5">
          <NextStepCard text={meeting.nextStep} icon="" />
        </div>
      )}
    </button>
  );
}

// ============================================================================
// Widget
// ============================================================================

export function MeetingTranscriptionWidget() {
  const [meetingState, setMeetingState] = useState<MeetingState>(() =>
    loadMeetingState() ?? createInitialMeetingState()
  );
  const [archivedMeetings, setArchivedMeetings] = useState<ArchivedMeeting[]>(() =>
    loadArchivedMeetings()
  );
  const [isLLMRunning, setIsLLMRunning] = useState(false);
  const [durationDisplay, setDurationDisplay] = useState('');
  const [showArchive, setShowArchive] = useState(false);
  const [expandedArchiveId, setExpandedArchiveId] = useState<string | null>(null);
  // null = native app hasn't reported a mode yet (connection not established or pre-first event)
  const [nativeMode, setNativeMode] = useState<'meeting' | 'solo' | null>(null);

  // Always-current ref so event callbacks always see the latest state
  const stateRef = useRef<MeetingState>(meetingState);
  stateRef.current = meetingState;

  // Text accumulation refs
  const pendingTextRef = useRef('');
  const latestAudioTypeRef = useRef<'mic' | 'system'>('mic');
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isLLMRunningRef = useRef(false);

  const { isPaused, PauseButton } = useWidgetPause('meeting-transcription', 'Meeting');
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;

  const feedBottomRef = useRef<HTMLDivElement>(null);

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
        forceImmediate
      );
      if (llmRan) {
        const merged: MeetingState = {
          ...newState,
          displayFeed: stateRef.current.displayFeed,
          segmentCount: stateRef.current.segmentCount,
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
    (text: string, audioType: 'mic' | 'system', segmentStartMs?: number) => {
      if (isPausedRef.current) return;

      const now = Date.now();
      const newEntry: FeedEntry = {
        id: `${now}-${Math.random().toString(36).slice(2, 7)}`,
        text,
        audioType,
        // Prefer the native-reported segment start time so entries are ordered
        // by when speech actually began, not by WebSocket message arrival time.
        ts: segmentStartMs ?? now,
      };

      const currentState = stateRef.current;
      const updatedFeed = [...currentState.displayFeed, newEntry];
      if (updatedFeed.length > 60) updatedFeed.splice(0, updatedFeed.length - 60);
      const updated: MeetingState = {
        ...currentState,
        displayFeed: updatedFeed,
        segmentCount: currentState.segmentCount + 1,
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
        console.log('[MeetingTranscription] New meeting detected — archiving previous session');
        const updatedArchive = archiveCurrentMeeting(state);
        setArchivedMeetings(updatedArchive);

        pendingTextRef.current = '';
        if (staleTimerRef.current) {
          clearTimeout(staleTimerRef.current);
          staleTimerRef.current = null;
        }

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
          console.log(`[MeetingTranscription] ${label} — re-triggering with last segment`);
          pendingTextRef.current = latest.text;
          latestAudioTypeRef.current = latest.audioType;
          triggerLLM(true);
        }
      }
    };

    const unsubEnd = eventBus.on('native:recording-ended', () => flushOnEnd('Recording ended'));
    const unsubCancelled = eventBus.on('native:recording-cancelled', () =>
      flushOnEnd('Recording cancelled')
    );

    return () => {
      unsubStart();
      unsubEnd();
      unsubCancelled();
    };
  }, [triggerLLM]);

  // -------------------------------------------------------------------------
  // Subscribe to transcription events (gated by isPaused)
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (isPaused) return;

    const unsubIntermediate = eventBus.on('native:transcription-intermediate', (payload) => {
      // speechStartMs = when VAD detected speech beginning (most accurate segment time)
      // fall back to ts (WebSocket message time) if native doesn't provide it
      handleTranscription(payload.text, payload.audioType, payload.speechStartMs ?? payload.ts);
    });

    const unsubFinal = eventBus.on('native:transcription-final', (payload) => {
      // Final events carry ts = native-assigned transcription timestamp
      handleTranscription(payload.text, payload.audioType, payload.ts);
    });

    return () => {
      unsubIntermediate();
      unsubFinal();
    };
  }, [isPaused, handleTranscription]);

  // Cleanup stale timer on unmount
  useEffect(() => {
    return () => {
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // New Meeting
  // -------------------------------------------------------------------------
  const handleNewMeeting = useCallback(() => {
    const state = stateRef.current;
    if (state.segmentCount > 0) {
      const updatedArchive = archiveCurrentMeeting(state);
      setArchivedMeetings(updatedArchive);
    }
    pendingTextRef.current = '';
    if (staleTimerRef.current) {
      clearTimeout(staleTimerRef.current);
      staleTimerRef.current = null;
    }
    const fresh = createInitialMeetingState();
    saveMeetingState(fresh);
    setMeetingState(fresh);
    stateRef.current = fresh;
  }, []);

  // -------------------------------------------------------------------------
  // Refresh: force LLM with pending text or last few feed entries
  // -------------------------------------------------------------------------
  const handleRefresh = useCallback(async () => {
    if (isLLMRunningRef.current) return;

    if (pendingTextRef.current.length > 0) {
      await triggerLLM(true);
      return;
    }

    const state = stateRef.current;
    if (state.displayFeed.length === 0) return;
    const lastEntries = state.displayFeed.slice(-3);
    pendingTextRef.current = lastEntries.map((e) => e.text).join(' ');
    latestAudioTypeRef.current = lastEntries[lastEntries.length - 1].audioType;
    await triggerLLM(true);
  }, [triggerLLM]);

  // -------------------------------------------------------------------------
  // Native mode (meeting / solo) — persists until the next mode_changed event
  // -------------------------------------------------------------------------
  useEffect(() => {
    const unsub = eventBus.on('native:mode-changed', (payload) => {
      setNativeMode(payload.mode);
    });
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

  // -------------------------------------------------------------------------
  // Render: archive panel
  // -------------------------------------------------------------------------
  if (showArchive) {
    return (
      <div className="w-full h-full flex flex-col overflow-hidden text-base-content">
        <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center gap-2">
          <button
            onClick={() => setShowArchive(false)}
            className="p-1 hover:bg-base-200 rounded transition-colors"
          >
            <ChevronLeft size={14} className="text-base-content/60" />
          </button>
          <span className="text-[11px] font-medium text-base-content/70">Past Meetings</span>
          <span className="text-[10px] text-base-content/30 ml-auto">
            {archivedMeetings.length} saved
          </span>
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
                  isExpanded={expandedArchiveId === meeting.id}
                  onToggle={() =>
                    setExpandedArchiveId((prev) => (prev === meeting.id ? null : meeting.id))
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasContent =
    meetingState.displayFeed.length > 0 || !!meetingState.summaryTree.overall.text;

  // -------------------------------------------------------------------------
  // Render: empty / waiting state
  // -------------------------------------------------------------------------
  if (!hasContent) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-2 text-base-content/40"
        data-doc='{"icon":"mdi:radio-tower","title":"Meeting","desc":"Live meeting transcription with AI summary. Speak or play audio to start."}'
      >
        <div className="relative">
          <Radio size={24} className="opacity-30" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-base-content/20 animate-pulse" />
        </div>
        <span className="text-[11px] font-medium">Waiting for meeting audio...</span>
        <span className="text-[9px] opacity-50">Speak or play audio to begin</span>
        <div className="flex items-center gap-2 mt-1">
          <PauseButton />
          {archivedMeetings.length > 0 && (
            <button
              onClick={() => setShowArchive(true)}
              className="flex items-center gap-1 text-[10px] text-base-content/40 hover:text-base-content/70 transition-colors"
            >
              <Clock size={10} />
              {archivedMeetings.length} past
            </button>
          )}
          <button
            onClick={handleNewMeeting}
            className="flex items-center gap-1 text-[10px] text-base-content/40 hover:text-base-content/70 transition-colors"
          >
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
  const { summaryTree: tree } = meetingState;

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden text-base-content"
      data-doc='{"icon":"mdi:radio-tower","title":"Meeting","desc":"Live meeting intelligence HUD with 3-level context tree and next-step coaching."}'
    >
      {/* ── Header ── */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center justify-between gap-2">
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
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {archivedMeetings.length > 0 && (
            <button
              onClick={() => setShowArchive(true)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-base-content/40 hover:text-base-content/70 hover:bg-base-200 rounded transition-colors"
              title="View past meetings"
            >
              <Clock size={9} />
              {archivedMeetings.length}
            </button>
          )}
          <button
            onClick={handleNewMeeting}
            className="p-1 hover:bg-base-200 rounded transition-colors"
            title="Start new meeting"
          >
            <Plus size={12} className="text-base-content/40" />
          </button>
          <PauseButton />
          <button
            onClick={handleRefresh}
            disabled={isLLMRunning}
            className="p-1 hover:bg-base-200 rounded transition-colors disabled:opacity-30"
            title="Force LLM update"
          >
            <RefreshCw size={12} className="text-base-content/40" />
          </button>
        </div>
      </div>

      {/* ── Scrollable intelligence section ── */}
      <div className="flex-shrink-0 overflow-auto px-2 pt-2 pb-1 space-y-1.5 max-h-[55%]">
        {/* Context tree */}
        <div className="space-y-1.5">
          <TreeNode levelKey="overall" level={tree.overall} />
          <TreeNode levelKey="topic" level={tree.topic} />
          <TreeNode levelKey="now" level={tree.now} />
        </div>

        {/* Next Step — follows the story, placed after the tree */}
        {meetingState.nextStep && (
          <NextStepCard text={meetingState.nextStep} icon={meetingState.nextStepIcon} />
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
