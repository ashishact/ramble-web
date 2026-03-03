/**
 * ConversationEntry — Single conversation block with annotations
 *
 * Displays conversation text with:
 * - Normalized text by default (falls back to sanitized, then raw)
 * - Truncation with click-to-expand (like compact view's ExpandableText)
 * - Entity highlighting when extraction data is available
 * - Source indicator (speech/typed) with timestamp
 * - Meeting mode: speaker tags (You/Them) from speakerHint in sentences
 * - Fade+slide animation for new entries
 */

import { useState } from 'react';
import type Conversation from '../../../db/models/Conversation';
import type { ProcessingResult } from '../../../program/kernel/processor';
import { AnnotatedText } from './InlineAnnotations';

interface ConversationEntryProps {
  conversation: Conversation;
  showRawText: boolean;
  extraction?: ProcessingResult;
  isMeetingMode: boolean;
}

const TRUNCATE_LENGTH = 280;

export function ConversationEntry({
  conversation,
  showRawText,
  extraction,
  isMeetingMode,
}: ConversationEntryProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Text priority: raw toggle → normalized → sanitized → raw
  const fullText = showRawText
    ? conversation.rawText
    : conversation.normalizedText || conversation.sanitizedText || conversation.rawText;

  const isLongText = fullText.length > TRUNCATE_LENGTH;
  const displayText = isLongText && !isExpanded
    ? fullText.slice(0, TRUNCATE_LENGTH)
    : fullText;

  // Entity names for highlighting
  const entityNames = extraction?.entities?.map((e) => e.name) ?? [];

  const isSpeech = conversation.source === 'speech' || conversation.source === 'meeting';
  const timeStr = new Date(conversation.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // In meeting mode, determine speaker from speakerHint in parsed sentences.
  // isMeetingMode comes from meetingStatus (driven by native:mode-changed event),
  // NOT from conversation.source — the source field may not always be 'meeting'.
  // mic = user's microphone (You), system = remote audio (Them)
  const speakerTag = (() => {
    if (!isMeetingMode) return null;

    const sentences = conversation.sentencesParsed;
    if (sentences.length > 0) {
      // Use the dominant speakerHint across sentences
      const micCount = sentences.filter((s) => s.speakerHint === 'mic').length;
      const systemCount = sentences.filter((s) => s.speakerHint === 'system').length;
      if (micCount > 0 || systemCount > 0) {
        return micCount >= systemCount ? 'You' : 'Them';
      }
    }
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
