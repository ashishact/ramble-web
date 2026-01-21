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
      className={`flex items-center justify-between w-full px-1.5 py-1 rounded hover:bg-base-200/50 transition-colors ${
        expandedSection === section ? 'bg-base-200/50' : ''
      }`}
      onClick={() => toggleSection(section)}
    >
      <div className="flex items-center gap-1.5">
        <Icon icon={icon} className={`w-3 h-3 ${color} opacity-70`} />
        <span className="font-medium text-[11px]">{title}</span>
        <span className="text-[9px] text-base-content/40">{count}/{max}</span>
      </div>
      <Icon
        icon={expandedSection === section ? 'mdi:chevron-up' : 'mdi:chevron-down'}
        className="w-3 h-3 opacity-30"
      />
    </button>
  );

  if (loading) {
    return (
      <div className="bg-base-100 rounded border border-base-200 p-2">
        <div className="flex items-center gap-1.5 text-[10px] opacity-40">
          <Icon icon="mdi:loading" className="w-3 h-3 animate-spin" />
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-base-100 rounded border border-base-200 overflow-hidden">
      {/* Header - Compact */}
      <div className="bg-base-200/30 px-2 py-1 flex items-center justify-between border-b border-base-200">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:memory" className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-medium text-[11px]">Working Memory</span>
        </div>
        <span className="text-[9px] opacity-40">~{Math.round(estimatedTokens)} tok</span>
      </div>

      <div className="p-1.5 space-y-0.5">
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
          <div className="ml-4 mb-1">
            {conversations.length === 0 ? (
              <p className="text-[9px] opacity-40 italic px-1">No conversation yet</p>
            ) : (
              conversations.map((c, i) => (
                <div key={c.id} className={`flex gap-1.5 px-1.5 py-1 rounded text-[10px] ${i % 2 === 1 ? 'bg-base-200/40' : ''}`}>
                  <span className={`font-mono shrink-0 ${c.speaker === 'user' ? 'text-primary/70' : 'text-secondary/70'}`}>
                    {c.speaker}:
                  </span>
                  <span className="flex-1 truncate text-base-content/70">{c.sanitizedText}</span>
                  <span className="opacity-40 shrink-0">{timeAgo(c.timestamp)}</span>
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
          <div className="ml-4 mb-1 flex flex-wrap gap-0.5 px-1">
            {entities.length === 0 ? (
              <p className="text-[9px] opacity-40 italic">No entities yet</p>
            ) : (
              entities.map((e) => (
                <span key={e.id} className="text-[9px] px-1.5 py-0.5 bg-base-200/50 rounded text-base-content/60">
                  {e.name} <span className="opacity-50">({e.type})</span>
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
          <div className="ml-4 mb-1 flex flex-wrap gap-0.5 px-1">
            {topics.length === 0 ? (
              <p className="text-[9px] opacity-40 italic">No topics yet</p>
            ) : (
              topics.map((t) => (
                <span key={t.id} className="text-[9px] px-1.5 py-0.5 bg-secondary/10 text-secondary/70 rounded">
                  {t.name}{t.category && <span className="opacity-50"> [{t.category}]</span>}
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
          <div className="ml-4 mb-1">
            {memories.length === 0 ? (
              <p className="text-[9px] opacity-40 italic px-1">No memories yet</p>
            ) : (
              memories.map((m, i) => (
                <div key={m.id} className={`flex gap-1.5 px-1.5 py-1 rounded text-[10px] ${i % 2 === 1 ? 'bg-base-200/40' : ''}`}>
                  <span className="text-accent/60 shrink-0">[{m.type}]</span>
                  <span className="flex-1 text-base-content/70">{m.content}</span>
                  <span className="opacity-40 shrink-0">{Math.round(m.importance * 100)}%</span>
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
          <div className="ml-4 mb-1">
            {goals.length === 0 ? (
              <p className="text-[9px] opacity-40 italic px-1">No goals yet</p>
            ) : (
              goals.map((g, i) => (
                <div key={g.id} className={`flex items-center gap-1.5 px-1.5 py-1 rounded text-[10px] ${i % 2 === 1 ? 'bg-base-200/40' : ''}`}>
                  <span className={`shrink-0 ${
                    g.status === 'achieved' ? 'text-success/60' :
                    g.status === 'blocked' ? 'text-error/60' :
                    'text-info/60'
                  }`}>
                    [{g.status}]
                  </span>
                  <span className="flex-1 text-base-content/70">{g.statement}</span>
                  <span className="font-mono opacity-40">{g.progress}%</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Footer - compact summary */}
      <div className="bg-base-200/20 px-2 py-1 text-[9px] opacity-40 flex gap-2 border-t border-base-200">
        <span>{conversations.length}c</span>
        <span>{entities.length}e</span>
        <span>{topics.length}t</span>
        <span>{memories.length}m</span>
        <span>{goals.length}g</span>
      </div>
    </div>
  );
}
