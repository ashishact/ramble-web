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

// Compact datetime format for Working Memory UI: "FEB-01 08:44" (MON-DD HH:mm)
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function formatCompactDateTime(timestamp: number, includeSeconds = false): string {
  const d = new Date(timestamp);
  const base = `${MONTHS[d.getMonth()]}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return includeSeconds ? `${base}:${String(d.getSeconds()).padStart(2, '0')}` : base;
}

type SectionType = 'userInfo' | 'conversations' | 'entities' | 'topics' | 'memories' | 'goals';

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

type ViewTab = 'data' | 'prompts';

export function WorkingMemory({
  refreshTrigger = 0,
}: WorkingMemoryProps) {
  const [contextSize, setContextSize] = useState<ContextSize>('medium');
  const [expandedSection, setExpandedSection] = useState<SectionType | null>(null);
  const [activeTab, setActiveTab] = useState<ViewTab>('data');

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
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Icon icon="mdi:memory" className="w-3.5 h-3.5 text-primary/60" />
            <span className="font-medium text-[11px]">Working Memory</span>
          </div>
          {/* Tab selector */}
          <div className="flex gap-0.5 ml-2">
            <button
              onClick={() => setActiveTab('data')}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                activeTab === 'data'
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-base-content/40 hover:bg-base-200/50'
              }`}
            >
              Data
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`px-1.5 py-0.5 text-[9px] rounded transition-colors ${
                activeTab === 'prompts'
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-base-content/40 hover:bg-base-200/50'
              }`}
            >
              Prompts
            </button>
          </div>
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

      {/* Prompts View */}
      {activeTab === 'prompts' && data && (
        <div className="p-2 space-y-3 max-h-96 overflow-auto">
          {/* Context (goes into system prompt area - cacheable) */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon icon="mdi:file-document" className="w-3 h-3 text-info/70" />
              <span className="text-[10px] font-medium text-info/80">Context (Cacheable)</span>
            </div>
            <pre className="text-[9px] bg-base-200/50 p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono text-base-content/70 border border-base-300">
              {workingMemory.formatForLLM(data)}
            </pre>
          </div>

          {/* User Prompt Prefix (dynamic - includes current time) */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <Icon icon="mdi:clock-outline" className="w-3 h-3 text-warning/70" />
              <span className="text-[10px] font-medium text-warning/80">User Prompt Prefix (Dynamic)</span>
            </div>
            <pre className="text-[9px] bg-base-200/50 p-2 rounded overflow-x-auto whitespace-pre-wrap font-mono text-base-content/70 border border-base-300">
              {`Current time: ${data.userContext.currentTime}`}
            </pre>
          </div>

          {/* Info */}
          <p className="text-[9px] text-base-content/40 italic">
            The context is static and cacheable. Current time is added to the user prompt (dynamic).
          </p>
        </div>
      )}

      {/* Data View */}
      {activeTab === 'data' && (
      <div className="p-1.5 space-y-0.5">
        {/* User Info */}
        <SectionHeader
          section="userInfo"
          icon="mdi:account"
          title="User Info"
          count={data?.userContext.userName ? 1 : 0}
          max={1}
          color="text-warning"
          isExpanded={expandedSection === 'userInfo'}
          onToggle={toggleSection}
        />
        {expandedSection === 'userInfo' && data && (
          <div className="ml-4 mb-1 px-1.5 py-1 text-[10px] space-y-1">
            <div className="flex gap-2">
              <span className="text-base-content/50">Name:</span>
              <span className="text-base-content/70">{data.userContext.userName || <span className="italic opacity-40">Not set</span>}</span>
            </div>
            <div className="flex gap-2">
              <span className="text-base-content/50">Current time:</span>
              <span className="text-base-content/70 font-mono text-[9px]">{data.userContext.currentTime}</span>
            </div>
          </div>
        )}

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
                  <span className="font-mono shrink-0 text-primary/60 text-[9px]">
                    {formatCompactDateTime(c.timestamp, true)}
                  </span>
                  <span className="flex-1 truncate text-base-content/70">{c.text}</span>
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
          <div className="ml-4 mb-1">
            {entities.length === 0 ? (
              <p className="text-[9px] opacity-40 italic px-1">No entities yet</p>
            ) : (
              entities.map((e, i) => (
                <div key={e.id} className={`flex gap-1.5 px-1.5 py-1 rounded text-[10px] ${i % 2 === 1 ? 'bg-base-200/40' : ''}`}>
                  <span className="font-mono shrink-0 text-info/60 text-[9px]">{formatCompactDateTime(e.lastMentioned)}</span>
                  <span className="text-base-content/70">{e.name}</span>
                  <span className="text-base-content/40">({e.type})</span>
                </div>
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
          <div className="ml-4 mb-1">
            {topics.length === 0 ? (
              <p className="text-[9px] opacity-40 italic px-1">No topics yet</p>
            ) : (
              topics.map((t, i) => (
                <div key={t.id} className={`flex gap-1.5 px-1.5 py-1 rounded text-[10px] ${i % 2 === 1 ? 'bg-base-200/40' : ''}`}>
                  <span className="font-mono shrink-0 text-secondary/60 text-[9px]">{formatCompactDateTime(t.lastMentioned)}</span>
                  <span className="text-base-content/70">{t.name}</span>
                  {t.category && <span className="text-base-content/40">[{t.category}]</span>}
                </div>
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
                  <span className="font-mono shrink-0 text-accent/60 text-[9px]">{formatCompactDateTime(m.lastReinforced)}</span>
                  <span className="flex-1 text-base-content/70 truncate">{m.content}</span>
                  <span className="text-accent/50 shrink-0 text-[9px]">[{m.type}]</span>
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
                  <span className="font-mono shrink-0 text-success/60 text-[9px]">{formatCompactDateTime(g.lastReferenced)}</span>
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
      )}

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
