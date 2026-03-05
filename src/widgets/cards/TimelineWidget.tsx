import { useState, useEffect, useMemo } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import TimelineEvent from '../../db/models/TimelineEvent';
import Entity from '../../db/models/Entity';
import { Q } from '@nozbe/watermelondb';
import { eventBus } from '../../lib/eventBus';
import { Clock } from 'lucide-react';

// ============================================================================
// Day grouping helpers
// ============================================================================

function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayLabel(key: string): string {
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86400000);
  if (key === today) return 'Today';
  if (key === yesterday) return 'Yesterday';
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ============================================================================
// Time display based on granularity
// ============================================================================

function formatEventTime(timestamp: number, granularity: string): string {
  switch (granularity) {
    case 'exact':
      return new Date(timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    case 'day':
      return 'during the day';
    case 'week':
      return 'this week';
    case 'month':
      return new Date(timestamp).toLocaleDateString('en-US', { month: 'long' });
    case 'approximate':
      return '~' + new Date(timestamp).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    default:
      return '';
  }
}

// ============================================================================
// Entity Tag
// ============================================================================

const EntityTag: React.FC<{ entityId: string; name: string }> = ({ entityId, name }) => (
  <button
    onClick={(e) => {
      e.stopPropagation();
      eventBus.emit('navigate:entity', { entityId });
    }}
    className="text-[8px] px-1 py-0.5 rounded bg-slate-200/60 text-slate-500 hover:bg-slate-300/60 transition-colors cursor-pointer"
  >
    {name}
  </button>
);

// ============================================================================
// Event Row
// ============================================================================

const EventRow: React.FC<{
  event: TimelineEvent;
  entityNames: Map<string, string>;
}> = ({ event, entityNames }) => {
  const timeStr = formatEventTime(event.eventTime, event.timeGranularity);
  const entityIds = event.entityIdsParsed;

  return (
    <div className="py-1 px-1 hover:bg-slate-50 rounded transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-[9px] text-slate-400 shrink-0 w-16 text-right font-mono pt-0.5">
          {timeStr}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] text-slate-700">{event.title}</div>
          {entityIds.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {entityIds.map(eid => {
                const name = entityNames.get(eid);
                return name ? <EntityTag key={eid} entityId={eid} name={name} /> : null;
              })}
            </div>
          )}
          {event.significance && (
            <div className="text-[9px] text-slate-400 italic mt-0.5 truncate">
              &ldquo;{event.significance}&rdquo;
            </div>
          )}
          {event.timeGranularity === 'approximate' && (
            <span className="text-[8px] text-slate-300 italic">~approximate</span>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// Main Widget
// ============================================================================

export const TimelineWidget: React.FC<WidgetProps> = ({ config, onConfigChange }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [entityNames, setEntityNames] = useState<Map<string, string>>(new Map());
  const [filterEntityId, setFilterEntityId] = useState<string | null>(
    (config?.filterEntityId as string) ?? null
  );
  const [entityOptions, setEntityOptions] = useState<{ id: string; name: string }[]>([]);

  // Subscribe to timeline events
  useEffect(() => {
    const subscription = database
      .get<TimelineEvent>('timeline_events')
      .query(Q.sortBy('eventTime', Q.desc), Q.take(100))
      .observe()
      .subscribe(results => {
        const filtered = filterEntityId
          ? results.filter(e => e.entityIdsParsed.includes(filterEntityId))
          : results;
        setEvents(filtered);

        // Collect all entity IDs to resolve names
        const allIds = new Set<string>();
        for (const ev of results) {
          for (const eid of ev.entityIdsParsed) allIds.add(eid);
        }
        resolveEntityNames(allIds);
      });

    return () => subscription.unsubscribe();
  }, [filterEntityId]);

  // Resolve entity names
  const resolveEntityNames = async (ids: Set<string>) => {
    const names = new Map<string, string>();
    const options: { id: string; name: string }[] = [];
    for (const id of ids) {
      try {
        const entity = await database.get<Entity>('entities').find(id);
        names.set(id, entity.name);
        options.push({ id, name: entity.name });
      } catch {
        // Entity not found
      }
    }
    options.sort((a, b) => a.name.localeCompare(b.name));
    setEntityNames(names);
    setEntityOptions(options);
  };

  // Listen for navigate:entity events
  useEffect(() => {
    const unsub = eventBus.on('navigate:entity', ({ entityId }) => {
      setFilterEntityId(entityId);
    });
    return unsub;
  }, []);

  // Persist filter in widget config
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange({ ...config, filterEntityId });
    }
  }, [filterEntityId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Group events by day
  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const ev of events) {
      const key = dayKey(ev.eventTime);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(ev);
    }
    return map;
  }, [events]);

  // Stats
  const stats = useMemo(() => {
    if (events.length === 0) return null;
    const entitySet = new Set<string>();
    for (const ev of events) {
      for (const eid of ev.entityIdsParsed) entitySet.add(eid);
    }
    const oldest = events[events.length - 1]?.eventTime ?? 0;
    const newest = events[0]?.eventTime ?? 0;
    const spanDays = oldest > 0 ? Math.ceil((newest - oldest) / 86400000) : 0;
    return { count: events.length, entities: entitySet.size, spanDays };
  }, [events]);

  // Empty state
  if (events.length === 0 && !filterEntityId) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4"
        data-doc='{"icon":"mdi:clock-outline","title":"Timeline","desc":"Chronological timeline of events extracted from conversations. Events appear as the knowledge tree system processes data."}'
      >
        <Clock className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No timeline events yet</span>
        <span className="text-xs opacity-50 mt-1">Events are extracted during tree curation</span>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:clock-outline","title":"Timeline","desc":"Chronological timeline of events grouped by day, with entity filtering."}'
    >
      {/* Header with entity filter */}
      <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center gap-1.5">
        <Clock size={12} className="text-slate-400 shrink-0" />
        <select
          value={filterEntityId ?? ''}
          onChange={(e) => setFilterEntityId(e.target.value || null)}
          className="text-[10px] text-slate-600 bg-transparent border-none outline-none flex-1 cursor-pointer"
        >
          <option value="">All entities</option>
          {entityOptions.map(opt => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
      </div>

      {/* Event list grouped by day */}
      <div className="flex-1 overflow-auto p-1.5">
        {events.length === 0 ? (
          <div className="text-[10px] text-slate-400 text-center py-4">
            No events for this entity
          </div>
        ) : (
          [...grouped.entries()].map(([key, dayEvents]) => (
            <div key={key} className="mb-2">
              <div className="text-[9px] text-slate-400 font-medium px-1 mb-0.5 border-b border-slate-100/60">
                {dayLabel(key)}
              </div>
              {dayEvents.map(ev => (
                <EventRow key={ev.id} event={ev} entityNames={entityNames} />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer stats */}
      {stats && (
        <div className="flex-shrink-0 px-2 py-1 text-[9px] text-slate-400 border-t border-slate-100 flex items-center gap-3">
          <span>{stats.count} events</span>
          <span>{stats.entities} entities</span>
          <span>span: {stats.spanDays}d</span>
        </div>
      )}
    </div>
  );
};
