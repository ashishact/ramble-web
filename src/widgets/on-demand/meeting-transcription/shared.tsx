/**
 * Shared sub-components used by both Widget.tsx (live) and MeetingDetailView.tsx (archive).
 */

import { type FeedEntry } from './process';

/** Speaker colors — cycles through a palette for speaker indices */
const SPEAKER_COLORS = [
  { dot: 'bg-blue-400/70', text: 'text-blue-500/60' },
  { dot: 'bg-purple-400/70', text: 'text-purple-500/60' },
  { dot: 'bg-emerald-400/70', text: 'text-emerald-500/60' },
  { dot: 'bg-amber-400/70', text: 'text-amber-500/60' },
  { dot: 'bg-rose-400/70', text: 'text-rose-500/60' },
  { dot: 'bg-cyan-400/70', text: 'text-cyan-500/60' },
];

function speakerColor(index: number) {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

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

export function FeedEntryRow({ entry }: { entry: FeedEntry }) {
  const hasSpeaker = entry.speakerIndex != null;
  const isMic = entry.audioType === 'mic';

  // Use speaker color if available, otherwise fallback to mic/system colors
  const color = hasSpeaker
    ? speakerColor(entry.speakerIndex!)
    : isMic
      ? { dot: 'bg-blue-400/70', text: 'text-blue-500/60' }
      : { dot: 'bg-purple-400/70', text: 'text-purple-500/60' };

  const label = hasSpeaker
    ? `S${entry.speakerIndex}`
    : isMic ? 'mic' : 'sys';

  return (
    <div className={`flex items-start gap-1.5 py-[3px] px-1 rounded ${hasSpeaker ? '' : isMic ? 'bg-blue-400/[0.06]' : ''}`}>
      <span className="flex items-center gap-1.5 flex-shrink-0 leading-[1.4]">
        <span className="text-[9px] text-base-content/25 font-mono tabular-nums">
          {formatTime(entry.ts)}
        </span>
        <span className="flex items-center gap-[3px]">
          <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${color.dot}`} />
          <span className={`text-[8px] font-semibold ${color.text}`}>
            {label}
          </span>
        </span>
      </span>
      <span className="text-[10px] font-mono text-base-content/70 leading-[1.4] break-words min-w-0 flex-1">
        {entry.text}
      </span>
    </div>
  );
}
