import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Topic from '../../db/models/Topic';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Hash, Settings } from 'lucide-react';
import { TopicManager } from '../../components/v2/TopicManager';

// Muted colors for topic categories
const categoryColors: Record<string, string> = {
  work: 'text-blue-400/70',
  personal: 'text-purple-400/70',
  hobby: 'text-amber-400/70',
  health: 'text-emerald-400/70',
  finance: 'text-cyan-400/70',
};

export const TopicsWidget: React.FC<WidgetProps> = () => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [showManager, setShowManager] = useState(false);

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
      <>
        <div
          className="w-full h-full flex flex-col items-center justify-center text-slate-300 p-2"
          data-doc='{"icon":"mdi:tag-multiple","title":"Topics","desc":"Subjects and themes discussed in your conversations. Topics are categorized (work, personal, hobby, etc.) and tracked by mention frequency."}'
        >
          <Hash className="w-5 h-5 mb-1 opacity-40" />
          <span className="text-[10px]">No topics yet</span>
        </div>
        {showManager && <TopicManager onClose={() => setShowManager(false)} />}
      </>
    );
  }

  return (
    <>
      <div
        className="w-full h-full flex flex-col overflow-hidden"
        data-doc='{"icon":"mdi:tag-multiple","title":"Topics","desc":"Subjects and themes discussed in your conversations. Shows mention count. Click the gear icon to manage topics."}'
      >
        {/* Header with manage button */}
        <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">{topics.length} topics</span>
          <button
            onClick={() => setShowManager(true)}
            className="p-0.5 hover:bg-slate-100 rounded transition-colors"
            title="Manage topics"
          >
            <Settings size={12} className="text-slate-400" />
          </button>
        </div>

        {/* Topic list */}
        <div className="flex-1 overflow-auto p-1.5">
          {topics.map((topic, index) => {
            const isOdd = index % 2 === 1;
            const catColor = categoryColors[topic.category ?? ''] || 'text-slate-400/70';
            return (
              <div
                key={topic.id}
                className={`px-2 py-1.5 rounded transition-colors ${
                  isOdd ? 'bg-slate-100/60' : 'bg-slate-50/40'
                } hover:bg-slate-100/80`}
              >
                <div className="flex items-start gap-1.5">
                  <Hash size={12} className={`flex-shrink-0 mt-0.5 ${catColor}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-slate-600 truncate">{topic.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-200/50 text-slate-500 rounded shrink-0">
                        {topic.mentionCount}
                      </span>
                    </div>
                    {topic.description && (
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{topic.description}</p>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {topic.category && (
                        <span className="text-[9px] text-slate-400">{topic.category}</span>
                      )}
                      <span className="text-[9px] text-slate-300">· {formatRelativeTime(topic.lastMentioned)}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Topic Manager Modal */}
      {showManager && <TopicManager onClose={() => setShowManager(false)} />}
    </>
  );
};
