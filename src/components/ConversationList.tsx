/**
 * ConversationList - Sidebar showing conversation history
 *
 * Features:
 * - Raw/Clean text toggle
 * - Session markers
 * - Processing status indicators
 * - Load more pagination
 */

import { useState } from 'react';
import { Icon } from '@iconify/react';
import type Conversation from '../db/models/Conversation';

interface ConversationListProps {
  conversations: Conversation[];
  onClose: () => void;
}

export function ConversationList({ conversations, onClose }: ConversationListProps) {
  const [showRawText, setShowRawText] = useState(false);
  const [displayLimit, setDisplayLimit] = useState(20);

  return (
    <div className="w-80 border-r border-base-300 bg-base-100 flex flex-col shrink-0">
      {/* Header */}
      <div className="p-3 border-b border-base-300 flex justify-between items-center">
        <h2 className="font-bold text-sm">Conversation</h2>
        <div className="flex items-center gap-1">
          {/* Raw/Processed Toggle */}
          <div className="join">
            <button
              className={`join-item btn btn-xs ${showRawText ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setShowRawText(true)}
              title="Show raw transcript"
            >
              Raw
            </button>
            <button
              className={`join-item btn btn-xs ${!showRawText ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setShowRawText(false)}
              title="Show sanitized/processed text"
            >
              Clean
            </button>
          </div>
          <button className="btn btn-ghost btn-xs" onClick={onClose}>
            <Icon icon="mdi:close" className="w-4 h-4" />
          </button>
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
                      conv.processed ? 'bg-base-200' : 'bg-warning/10 border border-warning/30'
                    }`}
                  >
                    <p className="leading-relaxed">{displayText}</p>
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
                        {!conv.processed && <span className="text-warning">processing...</span>}
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
