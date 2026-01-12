import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { memoryStore } from '../../db/stores';
import type Memory from '../../db/models/Memory';
import { formatRelativeTime } from '../../program/utils';
import { Brain } from 'lucide-react';

export const MemoriesWidget: React.FC<WidgetProps> = () => {
  const [memories, setMemories] = useState<Memory[]>([]);

  useEffect(() => {
    const loadMemories = async () => {
      const important = await memoryStore.getMostImportant(20);
      setMemories(important);
    };
    loadMemories();

    // Poll for updates
    const interval = setInterval(loadMemories, 5000);
    return () => clearInterval(interval);
  }, []);

  if (memories.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
        <Brain className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No memories yet</span>
        <span className="text-xs opacity-50 mt-1">Memories will appear here</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-3">
      <div className="space-y-2">
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm"
          >
            <p className="text-sm text-slate-700">{memory.content}</p>
            <div className="flex items-center gap-2 mt-2">
              <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">
                {memory.importance}/10
              </span>
              <span className="text-[10px] text-slate-400">
                {formatRelativeTime(memory.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
