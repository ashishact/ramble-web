import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Topic from '../../db/models/Topic';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Hash } from 'lucide-react';

export const TopicsWidget: React.FC<WidgetProps> = () => {
  const [topics, setTopics] = useState<Topic[]>([]);

  useEffect(() => {
    const query = database
      .get<Topic>('topics')
      .query(Q.sortBy('lastMentioned', Q.desc), Q.take(50));

    const subscription = query.observe().subscribe((results) => {
      setTopics(results);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (topics.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
        <Hash className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No topics yet</span>
        <span className="text-xs opacity-50 mt-1">Discussion topics will appear here</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-3">
      <div className="space-y-2">
        {topics.map((topic) => (
          <div
            key={topic.id}
            className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm"
          >
            <span className="text-sm font-medium text-slate-700">{topic.name}</span>
            {topic.description && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{topic.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full font-medium">
                {topic.mentionCount} mentions
              </span>
              <span className="text-[10px] text-slate-400">
                {formatRelativeTime(topic.lastMentioned)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
