import { Icon } from '@iconify/react';
import { ChevronLeft, Clock, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { type ArchivedMeeting } from './process';
import { FeedEntryRow, formatTime, formatShortDate, formatDurationBetween } from './shared';

function formatTalkTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function buildExportText(meeting: ArchivedMeeting): string {
  const lines: string[] = [];
  lines.push(`MEETING — ${new Date(meeting.startedAt).toLocaleString()}`);
  lines.push(`Duration: ${formatDurationBetween(meeting.startedAt, meeting.endedAt)} · ${meeting.segmentCount} segments`);

  if (meeting.participants.length > 0) {
    lines.push(`Participants: ${meeting.participants.map((p) => p.name).join(', ')}`);
  }
  lines.push('');

  if (meeting.overviewItems.length > 0) {
    lines.push('OVERVIEW');
    meeting.overviewItems.forEach((item, i) => lines.push(`${i + 1}. ${item.text}`));
    lines.push('');
  }

  if (meeting.summaryTree.topic.text) {
    lines.push(`TOPIC: ${meeting.summaryTree.topic.text}`);
    lines.push('');
  }

  const openActions = meeting.actionItems.filter((a) => !a.done);
  if (openActions.length > 0) {
    lines.push('ACTION ITEMS');
    openActions.forEach((a) => {
      let line = `• ${a.text}`;
      if (a.owner) line += ` [${a.owner}]`;
      if (a.deadline) line += ` — ${a.deadline}`;
      lines.push(line);
    });
    lines.push('');
  }

  if (meeting.displayFeed.length > 0) {
    lines.push('TRANSCRIPT');
    meeting.displayFeed.forEach((e) => {
      lines.push(`[${formatTime(e.ts)}] [${e.audioType.toUpperCase()}] ${e.text}`);
    });
  }

  return lines.join('\n');
}

// ============================================================================
// Main component
// ============================================================================

interface Props {
  meeting: ArchivedMeeting;
  onBack: () => void;
}

export function MeetingDetailView({ meeting, onBack }: Props) {
  const [copied, setCopied] = useState(false);

  function handleExport() {
    const text = buildExportText(meeting);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const openActions = meeting.actionItems.filter((a) => !a.done);
  const doneActions = meeting.actionItems.filter((a) => a.done);
  const totalTalkMs = meeting.talkTime.micMs + meeting.talkTime.systemMs;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden text-base-content">
      {/* Header */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-base-200 flex items-center gap-2">
        <button onClick={onBack} className="p-1 hover:bg-base-200 rounded transition-colors">
          <ChevronLeft size={14} className="text-base-content/60" />
        </button>
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-base-content/70 truncate block">
            {formatShortDate(meeting.startedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-base-content/40 flex-shrink-0">
          <Clock size={9} />
          <span>{formatDurationBetween(meeting.startedAt, meeting.endedAt)}</span>
          <span>·</span>
          <span>{meeting.segmentCount} seg</span>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-base-content/40 hover:text-base-content/70 hover:bg-base-200 rounded transition-colors"
          title="Copy as text"
        >
          {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-2 py-2 space-y-1.5">

        {/* Talk time bar */}
        {totalTalkMs > 0 && (
          <div className="px-3 py-2 bg-base-200/30 rounded-xl space-y-1">
            <div className="flex items-center justify-between text-[8px] text-base-content/40">
              <span>You · {formatTalkTime(meeting.talkTime.micMs)}</span>
              <span>Remote · {formatTalkTime(meeting.talkTime.systemMs)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-base-300 overflow-hidden flex">
              <div
                className="h-full bg-blue-400/70 rounded-l-full transition-all"
                style={{ width: `${(meeting.talkTime.micMs / totalTalkMs) * 100}%` }}
              />
              <div
                className="h-full bg-purple-400/70 rounded-r-full transition-all"
                style={{ width: `${(meeting.talkTime.systemMs / totalTalkMs) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Participants */}
        {meeting.participants.length > 0 && (
          <div className="flex flex-wrap gap-1 px-1">
            {meeting.participants.map((p) => (
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

        {/* Overview */}
        <div className="bg-blue-400/[0.06] rounded-xl px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5">
            <Icon
              icon={meeting.summaryTree.overall.icon || 'mdi:flag-outline'}
              width={12} height={12} className="text-blue-500/70"
            />
            <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">
              Overview
            </span>
            <span className="text-[8px] text-base-content/25 ml-auto">
              {meeting.overviewItems.length} items
            </span>
          </div>
          {meeting.overviewItems.length === 0 ? (
            <p className="text-[9px] text-base-content/25 italic">No overview recorded</p>
          ) : (
            <ol className="space-y-0.5 list-none">
              {meeting.overviewItems.map((item, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-[8px] text-blue-500/40 font-mono flex-shrink-0 mt-[1px]">
                    {i + 1}.
                  </span>
                  <span className="text-[10px] text-base-content/60 leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Topic */}
        {meeting.summaryTree.topic.text && (
          <div className="bg-violet-400/[0.06] rounded-xl px-3 py-2 space-y-1">
            <div className="flex items-center gap-1.5">
              <Icon
                icon={meeting.summaryTree.topic.icon || 'mdi:comment-multiple-outline'}
                width={13} height={13} className="text-violet-500/70"
              />
              <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">
                Last Topic
              </span>
            </div>
            <p className="text-[11px] text-base-content/70 leading-relaxed">
              {meeting.summaryTree.topic.text}
            </p>
          </div>
        )}

        {/* Action items */}
        {meeting.actionItems.length > 0 && (
          <div className="bg-emerald-400/[0.06] border border-emerald-400/15 rounded-xl px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Icon icon="mdi:checkbox-marked-circle-outline" width={13} height={13} className="text-emerald-500/70" />
              <span className="text-[8px] font-bold uppercase tracking-widest text-base-content/35">
                Action Items
              </span>
              {openActions.length > 0 && (
                <span className="ml-auto text-[8px] bg-emerald-400/20 text-emerald-600/70 px-1.5 py-0.5 rounded-full">
                  {openActions.length} open
                </span>
              )}
            </div>
            <div className="space-y-1">
              {openActions.map((item) => (
                <div key={item.id} className="flex items-start gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/60 flex-shrink-0 mt-[4px]" />
                  <div className="min-w-0">
                    <span className="text-[10px] text-base-content/75">{item.text}</span>
                    {(item.owner || item.deadline) && (
                      <span className="text-[8px] text-base-content/35 ml-1">
                        {item.owner && `[${item.owner}]`} {item.deadline && `— ${item.deadline}`}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {doneActions.map((item) => (
                <div key={item.id} className="flex items-start gap-1.5 opacity-40">
                  <Icon icon="mdi:check-circle" width={10} height={10} className="text-emerald-500 flex-shrink-0 mt-[2px]" />
                  <span className="text-[10px] text-base-content/50 line-through">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Transcript */}
        {meeting.displayFeed.length > 0 && (
          <div className="border-t border-base-200/50 pt-1.5">
            <div className="text-[8px] uppercase tracking-widest text-base-content/30 mb-1 px-1">
              Transcript ({meeting.displayFeed.length} segments)
            </div>
            <div className="space-y-0">
              {meeting.displayFeed.map((entry) => (
                <FeedEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
