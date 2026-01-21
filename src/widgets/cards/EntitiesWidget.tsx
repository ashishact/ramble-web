import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import Entity from '../../db/models/Entity';
import { Q } from '@nozbe/watermelondb';
import { formatRelativeTime } from '../../program/utils';
import { Users, Settings } from 'lucide-react';
import { EntityManager } from '../../components/v2/EntityManager';

export const EntitiesWidget: React.FC<WidgetProps> = () => {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [showManager, setShowManager] = useState(false);

  useEffect(() => {
    const query = database
      .get<Entity>('entities')
      .query(Q.sortBy('lastMentioned', Q.desc), Q.take(50));

    const subscription = query.observe().subscribe((results) => {
      setEntities(results);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (entities.length === 0) {
    return (
      <>
        <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
          <Users className="w-8 h-8 mb-2 opacity-50" />
          <span className="text-sm">No entities yet</span>
          <span className="text-xs opacity-50 mt-1">People, places, things will appear here</span>
        </div>
        {showManager && <EntityManager onClose={() => setShowManager(false)} />}
      </>
    );
  }

  return (
    <>
      <div className="w-full h-full flex flex-col overflow-hidden">
        {/* Header with manage button */}
        <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center justify-between">
          <span className="text-[10px] text-slate-400">{entities.length} entities</span>
          <button
            onClick={() => setShowManager(true)}
            className="p-0.5 hover:bg-slate-100 rounded transition-colors"
            title="Manage entities"
          >
            <Settings size={12} className="text-slate-400" />
          </button>
        </div>

        {/* Entity list */}
        <div className="flex-1 overflow-auto p-1.5">
          {entities.map((entity, index) => {
            const isOdd = index % 2 === 1;
            return (
              <div
                key={entity.id}
                className={`px-2 py-1.5 rounded transition-colors ${
                  isOdd ? 'bg-slate-100/60' : 'bg-slate-50/40'
                } hover:bg-slate-100/80`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600 truncate">{entity.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-slate-200/50 text-slate-500 rounded shrink-0">
                    {entity.type}
                  </span>
                </div>
                {entity.description && (
                  <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">{entity.description}</p>
                )}
                <span className="text-[9px] text-slate-300 block mt-0.5">
                  {formatRelativeTime(entity.lastMentioned)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Entity Manager Modal */}
      {showManager && <EntityManager onClose={() => setShowManager(false)} />}
    </>
  );
};
