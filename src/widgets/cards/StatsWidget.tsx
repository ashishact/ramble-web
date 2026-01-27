import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Entity from '../../db/models/Entity';
import Topic from '../../db/models/Topic';
import Memory from '../../db/models/Memory';
import Goal from '../../db/models/Goal';
import Conversation from '../../db/models/Conversation';
import { Q } from '@nozbe/watermelondb';
import { combineLatest } from 'rxjs';
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
    const entities$ = database.get<Entity>('entities').query().observeCount();
    const topics$ = database.get<Topic>('topics').query().observeCount();
    const memories$ = database.get<Memory>('memories').query().observe();
    const goals$ = database.get<Goal>('goals').query(Q.where('status', 'active')).observeCount();
    const conversations$ = database.get<Conversation>('conversations').query().observeCount();

    const subscription = combineLatest([
      entities$,
      topics$,
      memories$,
      goals$,
      conversations$,
    ]).subscribe(([entityCount, topicCount, memoriesArr, goalCount, conversationCount]) => {
      // Filter active memories (not superseded)
      const activeMemories = memoriesArr.filter((m) => !m.supersededBy);
      setStats({
        entities: entityCount,
        topics: topicCount,
        memories: activeMemories.length,
        goals: goalCount,
        conversations: conversationCount,
      });
    });

    return () => subscription.unsubscribe();
  }, []);

  const statItems = [
    { label: 'Entities', value: stats.entities, icon: Users, color: 'bg-purple-50 text-purple-600' },
    { label: 'Topics', value: stats.topics, icon: Hash, color: 'bg-blue-50 text-blue-600' },
    { label: 'Memories', value: stats.memories, icon: Brain, color: 'bg-emerald-50 text-emerald-600' },
    { label: 'Goals', value: stats.goals, icon: Target, color: 'bg-orange-50 text-orange-600' },
    { label: 'Messages', value: stats.conversations, icon: MessageSquare, color: 'bg-pink-50 text-pink-600' },
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
