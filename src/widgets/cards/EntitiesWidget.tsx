import { useState, useEffect } from 'react';
import type { WidgetProps } from '../types';
import { entityStore } from '../../db/stores';
import type Entity from '../../db/models/Entity';
import { formatRelativeTime } from '../../program/utils';
import { Users } from 'lucide-react';

export const EntitiesWidget: React.FC<WidgetProps> = () => {
  const [entities, setEntities] = useState<Entity[]>([]);

  useEffect(() => {
    const loadEntities = async () => {
      const all = await entityStore.getAll();
      setEntities(all);
    };
    loadEntities();

    // Poll for updates
    const interval = setInterval(loadEntities, 5000);
    return () => clearInterval(interval);
  }, []);

  if (entities.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4">
        <Users className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No entities yet</span>
        <span className="text-xs opacity-50 mt-1">People, places, things will appear here</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-auto p-3">
      <div className="space-y-2">
        {entities.map((entity) => (
          <div
            key={entity.id}
            className="p-3 bg-white rounded-lg border border-slate-200 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">{entity.name}</span>
              <span className="text-[10px] px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full">
                {entity.type}
              </span>
            </div>
            {entity.description && (
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">{entity.description}</p>
            )}
            <span className="text-[10px] text-slate-400 block mt-1.5">
              {formatRelativeTime(entity.lastMentioned)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
