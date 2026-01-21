import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Memory from '../../db/models/Memory';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Brain } from 'lucide-react';

// Muted colors for memory types
const typeColors: Record<string, string> = {
  fact: 'text-blue-400/70',
  preference: 'text-purple-400/70',
  event: 'text-amber-400/70',
  relationship: 'text-emerald-400/70',
  insight: 'text-cyan-400/70',
};

export const MemoriesWidget: React.FC<WidgetProps> = () => {
  const [memories, setMemories] = useState<Memory[]>([]);

  useEffect(() => {
    // Query all memories sorted by importance, filter in subscriber
    const query = database
      .get<Memory>('memories')
      .query(Q.sortBy('importance', Q.desc));

    const subscription = query.observe().subscribe((results) => {
      // Filter out superseded memories and take top 20
      const active = results
        .filter((m) => !m.supersededBy)
        .slice(0, 20);
      setMemories(active);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (memories.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2">
        <Brain className="w-5 h-5 mb-1 opacity-40" />
        <span className="text-[10px]">No memories yet</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-1.5">
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
                  <span className="text-[9px] text-slate-300">· {memory.importance}/10</span>
                  <span className="text-[9px] text-slate-300">· {formatRelativeTime(memory.createdAt)}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
