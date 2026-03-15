import type { WidgetProps } from '../types';
import { useGraphCounts, useConversationCount } from '../../graph/data';
import { Users, Hash, Brain, Target, MessageSquare } from 'lucide-react';

export const StatsWidget: React.FC<WidgetProps> = () => {
  const { counts } = useGraphCounts(['entity', 'topic', 'memory', 'goal']);
  const { count: conversationCount } = useConversationCount();

  const statItems = [
    { label: 'Entities', value: counts.entity ?? 0, icon: Users, color: 'bg-purple-50 text-purple-600' },
    { label: 'Topics', value: counts.topic ?? 0, icon: Hash, color: 'bg-blue-50 text-blue-600' },
    { label: 'Memories', value: counts.memory ?? 0, icon: Brain, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Goals', value: counts.goal ?? 0, icon: Target, color: 'bg-orange-50 text-orange-600' },
    { label: 'Messages', value: conversationCount, icon: MessageSquare, color: 'bg-pink-50 text-pink-600' },
  ];

  return (
    <div
      className="w-full h-full overflow-auto p-3"
      data-doc='{"icon":"mdi:chart-box","title":"Stats","desc":"Overview of your data: entities (people, places, things), topics discussed, memories stored, active goals, and total messages in conversation."}'
    >
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
