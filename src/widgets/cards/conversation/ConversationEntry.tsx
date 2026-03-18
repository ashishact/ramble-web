/**
 * ConversationEntry — Single conversation block with annotations
 *
 * Displays conversation text with:
 * - Raw text display (single-pass LLM handles understanding)
 * - Truncation with click-to-expand
 * - Entity highlighting when extraction data is available
 * - Source indicator (speech/typed) with timestamp
 * - Meeting mode: speaker tags from the speaker field
 * - Fade+slide animation for new entries
 */

import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { ConversationRecord } from '../../../graph/data';
import type { ProcessingResult } from '../../../program/types/recording';
import { AnnotatedText } from './InlineAnnotations';

interface ConversationEntryProps {
  conversation: ConversationRecord;
  showRawText: boolean;
  extraction?: ProcessingResult;
  isMeetingMode: boolean;
}

const TRUNCATE_LENGTH = 280;

export function ConversationEntry({
  conversation,
  showRawText: _showRawText,
  extraction,
  isMeetingMode,
}: ConversationEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const fullText = conversation.rawText;

  const isLongText = fullText.length > TRUNCATE_LENGTH;
  const displayText = isLongText && !isExpanded
    ? fullText.slice(0, TRUNCATE_LENGTH)
    : fullText;

  // Entity names for highlighting
  const entityNames = extraction?.entities?.map((e) => e.name) ?? [];

  const isSys1 = conversation.speaker === 'sys1';

  const isSpeech = conversation.source === 'speech' || conversation.source === 'meeting';
  const timeStr = new Date(conversation.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // ── SYS-I entry — distinct violet styling ──────────────────────
  if (isSys1) {
    return (
      <div className="animate-fadeSlideIn">
        <div className="border-l-2 border-violet-400/60 pl-3 py-1">
          {/* Label row */}
          <div className="flex items-center gap-1.5 mb-1">
            <Icon icon="mdi:auto-fix" className="w-3.5 h-3.5 text-violet-500/70" />
            <span className="text-[11px] font-medium text-violet-500/70">SYS-I</span>
          </div>
          {/* Response text — no truncation, no entity highlighting */}
          <div className="text-[15px] leading-relaxed text-base-content/80">
            {fullText}
          </div>
          {/* Timestamp */}
          <div className="flex justify-end items-center gap-1 mt-1 text-[10px] text-base-content/25">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400/30" />
            <span>sys-i</span>
            <span>{timeStr}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── User / meeting speaker entry ─────────────────────────────────────

  // In meeting mode, determine speaker from the speaker field
  const speakerTag = (() => {
    if (!isMeetingMode) return null;
    if (conversation.speaker === 'user') return 'You';
    if (conversation.speaker === 'other') return 'Them';
    return null;
  })();

  return (
    <div className="animate-fadeSlideIn">
      {/* Speaker tag for meeting mode */}
      {speakerTag && (
        <div className="flex items-center gap-1.5 mb-1">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              speakerTag === 'You' ? 'bg-primary' : 'bg-secondary'
            }`}
          />
          <span
            className={`text-[11px] font-medium ${
              speakerTag === 'You' ? 'text-primary/70' : 'text-secondary/70'
            }`}
          >
            {speakerTag}
          </span>
        </div>
      )}

      {/* Conversation text */}
      <div
        className={`text-[15px] leading-relaxed text-base-content/90 ${
          isLongText && !isExpanded ? 'cursor-pointer' : ''
        }`}
        onClick={isLongText && !isExpanded ? () => setIsExpanded(true) : undefined}
      >
        {entityNames.length > 0 ? (
          <AnnotatedText text={displayText} entityNames={entityNames} />
        ) : (
          displayText
        )}
        {isLongText && !isExpanded && (
          <span className="text-primary/60 ml-0.5">...</span>
        )}
        {isLongText && isExpanded && (
          <button
            onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
            className="text-primary/50 hover:text-primary/70 text-xs ml-1.5"
          >
            show less
          </button>
        )}
      </div>

      {/* Source indicator — very subtle */}
      <div className="flex justify-end items-center gap-1 mt-1 text-[10px] text-base-content/25">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isSpeech ? 'bg-primary/30' : 'bg-base-content/20'
          }`}
        />
        <span>{isMeetingMode ? 'meeting' : isSpeech ? 'speech' : 'typed'}</span>
        <span>{timeStr}</span>
      </div>
    </div>
  );
}
