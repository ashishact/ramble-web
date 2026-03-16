/**
 * ConversationWidget — Width-aware wrapper
 *
 * Uses ResizeObserver to measure container width and switch views:
 *   < 480px  →  ConversationCompactView (existing ConversationList)
 *   ≥ 480px  →  ConversationExpandedView (blog-style annotated view)
 *
 * Both views share the same data from useConversationStream.
 */

import { useState, useEffect, useRef } from 'react';
import type { WidgetProps } from '../types';
import { useConversationStream } from './conversation/useConversationStream';
import { ConversationCompactView } from './ConversationCompactView';
import { ConversationExpandedView } from './ConversationExpandedView';

const EXPANDED_BREAKPOINT = 480;

export const ConversationWidget: React.FC<WidgetProps> = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { conversations, extractionsByConvId, pipelineState, isMeetingMode, finalConvId, streamingSys1Text, sys1Status } =
    useConversationStream();

  // Measure container width with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setIsExpanded(width >= EXPANDED_BREAKPOINT);
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full overflow-hidden"
      data-doc='{"icon":"mdi:message-text","title":"Conversation","desc":"View your conversation history. Toggle R (Raw) for original transcript or C (Clean) for sanitized text. Sessions are marked with timestamps. Expands to blog-style view when panel is wide enough."}'
    >
      {isExpanded ? (
        <ConversationExpandedView
          conversations={conversations}
          extractionsByConvId={extractionsByConvId}
          pipelineState={pipelineState}
          isMeetingMode={isMeetingMode}
          finalConvId={finalConvId}
          streamingSys1Text={streamingSys1Text}
          sys1Status={sys1Status}
        />
      ) : (
        <ConversationCompactView conversations={conversations} />
      )}
    </div>
  );
};
