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

import { useState, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConversationRecord } from '../../../graph/data';
import type { ProcessingResult } from '../../../program/types/recording';
import { AnnotatedText } from './InlineAnnotations';
import { getDebugTrace, subscribe as subscribeDebugStore } from '../../../modules/sys1/debugStore';

interface ConversationEntryProps {
  conversation: ConversationRecord;
  showRawText: boolean;
  extraction?: ProcessingResult;
  isMeetingMode: boolean;
  isLast?: boolean;
}

const TRUNCATE_LENGTH = 280;

export function ConversationEntry({
  conversation,
  showRawText: _showRawText,
  extraction,
  isMeetingMode,
  isLast = false,
}: ConversationEntryProps) {
  // ── System marker (e.g. "New session started") ──────────────────
  if (conversation.speaker === 'system') {
    const timeStr = new Date(conversation.timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    return (
      <div className="flex items-center gap-2 py-2 animate-fadeSlideIn">
        <div className="flex-1 border-t border-base-300/40" />
        <span className="text-[9px] text-base-content/30 whitespace-nowrap">
          {conversation.rawText} &middot; {timeStr}
        </span>
        <div className="flex-1 border-t border-base-300/40" />
      </div>
    );
  }

  const [isExpanded, setIsExpanded] = useState(false);

  const fullText = conversation.rawText;

  const isLongText = !isLast && fullText.length > TRUNCATE_LENGTH;
  const displayText = isLongText && !isExpanded
    ? fullText.slice(0, TRUNCATE_LENGTH)
    : fullText;

  // Entity names for highlighting
  const entityNames = extraction?.entities?.map((e) => e.name) ?? [];

  const isSys1 = conversation.speaker === 'sys1';

  // Debug trace for SYS-I entries (useSyncExternalStore for reactive updates)
  const debugTrace = useSyncExternalStore(
    subscribeDebugStore,
    () => getDebugTrace(conversation.id),
  );
  const [debugOpen, setDebugOpen] = useState(false);

  const isSpeech = conversation.source === 'speech' || conversation.source === 'meeting';
  const timeStr = new Date(conversation.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  // ── SYS-I entry — plain text, no label ──────────────────────────
  if (isSys1) {
    return (
      <div className="animate-fadeSlideIn">
        <div className="text-[15px] leading-relaxed text-base-content/90 [&_ol]:list-decimal [&_ol]:ml-5 [&_ol]:my-1 [&_ul]:list-disc [&_ul]:ml-5 [&_ul]:my-1 [&_li]:my-0.5 [&_p]:my-0.5 [&_strong]:font-semibold">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{fullText}</ReactMarkdown>
        </div>
        <div className="flex justify-end items-center gap-1 mt-1 text-[10px] text-base-content/20">
          {debugTrace && (
            <button
              onClick={() => setDebugOpen(o => !o)}
              className="text-violet-400/40 hover:text-violet-400 font-mono mr-1"
            >
              [{debugOpen ? 'hide' : 'debug'}]
            </button>
          )}
          <span>{timeStr}</span>
        </div>
        {debugTrace && debugOpen && (
          <div className="mt-2 p-2 bg-base-200 rounded-lg text-[11px] font-mono text-base-content/50 space-y-1.5">
            <div><span className="text-base-content/30">transport</span> {debugTrace.transport}</div>
            <div><span className="text-base-content/30">duration</span> {debugTrace.totalDurationMs}ms</div>
            <div><span className="text-base-content/30">intent</span> {debugTrace.parsedIntent}:{debugTrace.parsedEmotion}</div>
            <div><span className="text-base-content/30">topic</span> {debugTrace.parsedTopic}</div>
            <div><span className="text-base-content/30">input</span> {debugTrace.userInput.slice(0, 200)}{debugTrace.userInput.length > 200 ? '...' : ''}</div>
            {debugTrace.searches.length > 0 && (
              <div className="space-y-1">
                <span className="text-base-content/30">searches</span>
                {debugTrace.searches.map((s, i) => (
                  <div key={i} className="pl-2 border-l border-violet-400/20">
                    <div>{s.type}: "{s.query}" ({s.resultsLength} chars)</div>
                    {s.resultPreview && <div className="text-base-content/30 truncate">{s.resultPreview.slice(0, 200)}</div>}
                  </div>
                ))}
              </div>
            )}
            <div>
              <span className="text-base-content/30">raw output</span>
              <pre className="mt-0.5 p-1.5 bg-base-300/50 rounded max-h-40 overflow-auto whitespace-pre-wrap break-all text-[10px]">
                {debugTrace.rawOutput}
              </pre>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── User / meeting speaker entry — purple left bar ───────────────

  const speakerTag = (() => {
    if (!isMeetingMode) return null;
    if (conversation.speaker === 'user') return 'You';
    if (conversation.speaker === 'other') return 'Them';
    return null;
  })();

  return (
    <div className="animate-fadeSlideIn">
      <div className="border-l-2 border-violet-400/80 pl-3 flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {/* Speaker tag for meeting mode */}
          {speakerTag && (
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-1.5 h-1.5 rounded-full ${speakerTag === 'You' ? 'bg-primary' : 'bg-secondary'}`} />
              <span className={`text-[11px] font-medium ${speakerTag === 'You' ? 'text-primary/70' : 'text-secondary/70'}`}>
                {speakerTag}
              </span>
            </div>
          )}

          {/* Conversation text */}
          <div
            className={`text-[15px] leading-relaxed text-base-content/90 ${isLongText && !isExpanded ? 'cursor-pointer' : ''}`}
            onClick={isLongText && !isExpanded ? () => setIsExpanded(true) : undefined}
          >
            {entityNames.length > 0 ? (
              <AnnotatedText text={displayText} entityNames={entityNames} />
            ) : (
              displayText
            )}
            {isLongText && !isExpanded && <span className="text-primary/60 ml-0.5">...</span>}
            {isLongText && isExpanded && (
              <button
                onClick={(e) => { e.stopPropagation(); setIsExpanded(false); }}
                className="text-primary/50 hover:text-primary/70 text-xs ml-1.5"
              >
                show less
              </button>
            )}
          </div>
        </div>

        {/* Source + time — right column */}
        <div className="shrink-0 w-16 flex items-center justify-end gap-1 pt-0.5 text-[10px] text-base-content/25">
          <span>{timeStr}</span>
          <span className={`w-1.5 h-1.5 rounded-full ${isSpeech ? 'bg-violet-400/40' : 'bg-base-content/20'}`} />
          <span>{isMeetingMode ? 'M' : isSpeech ? 'S' : 'T'}</span>
        </div>
      </div>
    </div>
  );
}
