/**
 * ConversationCompactView — Compact list view for narrow panels
 *
 * Wraps the existing ConversationList component.
 * Used when the conversation widget panel is < 480px wide.
 */

import type { ConversationRecord } from '../../graph/data';
import { ConversationList } from '../../components/v2/ConversationList';

interface ConversationCompactViewProps {
  conversations: ConversationRecord[];
}

export function ConversationCompactView({ conversations }: ConversationCompactViewProps) {
  return <ConversationList conversations={conversations} />;
}
