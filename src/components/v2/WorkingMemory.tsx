/**
 * Working Memory - Shows full context being sent to LLM
 *
 * Fetches its own data using the same queries as contextBuilder.
 * This ensures the UI shows exactly what the LLM sees.
 */

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import { useKernel } from '../../program/hooks';
import {
  conversationStore,
  entityStore,
  topicStore,
  memoryStore,
  goalStore,
} from '../../db/stores';
import type Entity from '../../db/models/Entity';
import type Topic from '../../db/models/Topic';
import type Memory from '../../db/models/Memory';
import type Goal from '../../db/models/Goal';
import type Conversation from '../../db/models/Conversation';

interface WorkingMemoryProps {
  maxConversations?: number;
  maxEntities?: number;
  maxTopics?: number;
  maxMemories?: number;
  maxGoals?: number;
  // Optional refresh trigger - increment to force refresh
  refreshTrigger?: number;
}

// Compact time format
function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

type SectionType = 'conversations' | 'entities' | 'topics' | 'memories' | 'goals';

export function WorkingMemory({
  maxConversations = 10,
  maxEntities = 10,
  maxTopics = 5,
  maxMemories = 15,
  maxGoals = 5,
  refreshTrigger = 0,
}: WorkingMemoryProps) {
  // Get current session from kernel
  const { currentSession, isProcessing } = useKernel();
  const sessionId = currentSession?.id ?? null;

  const [expandedSection, setExpandedSection] = useState<SectionType | null>(null);
  const [loading, setLoading] = useState(true);

  // State for fetched data
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

  // Fetch data using same queries as contextBuilder
  const fetchData = useCallback(async () => {
    if (!sessionId) {
      setConversations([]);
      setEntities([]);
      setTopics([]);
      setMemories([]);
      setGoals([]);
      setLoading(false);
      return;
    }

    try {
      // Fetch all data in parallel - same queries as contextBuilder
      const [convs, ents, tops, mems, gls] = await Promise.all([
        conversationStore.getBySession(sessionId),
        entityStore.getRecent(maxEntities),
        topicStore.getRecent(maxTopics),
        memoryStore.getMostImportant(maxMemories),
        goalStore.getActive(),
      ]);

      // Apply same limits as contextBuilder
      setConversations(convs.slice(-maxConversations));
      setEntities(ents);
      setTopics(tops.slice(0, maxTopics));
      setMemories(mems);
      setGoals(gls.slice(0, maxGoals));
    } catch (error) {
      console.error('WorkingMemory: Failed to fetch data', error);
    } finally {
      setLoading(false);
    }
  }, [sessionId, maxConversations, maxEntities, maxTopics, maxMemories, maxGoals]);

  // Fetch on mount and when sessionId changes
  // Also refresh when processing completes (isProcessing goes from true to false)
  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger, isProcessing]);

  // Calculate total token estimate (rough)
  const estimatedTokens =
    conversations.reduce((sum, c) => sum + c.sanitizedText.length / 4, 0) +
    entities.length * 10 +
    topics.length * 8 +
    memories.reduce((sum, m) => sum + m.content.length / 4, 0) +
    goals.reduce((sum, g) => sum + g.statement.length / 4, 0);

  const toggleSection = (section: SectionType) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const SectionHeader = ({
    section,
    icon,
    title,
    count,
    max,
    color
  }: {
    section: SectionType;
    icon: string;
    title: string;
    count: number;
    max: number;
    color: string;
  }) => (
    <button
      className={`flex items-center justify-between w-full p-2 rounded-lg hover:bg-base-200 transition-colors ${
        expandedSection === section ? 'bg-base-200' : ''
      }`}
      onClick={() => toggleSection(section)}
    >
      <div className="flex items-center gap-2">
        <Icon icon={icon} className={`w-4 h-4 ${color}`} />
        <span className="font-medium text-sm">{title}</span>
        <span className="badge badge-ghost badge-xs">
          {count}/{max}
        </span>
      </div>
      <Icon
        icon={expandedSection === section ? 'mdi:chevron-up' : 'mdi:chevron-down'}
        className="w-4 h-4 opacity-50"
      />
    </button>
  );

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-base-200 to-base-100 rounded-lg border border-base-300 p-4">
        <div className="flex items-center gap-2 text-sm opacity-50">
          <Icon icon="mdi:loading" className="w-4 h-4 animate-spin" />
          Loading working memory...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-base-200 to-base-100 rounded-lg border border-base-300 overflow-hidden">
      {/* Header */}
      <div className="bg-base-300/50 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon icon="mdi:memory" className="w-5 h-5 text-primary" />
          <span className="font-bold">Working Memory</span>
          <span className="text-xs opacity-50">(LLM Context)</span>
        </div>
        <div className="flex items-center gap-2 text-xs opacity-60">
          <Icon icon="mdi:approximately-equal" className="w-4 h-4" />
          ~{Math.round(estimatedTokens)} tokens
        </div>
      </div>

      <div className="p-3 space-y-1">
        {/* Recent Conversations */}
        <SectionHeader
          section="conversations"
          icon="mdi:message-text"
          title="Recent Conversation"
          count={conversations.length}
          max={maxConversations}
          color="text-primary"
        />
        {expandedSection === 'conversations' && (
          <div className="ml-6 mb-2 space-y-1 text-sm">
            {conversations.length === 0 ? (
              <p className="text-xs opacity-50 italic">No conversation yet</p>
            ) : (
              conversations.map((c) => (
                <div key={c.id} className="flex gap-2 p-2 bg-base-100 rounded text-xs">
                  <span className={`font-mono ${c.speaker === 'user' ? 'text-primary' : 'text-secondary'}`}>
                    {c.speaker}:
                  </span>
                  <span className="flex-1 truncate">{c.sanitizedText}</span>
                  <span className="opacity-50 shrink-0">{timeAgo(c.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Known Entities */}
        <SectionHeader
          section="entities"
          icon="mdi:account-group"
          title="Known Entities"
          count={entities.length}
          max={maxEntities}
          color="text-info"
        />
        {expandedSection === 'entities' && (
          <div className="ml-6 mb-2 flex flex-wrap gap-1">
            {entities.length === 0 ? (
              <p className="text-xs opacity-50 italic">No entities yet</p>
            ) : (
              entities.map((e) => (
                <span key={e.id} className="badge badge-sm gap-1">
                  {e.name}
                  <span className="opacity-50">({e.type})</span>
                </span>
              ))
            )}
          </div>
        )}

        {/* Active Topics */}
        <SectionHeader
          section="topics"
          icon="mdi:tag-multiple"
          title="Active Topics"
          count={topics.length}
          max={maxTopics}
          color="text-secondary"
        />
        {expandedSection === 'topics' && (
          <div className="ml-6 mb-2 flex flex-wrap gap-1">
            {topics.length === 0 ? (
              <p className="text-xs opacity-50 italic">No topics yet</p>
            ) : (
              topics.map((t) => (
                <span key={t.id} className="badge badge-secondary badge-sm">
                  {t.name}
                  {t.category && <span className="opacity-50 ml-1">[{t.category}]</span>}
                </span>
              ))
            )}
          </div>
        )}

        {/* Working Memories */}
        <SectionHeader
          section="memories"
          icon="mdi:brain"
          title="Active Memories"
          count={memories.length}
          max={maxMemories}
          color="text-accent"
        />
        {expandedSection === 'memories' && (
          <div className="ml-6 mb-2 space-y-1">
            {memories.length === 0 ? (
              <p className="text-xs opacity-50 italic">No memories yet</p>
            ) : (
              memories.map((m) => (
                <div key={m.id} className="flex gap-2 p-2 bg-base-100 rounded text-xs">
                  <span className="badge badge-accent badge-xs shrink-0">{m.type}</span>
                  <span className="flex-1">{m.content}</span>
                  <span className="opacity-50 shrink-0">{Math.round(m.importance * 100)}%</span>
                </div>
              ))
            )}
          </div>
        )}

        {/* Active Goals */}
        <SectionHeader
          section="goals"
          icon="mdi:target"
          title="Active Goals"
          count={goals.length}
          max={maxGoals}
          color="text-success"
        />
        {expandedSection === 'goals' && (
          <div className="ml-6 mb-2 space-y-1">
            {goals.length === 0 ? (
              <p className="text-xs opacity-50 italic">No goals yet</p>
            ) : (
              goals.map((g) => (
                <div key={g.id} className="flex items-center gap-2 p-2 bg-base-100 rounded text-xs">
                  <span className={`badge badge-xs ${
                    g.status === 'achieved' ? 'badge-success' :
                    g.status === 'blocked' ? 'badge-error' :
                    'badge-info'
                  }`}>
                    {g.status}
                  </span>
                  <span className="flex-1">{g.statement}</span>
                  <span className="font-mono opacity-50">{g.progress}%</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer - summary */}
      <div className="bg-base-300/30 px-4 py-2 text-xs opacity-60 flex gap-4">
        <span>{conversations.length} convs</span>
        <span>{entities.length} entities</span>
        <span>{topics.length} topics</span>
        <span>{memories.length} memories</span>
        <span>{goals.length} goals</span>
      </div>
    </div>
  );
}
