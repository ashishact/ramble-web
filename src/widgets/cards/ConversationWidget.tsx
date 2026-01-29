import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { ConversationList } from '../../components/v2/ConversationList';
import { database } from '../../db/database';
import Conversation from '../../db/models/Conversation';
import { Q } from '@nozbe/watermelondb';
import { pipelineStatus, type PipelineState } from '../../program/kernel/pipelineStatus';

export const ConversationWidget: React.FC<WidgetProps> = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [pipelineDone, setPipelineDone] = useState(false);

  useEffect(() => {
    // Use WatermelonDB's reactive observation instead of polling
    const query = database
      .get<Conversation>('conversations')
      .query(Q.sortBy('timestamp', Q.desc), Q.take(50));

    // Subscribe to changes - WatermelonDB observer for new/deleted records
    // Note: Field updates (like processed=true) use pipelineStatus for instant feedback
    const subscription = query.observe().subscribe((results) => {
      setConversations(results);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Also subscribe to pipeline status for immediate UI feedback
  // WatermelonDB observer can have slight delay, so we use pipeline status
  // to show "done" immediately for the latest conversation
  useEffect(() => {
    const unsubscribe = pipelineStatus.subscribe((state: PipelineState) => {
      const doneStep = state.steps.find(s => s.id === 'done');
      setPipelineDone(!state.isRunning && doneStep?.status === 'success');
    });
    return unsubscribe;
  }, []);

  return (
    <div
      className="w-full h-full overflow-auto"
      data-doc='{"icon":"mdi:message-text","title":"Conversation","desc":"View your conversation history. Toggle R (Raw) for original transcript or C (Clean) for sanitized text. Sessions are marked with timestamps."}'
    >
      <ConversationList conversations={conversations} pipelineDone={pipelineDone} />
    </div>
  );
};
