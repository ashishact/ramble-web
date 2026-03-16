/**
 * ConversationExpandedView — Blog-style annotated conversation view
 *
 * Rich view for wider panels (>= 480px). Features:
 * - Text flowing like an article with readable fonts and generous spacing
 * - Inline entity highlights from extraction results
 * - AI extraction cards (memories, entities, topics) interleaved below source
 * - Time-gap based session markers (not from DB sessionId)
 * - Live pipeline status with user-friendly language
 * - Meeting mode: speaker tags (You/Them) beside each entry
 * - Bottom text input — click anywhere in widget focuses it
 * - Smooth fade+slide animations for new content
 * - Intermediate chunk consolidation: chunks shown during recording, hidden after final arrives
 *
 * Scroll direction: newest at bottom (chat-style).
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { Icon } from '@iconify/react';
import type { ConversationRecord } from '../../graph/data';
import type { ProcessingResult } from '../../program/kernel/processor';
import type { PipelineState } from '../../program/kernel/pipelineStatus';
import { ConversationEntry } from './conversation/ConversationEntry';
import { ExtractionCard } from './conversation/ExtractionCard';
import { LiveStatusBar } from './conversation/LiveStatusBar';
import { ConversationInput } from './conversation/ConversationInput';
import { MeetingCompanionCards } from './conversation/FollowUpQuestions';

interface ConversationExpandedViewProps {
  conversations: ConversationRecord[];
  extractionsByConvId: Map<string, ProcessingResult>;
  pipelineState: PipelineState;
  isMeetingMode: boolean;
  /** ID of the final conversation that just replaced intermediates (for fadeIn animation) */
  finalConvId: string | null;
  /** Live streaming text from SYS-I (response section only), null when not streaming */
  streamingSys1Text: string | null;
  /** Status from Chrome extension background (e.g. "sending" while ChatGPT is working) */
  sys1Status: string | null;
}

/** Minutes of silence before showing a time separator */
const SESSION_GAP_MINUTES = 5;

/**
 * Determine if we should show a time separator between two conversations.
 * Shows separator when:
 * - The date changes between entries
 * - There's a gap of SESSION_GAP_MINUTES+ between entries
 */
function shouldShowSeparator(
  prev: ConversationRecord | undefined,
  current: ConversationRecord
): { show: boolean; label: string } {
  if (!prev) {
    // First entry — show date
    return {
      show: true,
      label: formatSeparatorLabel(current.timestamp),
    };
  }

  const prevDate = new Date(prev.timestamp);
  const currDate = new Date(current.timestamp);

  // Date changed
  if (prevDate.toDateString() !== currDate.toDateString()) {
    return { show: true, label: formatSeparatorLabel(current.timestamp) };
  }

  // Time gap
  const gapMs = current.timestamp - prev.timestamp;
  if (gapMs >= SESSION_GAP_MINUTES * 60 * 1000) {
    return {
      show: true,
      label: currDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
  }

  return { show: false, label: '' };
}

function formatSeparatorLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();

  if (isToday) {
    return 'Today, ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  return d.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  }) + ', ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ConversationExpandedView({
  conversations,
  extractionsByConvId,
  pipelineState,
  isMeetingMode,
  finalConvId,
  streamingSys1Text,
  sys1Status,
}: ConversationExpandedViewProps) {
  const [showRawText, setShowRawText] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLastIdRef = useRef<string | null>(null);

  // Reverse to chronological order (oldest first, newest at bottom)
  const chronological = useMemo(
    () => [...conversations].reverse(),
    [conversations]
  );

  // Auto-scroll to bottom when a new entry appears at the bottom of the list.
  // Tracks the last conversation ID instead of count — count-based detection
  // breaks after recording lifecycle (intermediates inflate count, then get hidden).
  useEffect(() => {
    const lastEntry = chronological[chronological.length - 1];
    const lastId = lastEntry?.id ?? null;

    if (lastId && lastId !== prevLastIdRef.current && scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth',
        });
      });
    }
    prevLastIdRef.current = lastId;
  }, [chronological]);

  return (
    <div className="w-full h-full flex flex-col bg-base-100">
      {/* Header */}
      <div className="bg-base-200/30 px-3 py-1.5 flex items-center justify-between border-b border-base-200 shrink-0">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:message-text" className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-medium text-[11px]">Conversation</span>
          {isMeetingMode && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary/15 text-secondary font-medium">
              Meeting
            </span>
          )}
        </div>
        <div className="flex gap-0.5">
          <button
            onClick={() => setShowRawText(true)}
            className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
              showRawText
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-base-content/40 hover:bg-base-200/50'
            }`}
          >
            R
          </button>
          <button
            onClick={() => setShowRawText(false)}
            className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
              !showRawText
                ? 'bg-primary/20 text-primary font-medium'
                : 'text-base-content/40 hover:bg-base-200/50'
            }`}
          >
            C
          </button>
        </div>
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-8 pt-5 pb-16 space-y-5"
      >
        {chronological.length === 0 ? (
          <div className="flex-1 flex items-center justify-center h-full">
            <p className="text-sm text-base-content/30 text-center">
              No conversation yet.
              <br />
              Start speaking or typing.
            </p>
          </div>
        ) : (
          chronological.map((conv, index) => {
            const prevConv = chronological[index - 1];
            const separator = shouldShowSeparator(prevConv, conv);
            const extraction = extractionsByConvId.get(conv.id);
            // Apply fadeIn animation to the final conversation entry replacing intermediates
            const isFinalConv = finalConvId === conv.id;

            return (
              <div key={conv.id} className={isFinalConv ? 'animate-fadeIn' : undefined}>
                {/* Time separator */}
                {separator.show && (
                  <div className="flex items-center gap-3 my-4">
                    <div className="flex-1 border-t border-base-300/40" />
                    <span className="text-[10px] text-base-content/25">
                      {separator.label}
                    </span>
                    <div className="flex-1 border-t border-base-300/40" />
                  </div>
                )}

                {/* Conversation entry */}
                <ConversationEntry
                  conversation={conv}
                  showRawText={showRawText}
                  extraction={extraction}
                  isMeetingMode={isMeetingMode}
                />

                {/* Extraction card (below source conversation) — skip for SYS-I entries */}
                {extraction && conv.speaker !== 'sys1' && <ExtractionCard extraction={extraction} />}
              </div>
            );
          })
        )}

        {/* SYS-I thinking indicator (before streaming text arrives) */}
        {sys1Status === 'sending' && !streamingSys1Text && (
          <div className="animate-fadeSlideIn">
            <div className="border-l-2 border-violet-400/60 pl-3 py-1">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
                <span className="text-[11px] font-medium text-violet-500/70">SYS-I</span>
                <span className="text-[11px] text-violet-400/50">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        {/* Streaming SYS-I response (before it lands as a DB record) */}
        {streamingSys1Text && (
          <div className="animate-fadeSlideIn">
            <div className="border-l-2 border-violet-400/60 pl-3 py-1">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500" />
                </span>
                <span className="text-[11px] font-medium text-violet-500/70">SYS-I</span>
              </div>
              <div className="text-[15px] leading-relaxed text-base-content/80">
                {streamingSys1Text}
              </div>
            </div>
          </div>
        )}

        {/* Live pipeline status after newest entry */}
        <LiveStatusBar pipelineState={pipelineState} />

        {/* Meeting companion cards (SYS-I responses appear inline as sys1 entries) */}
        <MeetingCompanionCards />
      </div>

      {/* Bottom text input */}
      <ConversationInput />
    </div>
  );
}
