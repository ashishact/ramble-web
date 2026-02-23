/**
 * Shared sub-components used by both Widget.tsx (live) and MeetingDetailView.tsx (archive).
 */

import { type FeedEntry } from './process';

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
  const isMic = entry.audioType === 'mic';
  return (
    <div className="flex items-start gap-1.5 py-[3px]">
      <span className="text-[9px] text-base-content/25 font-mono flex-shrink-0 tabular-nums leading-[1.4]">
        {formatTime(entry.ts)}
      </span>
      <span className="flex items-center gap-[3px] flex-shrink-0 leading-[1.4]">
        <span className={`w-[5px] h-[5px] rounded-full flex-shrink-0 ${isMic ? 'bg-blue-400/70' : 'bg-purple-400/70'}`} />
        <span className={`text-[8px] font-semibold ${isMic ? 'text-blue-500/60' : 'text-purple-500/60'}`}>
          {isMic ? 'mic' : 'sys'}
        </span>
      </span>
      <span className="text-[10px] font-mono text-base-content/70 leading-[1.4] break-words min-w-0 flex-1">
        {entry.text}
      </span>
    </div>
  );
}
