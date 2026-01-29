/**
 * ConversationList - Sidebar showing conversation history
 *
 * Features:
 * - Raw/Clean text toggle
 * - Session markers
 * - Processing status indicators
 * - Load more pagination
 * - Summary display (if available)
 * - Expandable long text with show more/less
 */

import { useState } from 'react';
import { Icon } from '@iconify/react';
import type Conversation from '../../db/models/Conversation';
import { ExpandableText } from '../ui/ExpandableText';

interface ConversationListProps {
  conversations: Conversation[];
  onClose?: () => void;
  /** When true, the latest conversation is treated as processed even if DB hasn't updated yet */
  pipelineDone?: boolean;
}

// Truncate text if longer than this many characters
const TRUNCATE_LENGTH = 150;

export function ConversationList({ conversations, onClose, pipelineDone }: ConversationListProps) {
  const [showRawText, setShowRawText] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(20);

  return (
    <div className="w-full h-full bg-base-100 flex flex-col">
      {/* Header - Compact */}
      <div className="bg-base-200/30 px-2 py-1 flex items-center justify-between border-b border-base-200">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:message-text" className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-medium text-[11px]">Conversation</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Raw/Clean Toggle */}
          <div className="flex gap-0.5">
            <button
              onClick={() => setShowRawText(true)}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                showRawText
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-base-content/40 hover:bg-base-200/50'
              }`}
              data-doc='{"icon":"mdi:text-long","title":"Raw","desc":"Show original transcript exactly as spoken"}'
            >
              R
            </button>
            <button
              onClick={() => setShowRawText(false)}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                !showRawText
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-base-content/40 hover:bg-base-200/50'
              }`}
              data-doc='{"icon":"mdi:text-box-check","title":"Clean","desc":"Show sanitized text with corrections applied"}'
            >
              C
            </button>
          </div>
          {onClose && (
            <button
              className="p-0.5 text-base-content/40 hover:text-base-content/70 transition-colors"
              onClick={onClose}
            >
              <Icon icon="mdi:close" className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {conversations.length === 0 ? (
          <p className="text-center text-sm opacity-50 py-8">
            No conversation yet.
            <br />
            Start speaking or typing.
          </p>
        ) : (
          <>
            {conversations.slice(0, displayLimit).map((conv, index, arr) => {
              const displayText = showRawText ? conv.rawText : conv.sanitizedText;
              const hasChanges = conv.rawText !== conv.sanitizedText;

              // Check if this is the start of a new session
              const prevConv = arr[index - 1];
              const isSessionStart = !prevConv || prevConv.sessionId !== conv.sessionId;

              // For the latest conversation (index 0), use pipelineDone to override processed status
              // This provides immediate feedback since WatermelonDB observer can have slight delay
              const isProcessed = conv.processed || (index === 0 && pipelineDone);

              return (
                <div key={conv.id}>
                  {/* Session marker */}
                  {isSessionStart && (
                    <div className="flex items-center gap-2 my-3">
                      <div className="flex-1 border-t border-base-300"></div>
                      <div className="text-xs opacity-50 flex items-center gap-1">
                        <Icon icon="mdi:map-marker" className="w-3 h-3" />
                        <span>Session</span>
                        <span className="font-mono">
                          {new Date(conv.timestamp).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="flex-1 border-t border-base-300"></div>
                    </div>
                  )}

                  {/* Conversation unit */}
                  <div
                    className={`p-2 rounded-lg text-sm ${
                      isProcessed ? 'bg-base-200' : 'bg-warning/10 border border-warning/30'
                    }`}
                  >
                    <ExpandableText text={displayText} truncateLength={TRUNCATE_LENGTH} />
                    {/* Show summary if it exists */}
                    {conv.summary && (
                      <div className="mt-2 p-2 bg-base-300/50 rounded text-xs border-l-2 border-primary/50">
                        <div className="flex items-center gap-1 text-primary/70 mb-1">
                          <Icon icon="mdi:text-box-outline" className="w-3 h-3" />
                          <span className="font-medium">Summary</span>
                        </div>
                        <p className="opacity-80 leading-relaxed">{conv.summary}</p>
                      </div>
                    )}
                    {/* Show diff indicator when there are changes */}
                    {hasChanges && (
                      <div className="mt-1 text-xs">
                        {showRawText ? (
                          <span className="text-info opacity-70">Has sanitized version</span>
                        ) : (
                          <span className="text-success opacity-70">Cleaned from raw</span>
                        )}
                      </div>
                    )}
                    <div className="flex justify-between items-center mt-1 text-xs opacity-50">
                      <div className="flex gap-1 items-center">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            conv.source === 'speech' ? 'bg-primary' : 'bg-secondary'
                          }`}
                        ></span>
                        <span>{conv.source}</span>
                        {!isProcessed && <span className="text-warning">processing...</span>}
                      </div>
                      <span>
                        {new Date(conv.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Load more button */}
            {conversations.length > displayLimit && (
              <div className="text-center py-3 border-t border-base-300 mt-2">
                <button
                  className="btn btn-sm btn-ghost gap-2"
                  onClick={() => setDisplayLimit((prev) => prev + 20)}
                >
                  <Icon icon="mdi:arrow-down" className="w-4 h-4" />
                  Load {Math.min(20, conversations.length - displayLimit)} older
                </button>
                <div className="text-xs opacity-50 mt-1">
                  Showing {Math.min(displayLimit, conversations.length)} of {conversations.length}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
