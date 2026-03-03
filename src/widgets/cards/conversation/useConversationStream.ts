/**
 * useConversationStream — Data hook for conversation views
 *
 * Combines:
 * - WatermelonDB observable for conversations (sorted DESC, take 50)
 * - eventBus `processing:system-ii` subscription → caches ProcessingResult by conversationId
 * - pipelineStatus subscription → for live status
 * - meetingStatus subscription → tracks whether we're in meeting mode
 * - Recording lifecycle tracking → hides intermediate chunks after final arrives
 *
 * INTERMEDIATE CHUNK CONSOLIDATION:
 * During voice recording, each System I intermediate chunk creates a separate
 * Conversation record in WatermelonDB. This hook hides them once the final arrives:
 *
 * 1. LIVE (during recording + transition): Event-driven tracking.
 *    - recording:started → begin tracking
 *    - New convs during recording OR transition → tracked as intermediate
 *    - processing:system-ii → uses conversationId from event to identify the final,
 *      removes it from intermediates, ends transition
 *    Tracking extends into transition period to catch late-arriving intermediates
 *    (DB writes from System I that land after recording:ended).
 *
 * 2. HISTORICAL (page reload): Dual strategy.
 *    a. recordingId grouping (v8+): conversations sharing a recordingId are from the
 *       same recording session. Keep only the newest (the final), hide the rest.
 *       This is reliable even when text differs between intermediate and final.
 *    b. Exact text match: hide conversations with identical rawText (WebSocket dupes,
 *       dual submission paths). Keeps the newest, hides older duplicates.
 *
 * EXACT DUPLICATE PREVENTION:
 * Handled at the kernel level (processInputItem) — not here. The kernel checks
 * for exact rawText matches in recent conversations before creating new records.
 * This catches duplicates from WebSocket dupes, dual submission paths, etc.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import type Conversation from '../../../db/models/Conversation';
import type { ProcessingResult } from '../../../program/kernel/processor';
import type { PipelineState } from '../../../program/kernel/pipelineStatus';
import { pipelineStatus } from '../../../program/kernel/pipelineStatus';
import { meetingStatus } from '../../../program/kernel/meetingStatus';
import { eventBus } from '../../../lib/eventBus';
import { database } from '../../../db/database';
import { Q } from '@nozbe/watermelondb';

export interface ConversationStreamData {
  conversations: Conversation[];
  extractionsByConvId: Map<string, ProcessingResult>;
  pipelineState: PipelineState;
  isMeetingMode: boolean;
  /** ID of the final conversation that replaced intermediates (for fadeIn animation) */
  finalConvId: string | null;
}

/** Delay before clearing finalConvId after transition (allows fadeIn animation to play) */
const FINAL_HIGHLIGHT_DELAY_MS = 600;

export function useConversationStream(): ConversationStreamData {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [extractionsByConvId, setExtractionsByConvId] = useState<Map<string, ProcessingResult>>(
    () => new Map()
  );
  const [pipelineState, setPipelineState] = useState<PipelineState>(pipelineStatus.getState());
  const [isMeetingMode, setIsMeetingMode] = useState(meetingStatus.getState().isActive);

  // ── Recording lifecycle state ──────────────────────────────────────────
  const [activeRecordingId, setActiveRecordingId] = useState<string | null>(null);
  // Conv IDs created during recording/transition — accumulated across recordings, never cleared
  const [intermediateConvIds, setIntermediateConvIds] = useState<Set<string>>(() => new Set());
  // Between recording:ended and processing:system-ii — keep tracking intermediates
  const [isTransitioning, setIsTransitioning] = useState(false);
  // The final conv ID for fadeIn animation — cleared after delay
  const [finalConvId, setFinalConvId] = useState<string | null>(null);

  // Keep a ref to the latest conversations for matching in event handlers
  const conversationsRef = useRef<Conversation[]>([]);
  conversationsRef.current = conversations;

  // Ref to track active recording ID in event handlers (avoids stale closure)
  const activeRecordingIdRef = useRef<string | null>(null);
  activeRecordingIdRef.current = activeRecordingId;

  // Ref to track previous conversation IDs for diffing new arrivals
  const prevConvIdsRef = useRef<Set<string>>(new Set());

  // Ref for isTransitioning in event handler (avoids stale closure)
  const isTransitioningRef = useRef(false);
  isTransitioningRef.current = isTransitioning;

  // Subscribe to WatermelonDB conversations
  useEffect(() => {
    const query = database
      .get<Conversation>('conversations')
      .query(Q.sortBy('timestamp', Q.desc), Q.take(50));

    const subscription = query.observe().subscribe((results) => {
      setConversations(results);
    });

    return () => subscription.unsubscribe();
  }, []);

  // ── Track new conversation arrivals during recording AND transition ────
  // During recording: new convs are intermediate chunks from System I.
  // During transition: late-arriving intermediates (DB writes that land after
  // recording:ended) still need to be tracked. The final conv is also tracked
  // here but gets removed when processing:system-ii fires.
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

    // recording:started → begin tracking new conv IDs as intermediates
    unsubs.push(
      eventBus.on('recording:started', ({ recording }) => {
        setActiveRecordingId(recording.id);
        setIsTransitioning(false);
        setFinalConvId(null);
      })
    );

    // recording:ended → enter transition (keep tracking + showing intermediates)
    unsubs.push(
      eventBus.on('recording:ended', ({ recording }) => {
        if (recording.id !== activeRecordingIdRef.current) return;
        setActiveRecordingId(null);
        setIsTransitioning(true);
      })
    );

    // native:recording-cancelled → stop tracking, but keep accumulated intermediate IDs
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

      // Use conversationId from the event directly (reliable, set by processor.ts)
      // Falls back to newest conv only for legacy paths (resumePendingTasks, reprocessFailed)
      const convs = conversationsRef.current;
      const finalId = payload.conversationId
        ?? (convs.length > 0 ? convs[0].id : null);

      if (!finalId) return;

      // Cache extraction for the final conv
      setExtractionsByConvId((prev) => {
        const next = new Map(prev);
        next.set(finalId, payload.result);
        return next;
      });

      // If we're transitioning from a live recording:
      // - Remove the final conv from intermediates (it may have been tracked during transition)
      // - End transition so filtering kicks in
      // - Mark final conv for fadeIn animation
      if (isTransitioningRef.current) {
        setIntermediateConvIds((prev) => {
          if (!prev.has(finalId)) return prev;
          const next = new Set(prev);
          next.delete(finalId);
          return next;
        });
        setIsTransitioning(false);
        setFinalConvId(finalId);
        // Clear finalConvId after animation plays
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
  // On reload there's no event history. Two strategies:
  //
  // 1. recordingId grouping (v8+): conversations sharing a recordingId are from
  //    the same recording session. Keep only the newest (the final), hide the rest.
  //
  // 2. Exact text match: hide conversations with identical rawText (WebSocket
  //    dupes, dual submission paths). Keeps the newest, hides older duplicates.
  const hiddenConvIds = useMemo(() => {
    // Skip dedup during active recording or transition — event-based tracking handles it
    if (activeRecordingId || isTransitioning) return new Set<string>();

    const hidden = new Set<string>();

    // ── recordingId grouping ─────────────────────────────────────────────
    // Group conversations that share a recordingId, keep only newest per group
    const byRecordingId = new Map<string, Conversation[]>();

    for (const conv of conversations) {
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
      // conversations are already sorted DESC by timestamp from the DB query,
      // so group[0] is the newest (the final)
      for (let i = 1; i < group.length; i++) {
        hidden.add(group[i].id);
      }
    }

    // ── Exact text match dedup ───────────────────────────────────────────
    // For any remaining visible conversations (including legacy without
    // recordingId), hide exact rawText duplicates — keep newest only.
    const seenTexts = new Map<string, string>(); // rawText → first conv id seen (newest)
    for (const conv of conversations) {
      if (hidden.has(conv.id)) continue;
      const text = conv.rawText.trim();
      if (!text) continue;

      if (seenTexts.has(text)) {
        // This is an older duplicate (conversations sorted DESC) — hide it
        hidden.add(conv.id);
      } else {
        seenTexts.set(text, conv.id);
      }
    }

    return hidden;
  }, [conversations, activeRecordingId, isTransitioning]);

  // ── Filter conversations ───────────────────────────────────────────────
  // During recording or transition: show everything (intermediates visible as they arrive)
  // After transition ends: filter out intermediate IDs and content-dedup'd IDs
  const filteredConversations = useMemo(() => {
    const isRecordingOrTransitioning = activeRecordingId !== null || isTransitioning;

    return conversations.filter((c) => {
      // During recording/transition, show all entries
      if (isRecordingOrTransitioning) return true;
      // After recording: filter event-tracked intermediates
      if (intermediateConvIds.has(c.id)) return false;
      // Filter recordingId-grouped and content-dedup'd intermediates (page reload)
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
