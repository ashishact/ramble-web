import type { WidgetProps } from '../types';
import { useConversationStream } from './conversation/useConversationStream';
import { ConversationExpandedView } from './ConversationExpandedView';

export const ConversationWidget: React.FC<WidgetProps> = () => {
  const { conversations, extractionsByConvId, pipelineState, isMeetingMode, finalConvId, streamingSys1Text, sys1Status } =
    useConversationStream();

  return (
    <div
      className="w-full h-full overflow-hidden"
      data-doc='{"icon":"mdi:message-text","title":"Conversation","desc":"View your conversation history. Toggle R (Raw) for original transcript or C (Clean) for sanitized text. Sessions are marked with timestamps."}'
    >
      <ConversationExpandedView
        conversations={conversations}
        extractionsByConvId={extractionsByConvId}
        pipelineState={pipelineState}
        isMeetingMode={isMeetingMode}
        finalConvId={finalConvId}
        streamingSys1Text={streamingSys1Text}
        sys1Status={sys1Status}
      />
    </div>
  );
};
