import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { ConversationList } from '../../components/v2/ConversationList';
import { conversationStore } from '../../db/stores';
import type Conversation from '../../db/models/Conversation';

export const ConversationWidget: React.FC<WidgetProps> = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    const loadConversations = async () => {
      const recent = await conversationStore.getRecent(50);
      setConversations(recent);
    };
    loadConversations();

    // Set up polling for updates
    const interval = setInterval(loadConversations, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-full overflow-auto">
      <ConversationList
        conversations={conversations}
        onClose={() => {}} // No-op since we're in a widget, not a modal
      />
    </div>
  );
};
