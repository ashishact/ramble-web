/**
 * useConversationStream — Data hook for conversation views
 *
 * Combines:
 * - DuckDB conversations table via useConversationData
 * - eventBus `processing:system-ii` subscription → caches ProcessingResult by conversationId
 * - pipelineStatus subscription → for live status
 * - meetingStatus subscription → tracks whether we're in meeting mode
 * - Recording lifecycle tracking → hides intermediate chunks after final arrives
 *
 * INTERMEDIATE CHUNK CONSOLIDATION:
 * During voice recording, each System I intermediate chunk creates a separate
 * Conversation record. This hook hides them once the final arrives:
 *
 * 1. LIVE (during recording + transition): Event-driven tracking.
 *    - recording:started → begin tracking
 *    - New convs during recording OR transition → tracked as intermediate
 *    - processing:system-ii → uses conversationId from event to identify the final,
 *      removes it from intermediates, ends transition
 *    Tracking extends into transition period to catch late-arriving intermediates
 *    (DB writes that land after recording:ended).
 *
 * 2. HISTORICAL (page reload): Dual strategy.
 *    a. recordingId grouping: conversations sharing a recordingId are from the
 *       same recording session. Keep only the newest (the final), hide the rest.
 *    b. Exact text match: hide conversations with identical rawText (WebSocket dupes,
 *       dual submission paths). Keeps the newest, hides older duplicates.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type { ProcessingResult } from '../../../program/kernel/processor';
import type { PipelineState } from '../../../program/kernel/pipelineStatus';
import { pipelineStatus } from '../../../program/kernel/pipelineStatus';
import { meetingStatus } from '../../../program/kernel/meetingStatus';
import { eventBus } from '../../../lib/eventBus';
import { useConversationData } from '../../../graph/data';
import type { ConversationRecord } from '../../../graph/data';

export interface ConversationStreamData {
  conversations: ConversationRecord[];
  extractionsByConvId: Map<string, ProcessingResult>;
  pipelineState: PipelineState;
  isMeetingMode: boolean;
  /** ID of the final conversation that replaced intermediates (for fadeIn animation) */
  finalConvId: string | null;
}

/** Delay before clearing finalConvId after transition (allows fadeIn animation to play) */
const FINAL_HIGHLIGHT_DELAY_MS = 600;

export function useConversationStream(): ConversationStreamData {
  // DuckDB-backed conversation data
  const { data: conversations } = useConversationData({
    limit: 50,
    orderBy: { field: 'timestamp', dir: 'desc' },
  });

  const [extractionsByConvId, setExtractionsByConvId] = useState<Map<string, ProcessingResult>>(
    () => new Map()
  );
  const [pipelineState, setPipelineState] = useState<PipelineState>(pipelineStatus.getState());
  const [isMeetingMode, setIsMeetingMode] = useState(meetingStatus.getState().isActive);

  // ── Recording lifecycle state ──────────────────────────────────────────
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  const [intermediateConvIds, setIntermediateConvIds] = useState<Set<string>>(() => new Set());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [finalConvId, setFinalConvId] = useState<string | null>(null);

  // Keep refs for event handlers (avoids stale closures)
  const conversationsRef = useRef<ConversationRecord[]>([]);
  conversationsRef.current = conversations;

  const activeRecordingIdRef = useRef<string | null>(null);
  activeRecordingIdRef.current = activeRecordingId;

  const prevConvIdsRef = useRef<Set<string>>(new Set());

  const isTransitioningRef = useRef(false);
  isTransitioningRef.current = isTransitioning;

  // ── Track new conversation arrivals during recording AND transition ────
  useEffect(() => {
    const currentIds = new Set(conversations.map((c) => c.id));

    if (activeRecordingIdRef.current || isTransitioningRef.current) {
      const newIds: string[] = [];
      for (const id of currentIds) {
        if (!prevConvIdsRef.current.has(id)) {
          newIds.push(id);
        }
      }
      if (newIds.length > 0) {
        setIntermediateConvIds((prev) => {
          const next = new Set(prev);
          for (const id of newIds) next.add(id);
          return next;
        });
      }
    }

    prevConvIdsRef.current = currentIds;
  }, [conversations]);

  // ── Recording lifecycle event subscriptions ────────────────────────────
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    unsubs.push(
      eventBus.on('recording:started', ({ recording }) => {
        setActiveRecordingId(recording.id);
        setIsTransitioning(false);
        setFinalConvId(null);
      })
    );

    unsubs.push(
      eventBus.on('recording:ended', ({ recording }) => {
        if (recording.id !== activeRecordingIdRef.current) return;
        setActiveRecordingId(null);
        setIsTransitioning(true);
      })
    );

    unsubs.push(
      eventBus.on('native:recording-cancelled', () => {
        setActiveRecordingId(null);
        setIsTransitioning(false);
      })
    );

    return () => unsubs.forEach((u) => u());
  }, []);

  // ── processing:system-ii → end transition, identify final conv ─────────
  useEffect(() => {
    return eventBus.on('processing:system-ii', (payload) => {
      if (!payload.result) return;

      const convs = conversationsRef.current;
      const finalId = payload.conversationId
        ?? (convs.length > 0 ? convs[0].id : null);

      if (!finalId) return;

      setExtractionsByConvId((prev) => {
        const next = new Map(prev);
        next.set(finalId, payload.result);
        return next;
      });

      if (isTransitioningRef.current) {
        setIntermediateConvIds((prev) => {
          if (!prev.has(finalId)) return prev;
          const next = new Set(prev);
          next.delete(finalId);
          return next;
        });
        setIsTransitioning(false);
        setFinalConvId(finalId);
        setTimeout(() => setFinalConvId(null), FINAL_HIGHLIGHT_DELAY_MS);
      }
    });
  }, []);

  // Subscribe to pipeline status
  useEffect(() => {
    return pipelineStatus.subscribe(setPipelineState);
  }, []);

  // Subscribe to meeting mode status
  useEffect(() => {
    return meetingStatus.subscribe((state) => {
      setIsMeetingMode(state.isActive);
    });
  }, []);

  // ── Historical dedup for page reload ──────────────────────────────────
  const hiddenConvIds = useMemo(() => {
    if (activeRecordingId || isTransitioning) return new Set<string>();

    const hidden = new Set<string>();

    // recordingId grouping — keep only newest per recording
    // Skip interviewer entries (they don't participate in recording lifecycle)
    const byRecordingId = new Map<string, ConversationRecord[]>();
    for (const conv of conversations) {
      if (conv.speaker === 'interviewer') continue;
      if (conv.recordingId) {
        const group = byRecordingId.get(conv.recordingId);
        if (group) {
          group.push(conv);
        } else {
          byRecordingId.set(conv.recordingId, [conv]);
        }
      }
    }

    for (const [, group] of byRecordingId) {
      if (group.length <= 1) continue;
      for (let i = 1; i < group.length; i++) {
        hidden.add(group[i].id);
      }
    }

    // Exact text match dedup — keep newest
    // Skip interviewer entries (duplicate questions are valid if asked again)
    const seenTexts = new Map<string, string>();
    for (const conv of conversations) {
      if (hidden.has(conv.id)) continue;
      if (conv.speaker === 'interviewer') continue;
      const text = conv.rawText.trim();
      if (!text) continue;

      if (seenTexts.has(text)) {
        hidden.add(conv.id);
      } else {
        seenTexts.set(text, conv.id);
      }
    }

    return hidden;
  }, [conversations, activeRecordingId, isTransitioning]);

  // ── Filter conversations ───────────────────────────────────────────────
  const filteredConversations = useMemo(() => {
    const isRecordingOrTransitioning = activeRecordingId !== null || isTransitioning;

    return conversations.filter((c) => {
      if (isRecordingOrTransitioning) return true;
      if (intermediateConvIds.has(c.id)) return false;
      if (hiddenConvIds.has(c.id)) return false;
      return true;
    });
  }, [conversations, activeRecordingId, isTransitioning, intermediateConvIds, hiddenConvIds]);

  return {
    conversations: filteredConversations,
    extractionsByConvId,
    pipelineState,
    isMeetingMode,
    finalConvId,
  };
}
