import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { entityStore, topicStore, memoryStore, goalStore, conversationStore } from '../../db/stores';
import { Users, Hash, Brain, Target, MessageSquare } from 'lucide-react';

interface Stats {
  entities: number;
  topics: number;
  memories: number;
  goals: number;
  conversations: number;
}

export const StatsWidget: React.FC<WidgetProps> = () => {
  const [stats, setStats] = useState<Stats>({
    entities: 0,
    topics: 0,
    memories: 0,
    goals: 0,
    conversations: 0,
  });

  useEffect(() => {
    const loadStats = async () => {
      const [entities, topics, memories, goals, conversations] = await Promise.all([
        entityStore.getAll(),
        topicStore.getAll(),
        memoryStore.getMostImportant(100),
        goalStore.getActive(),
        conversationStore.getRecent(100),
      ]);

      setStats({
        entities: entities.length,
        topics: topics.length,
        memories: memories.length,
        goals: goals.length,
        conversations: conversations.length,
      });
    };
    loadStats();

    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const statItems = [
    { label: 'Entities', value: stats.entities, icon: Users, color: 'bg-purple-50 text-purple-600' },
    { label: 'Topics', value: stats.topics, icon: Hash, color: 'bg-blue-50 text-blue-600' },
    { label: 'Memories', value: stats.memories, icon: Brain, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Goals', value: stats.goals, icon: Target, color: 'bg-orange-50 text-orange-600' },
    { label: 'Messages', value: stats.conversations, icon: MessageSquare, color: 'bg-pink-50 text-pink-600' },
  ];

  return (
    <div className="w-full h-full overflow-auto p-3">
      <div className="grid grid-cols-2 gap-2">
        {statItems.map((item) => (
          <div
            key={item.label}
            className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm flex items-center gap-3"
          >
            <div className={`p-2 rounded-lg ${item.color}`}>
              <item.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-lg font-bold text-slate-700">{item.value}</p>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{item.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
