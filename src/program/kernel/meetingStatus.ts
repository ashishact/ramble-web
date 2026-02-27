/**
 * MeetingStatus - Global observable for meeting mode state
 *
 * PARADIGM: STREAMING infrastructure ─────────────────────────────────────────
 * This is the shared backbone for all streaming-mode consumers.
 * It listens to native events and exposes a single subscribe() API so widgets
 * don't each have to wire the same eventBus listeners.
 *
 * FOCUS CONTEXT: OUT-OF-APP primarily.
 * Meeting mode data arrives via WebSocket from the native app (Zoom/Meet/etc.
 * audio routed through the desktop companion). The user is typically not
 * focused on Ramble while this runs.
 *
 * Consumers:
 *   - MeetingTranscription widget: own LLM loop per segment accumulation
 *   - Questions widget: switches to generateMeetingQuestions() when isActive
 *   - Suggestions widget: switches to generateMeetingSuggestions() when isActive
 *
 * isActive = mode === 'meeting' && isRecording
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tracks whether the native app is in meeting mode and accumulates the live
 * transcript so other widgets (Questions, Suggestions) can switch into a
 * meeting-aware mode without duplicating event wiring.
 *
 * Signal sources:
 *   native:mode-changed          → 'meeting' | 'solo' — primary mode switch
 *   native:recording-started     → marks session active, clears segments
 *   native:recording-ended       → marks session inactive
 *   native:recording-cancelled   → marks session inactive
 *   native:transcription-intermediate → appends segments while active
 *
 * isActive = mode === 'meeting' && isRecording
 *
 * Modelled after pipelineStatus — subscribe() returns an unsubscribe fn.
 */

import { eventBus } from '../../lib/eventBus';

export interface MeetingSegment {
  text: string;
  audioType: 'mic' | 'system';
  ts: number;
}

export interface MeetingStatusState {
  /** True when native app is in meeting mode AND recording is active */
  isActive: boolean;
  /** Accumulated transcript since current recording started (capped at MAX_SEGMENTS) */
  segments: MeetingSegment[];
}

const MAX_SEGMENTS = 60;

class MeetingStatusController {
  private mode: 'meeting' | 'solo' | null = null;
  private isRecording = false;
  private segments: MeetingSegment[] = [];
  private subscribers = new Set<(state: MeetingStatusState) => void>();

  constructor() {
    // Primary mode signal — drives isActive together with isRecording
    eventBus.on('native:mode-changed', ({ mode }) => {
      this.mode = mode;
      this.notify();
    });

    // Session start: mark active and clear stale segments from last session
    eventBus.on('native:recording-started', () => {
      this.isRecording = true;
      this.segments = [];
      this.notify();
    });

    // Session end: deactivate (segments kept until next start)
    eventBus.on('native:recording-ended', () => {
      this.isRecording = false;
      this.notify();
    });

    eventBus.on('native:recording-cancelled', () => {
      this.isRecording = false;
      this.notify();
    });

    // Accumulate transcript segments only while in active meeting mode
    eventBus.on('native:transcription-intermediate', ({ text, audioType, ts }) => {
      if (!this.computedIsActive) return;
      this.segments = [...this.segments, { text, audioType, ts }];
      if (this.segments.length > MAX_SEGMENTS) {
        this.segments = this.segments.slice(-MAX_SEGMENTS);
      }
      this.notify();
    });
  }

  private get computedIsActive(): boolean {
    return this.mode === 'meeting' && this.isRecording;
  }

  getState(): MeetingStatusState {
    return { isActive: this.computedIsActive, segments: this.segments };
  }

  subscribe(fn: (state: MeetingStatusState) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  private notify(): void {
    const state = this.getState();
    this.subscribers.forEach(fn => fn(state));
  }
}

export const meetingStatus = new MeetingStatusController();
