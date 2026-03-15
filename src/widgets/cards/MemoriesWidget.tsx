import { useState } from 'react';
import type { WidgetProps } from '../types';
import { useGraphData } from '../../graph/data';
import type { MemoryItem } from '../../graph/data';
import { formatRelativeTime } from '../../program/utils';
import { Brain, Settings } from 'lucide-react';
import { MemoryManager } from '../../components/v2/MemoryManager';

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

export const MemoriesWidget: React.FC<WidgetProps> = () => {
  const { data: memories } = useGraphData<MemoryItem>('memory', {
    limit: 20,
    orderBy: { field: 'lastReinforced', dir: 'desc' },
  });
  const [showManager, setShowManager] = useState(false);

  // Filter out superseded memories
  const activeMemories = memories.filter(m => m.state !== 'superseded' && !m.supersededBy);

  if (activeMemories.length === 0) {
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
            {activeMemories.length} memories
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
          {activeMemories.map((memory, index) => {
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
