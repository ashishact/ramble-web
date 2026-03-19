/**
 * Shared sub-components used by both Widget.tsx (live) and MeetingDetailView.tsx (archive).
 */

import { useState, useRef, useEffect } from 'react';
import { type FeedEntry, type SpeakerTimelineEntry } from './process';

// ============================================================================
// Speaker color palette — maximally distinct colors per speaker index
// ============================================================================

/**
 * Wide-gamut palette so each speaker (S0, S1, S2...) gets a visually distinct color.
 * The mic/sys source label already separates the channels — this palette is for
 * telling individual speakers apart within a channel.
 */
const SPEAKER_COLORS = [
  { dot: 'bg-emerald-400/70', text: 'text-emerald-500/70' },
  { dot: 'bg-orange-400/70',  text: 'text-orange-500/70' },
  { dot: 'bg-cyan-400/70',    text: 'text-cyan-500/70' },
  { dot: 'bg-rose-400/70',    text: 'text-rose-500/70' },
  { dot: 'bg-amber-400/70',   text: 'text-amber-600/70' },
  { dot: 'bg-violet-400/70',  text: 'text-violet-500/70' },
  { dot: 'bg-lime-400/70',    text: 'text-lime-600/70' },
  { dot: 'bg-pink-400/70',    text: 'text-pink-500/70' },
];

function speakerColor(index: number) {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

// ============================================================================
// Formatters
// ============================================================================

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatDurationBetween(startedAt: number, endedAt: number): string {
  const ms = endedAt - startedAt;
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${totalSeconds}s`;
}

// ============================================================================
// Speaker timeline bar — compact colored bar showing speaker transitions
// ============================================================================

/** Thin inline bar showing proportional speaker blocks within a segment */
function SpeakerTimelineBar({
  timeline,
  speakerNames,
  audioType,
}: {
  timeline: SpeakerTimelineEntry[];
  speakerNames?: Record<string, string>;
  audioType: 'mic' | 'system';
}) {
  const totalMs = timeline.reduce((sum, t) => sum + t.durationMs, 0);
  if (totalMs === 0) return null;

  const sourceLabel = audioType === 'mic' ? 'mic' : 'sys';

  return (
    <span className="inline-flex items-center gap-px h-[5px] w-10 rounded-sm overflow-hidden" title="Speaker timeline">
      {timeline.map((t, i) => {
        const color = speakerColor(t.speakerIndex);
        const widthPct = (t.durationMs / totalMs) * 100;
        const key = `${sourceLabel}:${t.speakerIndex}`;
        const name = speakerNames?.[key] || `S${t.speakerIndex}`;
        return (
          <span
            key={i}
            className={`${color.dot} h-full flex-shrink-0`}
            style={{ width: `${widthPct}%`, minWidth: '2px' }}
            title={`${name}: ${(t.durationMs / 1000).toFixed(1)}s`}
          />
        );
      })}
    </span>
  );
}

// ============================================================================
// Feed table — proper table layout so columns always align
// ============================================================================

export function FeedTable({
  entries,
  speakerNames,
}: {
  entries: FeedEntry[];
  speakerNames?: Record<string, string>;
}) {
  return (
    <table className="w-full border-collapse">
      <tbody>
        {entries.map((entry, i) => {
          const hasSpeaker = entry.speakerIndex != null;
          const isMic = entry.audioType === 'mic';
          const color = hasSpeaker
            ? speakerColor(entry.speakerIndex!)
            : isMic
              ? { dot: 'bg-blue-400/70', text: 'text-blue-500/60' }
              : { dot: 'bg-purple-400/70', text: 'text-purple-500/60' };
          const sourceLabel = isMic ? 'mic' : 'sys';
          const sourceColor = isMic ? 'text-blue-500/50' : 'text-purple-500/50';
          const speakerKey = hasSpeaker ? `${sourceLabel}:${entry.speakerIndex}` : null;
          const speakerName = speakerKey && speakerNames?.[speakerKey];
          const speakerLabel = hasSpeaker ? (speakerName || `S${entry.speakerIndex}`) : null;

          // Show timeline bar when multiple distinct speakers are present
          const timeline = entry.speakerTimeline;
          const hasMultiSpeaker = timeline && timeline.length > 1
            && new Set(timeline.map(t => t.speakerIndex)).size > 1;

          return (
            <tr key={entry.id} className={`align-top ${i % 2 === 1 ? 'bg-base-200/30' : ''}`}>
              <td className="text-[9px] text-base-content/25 font-mono tabular-nums whitespace-nowrap pr-1.5 py-[2px]">
                {formatTime(entry.ts)}
              </td>
              <td className="py-[2px] pr-0.5 whitespace-nowrap">
                <span className="flex items-center gap-[3px]">
                  <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${color.dot}`} />
                  <span className={`text-[8px] font-semibold ${sourceColor}`}>
                    {sourceLabel}
                  </span>
                </span>
              </td>
              <td className="text-[8px] font-semibold whitespace-nowrap pr-1.5 py-[2px]">
                {hasMultiSpeaker ? (
                  <SpeakerTimelineBar
                    timeline={timeline}
                    speakerNames={speakerNames}
                    audioType={entry.audioType}
                  />
                ) : speakerLabel ? (
                  <span className={color.text}>{speakerLabel}</span>
                ) : null}
              </td>
              <td className="text-[10px] font-mono text-base-content/70 leading-[1.4] py-[2px]">
                {entry.text}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ============================================================================
// Speaker labels editor — inline rename S0→"John"
// ============================================================================

/** A unique speaker identified by audioType + speakerIndex */
export interface SpeakerKey {
  audioType: 'mic' | 'system';
  speakerIndex: number;
}

function toKey(s: SpeakerKey): string {
  return `${s.audioType === 'mic' ? 'mic' : 'sys'}:${s.speakerIndex}`;
}

export function SpeakerLabels({
  speakers,
  speakerNames,
  onRename,
}: {
  speakers: SpeakerKey[];
  speakerNames: Record<string, string>;
  onRename: (key: string, name: string) => void;
}) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingKey != null) inputRef.current?.focus();
  }, [editingKey]);

  if (speakers.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 px-1">
      <span className="text-[8px] text-base-content/25 uppercase tracking-wider mr-0.5">Speakers</span>
      {speakers.map((s) => {
        const key = toKey(s);
        const name = speakerNames[key];
        const isMic = s.audioType === 'mic';
        const defaultLabel = `${isMic ? 'mic' : 'sys'}/S${s.speakerIndex}`;
        const isEditing = editingKey === key;

        if (isEditing) {
          return (
            <input
              key={key}
              ref={inputRef}
              defaultValue={name || ''}
              placeholder={defaultLabel}
              className="text-[9px] px-1.5 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-base-content/70 outline-none w-20"
              onBlur={(e) => {
                const val = e.target.value.trim();
                onRename(key, val);
                setEditingKey(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const val = (e.target as HTMLInputElement).value.trim();
                  onRename(key, val);
                  setEditingKey(null);
                }
                if (e.key === 'Escape') setEditingKey(null);
              }}
            />
          );
        }

        return (
          <button
            key={key}
            onClick={() => setEditingKey(key)}
            className={`text-[9px] px-1.5 py-0.5 rounded-full border transition-colors ${
              isMic
                ? 'border-blue-300/30 hover:border-blue-400/50 hover:bg-blue-400/5 text-blue-500/60'
                : 'border-purple-300/30 hover:border-purple-400/50 hover:bg-purple-400/5 text-purple-500/60'
            }`}
            title={`Click to name ${defaultLabel}`}
          >
            {name || defaultLabel}
          </button>
        );
      })}
    </div>
  );
}
