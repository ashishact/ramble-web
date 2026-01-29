/**
 * Working Memory - Shows full context being sent to LLM
 *
 * Uses the unified WorkingMemory class to fetch data, ensuring
 * the UI shows exactly what the LLM sees (including deduplication).
 *
 * Reactivity: Refreshes when pipeline completes (data saved to DB).
 */

import { useState, useEffect, useCallback } from 'react';
import { Icon } from '@iconify/react';
import {
  workingMemory,
  type WorkingMemoryData,
  type ContextSize,
} from '../../program/WorkingMemory';
import { pipelineStatus, type PipelineState } from '../../program/kernel/pipelineStatus';

interface WorkingMemoryProps {
  // Optional refresh trigger - increment to force refresh
  refreshTrigger?: number;
}

const SIZE_CONFIG: Record<ContextSize, {
  label: string;
  doc: string;
}> = {
  small: {
    label: 'S',
    doc: '{"icon":"mdi:size-s","title":"Small Context","desc":"Minimal context: 5 conversations, 15 entities, 5 topics, 5 memories, 3 goals. Faster, lower token usage."}',
  },
  medium: {
    label: 'M',
    doc: '{"icon":"mdi:size-m","title":"Medium Context","desc":"Balanced context: 10 conversations, 15 entities, 10 topics, 10 memories, 5 goals. Good for most use cases."}',
  },
  large: {
    label: 'L',
    doc: '{"icon":"mdi:size-l","title":"Large Context","desc":"Maximum context: 15 conversations, 15 entities, 15 topics, 20 memories, 10 goals. More comprehensive but higher token usage."}',
  },
};

// Size limits (mirrors WorkingMemory.ts SIZE_LIMITS for display)
const SIZE_LIMITS: Record<ContextSize, {
  conversations: number;
  entities: number;
  topics: number;
  memories: number;
  goals: number;
}> = {
  small:  { conversations: 5,  entities: 15, topics: 5,  memories: 5,  goals: 3  },
  medium: { conversations: 10, entities: 15, topics: 10, memories: 10, goals: 5  },
  large:  { conversations: 15, entities: 15, topics: 15, memories: 20, goals: 10 },
};

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

// Moved outside to prevent remount on every render
function SectionHeader({
  section,
  icon,
  title,
  count,
  max,
  color,
  isExpanded,
  onToggle,
}: {
  section: SectionType;
  icon: string;
  title: string;
  count: number;
  max: number;
  color: string;
  isExpanded: boolean;
  onToggle: (section: SectionType) => void;
}) {
  return (
    <button
      className={`flex items-center justify-between w-full px-1.5 py-1 rounded hover:bg-base-200/50 transition-colors ${
        isExpanded ? 'bg-base-200/50' : ''
      }`}
      onClick={() => onToggle(section)}
    >
      <div className="flex items-center gap-1.5">
        <Icon icon={icon} className={`w-3 h-3 ${color} opacity-70`} />
        <span className="font-medium text-[11px]">{title}</span>
        <span className="text-[9px] text-base-content/40">{count}/{max}</span>
      </div>
      <Icon
        icon={isExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'}
        className="w-3 h-3 opacity-30"
      />
    </button>
  );
}

export function WorkingMemory({
  refreshTrigger = 0,
}: WorkingMemoryProps) {
  const [contextSize, setContextSize] = useState<ContextSize>('medium');
  const [expandedSection, setExpandedSection] = useState<SectionType | null>(null);

  // Single source of truth: WorkingMemoryData from workingMemory.fetch()
  const [data, setData] = useState<WorkingMemoryData | null>(null);

  // Fetch data using the unified WorkingMemory class
  // No session filtering - fetches all conversations chronologically
  const fetchData = useCallback(async () => {
    const result = await workingMemory.fetch({
      size: contextSize,
    });
    setData(result);
  }, [contextSize]);

  // Fetch on mount, when size changes, or when session changes
  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  // Subscribe to pipeline status - refresh when pipeline completes
  useEffect(() => {
    let wasRunning = false;

    const unsubscribe = pipelineStatus.subscribe((state: PipelineState) => {
      const isNowComplete = !state.isRunning;
      const doneStep = state.steps.find(s => s.id === 'done');
      const isSuccess = doneStep?.status === 'success';

      // Refresh when pipeline transitions from running to complete (success)
      if (wasRunning && isNowComplete && isSuccess) {
        fetchData();
      }

      wasRunning = state.isRunning;
    });

    return unsubscribe;
  }, [fetchData]);

  // Get limits for display
  const limits = SIZE_LIMITS[contextSize];

  // Extract data for rendering (with fallbacks)
  const conversations = data?.conversations ?? [];
  const entities = data?.entities ?? [];
  const topics = data?.topics ?? [];
  const memories = data?.memories ?? [];
  const goals = data?.goals ?? [];
  const estimatedTokens = data?.meta.estimatedTokens ?? 0;

  const toggleSection = (section: SectionType) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="bg-base-100 rounded border border-base-200 overflow-hidden">
      {/* Header - Compact */}
      <div className="bg-base-200/30 px-2 py-1 flex items-center justify-between border-b border-base-200">
        <div className="flex items-center gap-1.5">
          <Icon icon="mdi:memory" className="w-3.5 h-3.5 text-primary/60" />
          <span className="font-medium text-[11px]">Working Memory</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Size selector */}
          <div className="flex gap-0.5">
            {(Object.entries(SIZE_CONFIG) as [ContextSize, typeof SIZE_CONFIG[ContextSize]][]).map(([size, config]) => (
              <button
                key={size}
                onClick={() => setContextSize(size)}
                className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                  contextSize === size
                    ? 'bg-primary/20 text-primary font-medium'
                    : 'text-base-content/40 hover:bg-base-200/50'
                }`}
                data-doc={config.doc}
              >
                {config.label}
              </button>
            ))}
          </div>
          <span className="text-[9px] opacity-40">~{Math.round(estimatedTokens)} tok</span>
        </div>
      </div>

      <div className="p-1.5 space-y-0.5">
        {/* Recent Conversations */}
        <SectionHeader
          section="conversations"
          icon="mdi:message-text"
          title="Recent Conversation"
          count={conversations.length}
          max={limits.conversations}
          color="text-primary"
          isExpanded={expandedSection === 'conversations'}
          onToggle={toggleSection}
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
                  <span className="flex-1 truncate text-base-content/70">{c.text}</span>
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
          max={limits.entities}
          color="text-info"
          isExpanded={expandedSection === 'entities'}
          onToggle={toggleSection}
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
          max={limits.topics}
          color="text-secondary"
          isExpanded={expandedSection === 'topics'}
          onToggle={toggleSection}
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
          max={limits.memories}
          color="text-accent"
          isExpanded={expandedSection === 'memories'}
          onToggle={toggleSection}
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
          max={limits.goals}
          color="text-success"
          isExpanded={expandedSection === 'goals'}
          onToggle={toggleSection}
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
                    [{g.shortId}]
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
