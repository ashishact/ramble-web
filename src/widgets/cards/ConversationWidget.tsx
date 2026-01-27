import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { ConversationList } from '../../components/v2/ConversationList';
import { database } from '../../db/database';
import Conversation from '../../db/models/Conversation';
import { Q } from '@nozbe/watermelondb';

export const ConversationWidget: React.FC<WidgetProps> = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);

  useEffect(() => {
    // Use WatermelonDB's reactive observation instead of polling
    const query = database
      .get<Conversation>('conversations')
      .query(Q.sortBy('timestamp', Q.desc), Q.take(50));

    // Subscribe to changes - this updates immediately when data changes
    const subscription = query.observe().subscribe((results) => {
      setConversations(results);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <div
      className="w-full h-full overflow-auto"
      data-doc='{"icon":"mdi:message-text","title":"Conversation","desc":"View your conversation history. Toggle R (Raw) for original transcript or C (Clean) for sanitized text. Sessions are marked with timestamps."}'
    >
      <ConversationList conversations={conversations} />
    </div>
  );
};
