import { useState, useEffect, useCallback } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Memory from '../../db/models/Memory';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Brain, Settings } from 'lucide-react';
import { MemoryManager } from '../../components/v2/MemoryManager';
import { eventBus } from '../../lib/eventBus';
import type { MemoryRef } from '../../program/WorkingMemory';

// Muted colors for memory types
const typeColors: Record<string, string> = {
  fact: 'text-blue-400/70',
  preference: 'text-purple-400/70',
  event: 'text-amber-400/70',
  relationship: 'text-emerald-400/70',
  insight: 'text-cyan-400/70',
  belief: 'text-orange-400/70',
  concern: 'text-red-400/70',
  intention: 'text-teal-400/70',
  decision: 'text-indigo-400/70',
};

// Unified display item — works for both MemoryRef (from System II) and Memory (from DB)
interface MemoryDisplayItem {
  id: string;
  content: string;
  type: string;
  confidence: number;
  lastReinforced: number;
  reinforcementCount: number;
  subject?: string;
  shortId?: string;
}

function fromMemoryRef(m: MemoryRef): MemoryDisplayItem {
  return {
    id: m.id,
    content: m.content,
    type: m.type,
    confidence: m.confidence,
    lastReinforced: m.lastReinforced,
    reinforcementCount: m.reinforcementCount,
    subject: m.subject,
    shortId: m.shortId,
  };
}

function fromMemoryModel(m: Memory): MemoryDisplayItem {
  return {
    id: m.id,
    content: m.content,
    type: m.type,
    confidence: m.confidence,
    lastReinforced: m.lastReinforced,
    reinforcementCount: m.reinforcementCount,
    subject: m.subject || undefined,
  };
}

export const MemoriesWidget: React.FC<WidgetProps> = () => {
  const [memories, setMemories] = useState<MemoryDisplayItem[]>([]);
  const [showManager, setShowManager] = useState(false);
  // Track whether we've received System II context yet
  const [hasLLMContext, setHasLLMContext] = useState(false);

  // Cold-start: load from DB until first System II event arrives
  const loadFromDB = useCallback(async () => {
    const results = await database
      .get<Memory>('memories')
      .query(
        Q.where('supersededBy', null),
        Q.sortBy('lastReinforced', Q.desc),
        Q.take(20)
      )
      .fetch();

    const active = results.filter((m) => m.state !== 'superseded');
    setMemories(active.map(fromMemoryModel));
  }, []);

  // Load from DB on mount
  useEffect(() => {
    loadFromDB();
  }, [loadFromDB]);

  // Subscribe to System II events — show the exact memories the LLM saw,
  // sorted by most recently reinforced at top (stack view).
  useEffect(() => {
    const unsub = eventBus.on('processing:system-ii', (payload) => {
      if (payload.context?.memories) {
        const sorted = [...payload.context.memories]
          .map(fromMemoryRef)
          .sort((a, b) => b.lastReinforced - a.lastReinforced);
        setMemories(sorted);
        setHasLLMContext(true);
      } else {
        // Recovery path — no context on event, refresh from DB
        loadFromDB();
      }
    });
    return unsub;
  }, [loadFromDB]);

  if (memories.length === 0) {
    return (
      <>
        <div
          className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2"
          data-doc='{"icon":"mdi:brain","title":"Memories","desc":"Shows memories relevant to the current conversation — the same context the AI sees. Updates after each processing step."}'
        >
          <Brain className="w-5 h-5 mb-1 opacity-40" />
          <span className="text-[10px]">No memories yet</span>
        </div>
        {showManager && <MemoryManager onClose={() => setShowManager(false)} />}
      </>
    );
  }

  return (
    <>
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        data-doc='{"icon":"mdi:brain","title":"Memories","desc":"Memories relevant to the current conversation context. Updates after each processing step. Click gear to manage."}'
      >
        {/* Header with manage button */}
        <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">
            {memories.length} memories{!hasLLMContext && ' · recent'}
          </span>
          <button
            onClick={() => setShowManager(true)}
            className="p-0.5 hover:bg-slate-100 rounded transition-colors"
            title="Manage memories"
          >
            <Settings size={12} className="text-slate-400" />
          </button>
        </div>

        {/* Memory list — stack view, newest at top */}
        <div className="flex-1 overflow-auto p-1.5">
          {memories.map((memory, index) => {
            const isOdd = index % 2 === 1;
            const typeColor = typeColors[memory.type] || 'text-slate-400/70';
            return (
              <div
                key={memory.id}
                className={`px-2 py-1.5 rounded transition-colors ${
                  isOdd ? 'bg-slate-100/60' : 'bg-slate-50/40'
                } hover:bg-slate-100/80`}
              >
                <div className="flex items-start gap-1.5">
                  <Brain size={12} className={`flex-shrink-0 mt-0.5 ${typeColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-600 leading-snug">{memory.content}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] text-slate-400">{memory.type}</span>
                      <span className="text-[9px] text-slate-300">· {Math.round(memory.confidence * 100)}%</span>
                      <span className="text-[9px] text-slate-300">· {formatRelativeTime(memory.lastReinforced)}</span>
                      {memory.reinforcementCount > 1 && (
                        <span className="text-[9px] text-slate-300">· ×{memory.reinforcementCount}</span>
                      )}
                      {memory.subject && (
                        <span className="text-[9px] text-slate-400">· {memory.subject}</span>
                      )}
                      {memory.shortId && (
                        <span className="text-[9px] text-slate-200 ml-auto">[{memory.shortId}]</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Memory Manager Modal */}
      {showManager && <MemoryManager onClose={() => setShowManager(false)} />}
    </>
  );
};
