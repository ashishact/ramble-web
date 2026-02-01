import { useState, useEffect, useMemo } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Topic from '../../db/models/Topic';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Hash, Settings, ChevronRight } from 'lucide-react';
import { TopicManager } from '../../components/v2/TopicManager';

// Muted colors for topic domains
const domainColors: Record<string, string> = {
  Work: 'text-blue-400/70',
  Personal: 'text-purple-400/70',
  Health: 'text-emerald-400/70',
  Learning: 'text-amber-400/70',
  Uncategorized: 'text-slate-400/70',
};

// Parse namespace from topic name: "Domain / Topic"
function parseTopicNamespace(name: string): { domain: string; topic: string } {
  const parts = name.split(' / ').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { domain: 'Uncategorized', topic: name };
  }
  if (parts.length === 1) {
    return { domain: 'Uncategorized', topic: parts[0] };
  }
  return { domain: parts[0], topic: parts.slice(1).join(' / ') };
}

// Group topics by domain
function groupTopicsByDomain(topics: Topic[]): Map<string, Topic[]> {
  const groups = new Map<string, Topic[]>();
  for (const topic of topics) {
    const { domain } = parseTopicNamespace(topic.name);
    if (!groups.has(domain)) {
      groups.set(domain, []);
    }
    groups.get(domain)!.push(topic);
  }
  return groups;
}

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

  const groupedTopics = useMemo(() => groupTopicsByDomain(topics), [topics]);

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

        {/* Topic list grouped by domain */}
        <div className="flex-1 overflow-auto p-1.5">
          {Array.from(groupedTopics.entries()).map(([domain, domainTopics]) => {
            const domainColor = domainColors[domain] || 'text-slate-400/70';
            return (
              <div key={domain} className="mb-2 last:mb-0">
                {/* Domain header */}
                <div className="flex items-center gap-1 px-1 py-0.5 mb-1">
                  <ChevronRight size={10} className="text-slate-400" />
                  <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                    {domain}
                  </span>
                  <span className="text-[9px] text-slate-300">({domainTopics.length})</span>
                </div>
                {/* Topics in domain */}
                {domainTopics.map((topic, index) => {
                  const { topic: displayName } = parseTopicNamespace(topic.name);
                  const isOdd = index % 2 === 1;
                  return (
                    <div
                      key={topic.id}
                      className={`px-2 py-1.5 ml-2 rounded transition-colors ${
                        isOdd ? 'bg-slate-100/60' : 'bg-slate-50/40'
                      } hover:bg-slate-100/80`}
                    >
                      <div className="flex items-start gap-1.5">
                        <Hash size={12} className={`flex-shrink-0 mt-0.5 ${domainColor}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-slate-600 truncate">{displayName}</span>
                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-200/50 text-slate-500 rounded shrink-0">
                              {topic.mentionCount}
                            </span>
                          </div>
                          {topic.description && (
                            <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{topic.description}</p>
                          )}
                          <span className="text-[9px] text-slate-300">{formatRelativeTime(topic.lastMentioned)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
