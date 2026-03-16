import { useState, useEffect, useSyncExternalStore, useRef, useCallback } from 'react';
import type { WidgetProps } from '../types';
import { useGraphData, useGraphCounts, useConversationCount, graphMutations } from '../../graph/data';
import type { KnowledgeNodeItem, EntityItem } from '../../graph/data';
import { backfillService, type BackfillLogEntry } from '../../program/knowledgeTree/backfill';
import { eventBus } from '../../lib/eventBus';
import { FlaskConical, Play, Pause, Square, RotateCcw, Download } from 'lucide-react';

// ============================================================================
// Action type → color mapping
// ============================================================================

const ACTION_COLORS: Record<string, string> = {
  edit: 'text-blue-600',
  create: 'text-green-600',
  delete: 'text-red-600',
  move: 'text-amber-600',
  merge: 'text-purple-600',
  rename: 'text-cyan-600',
  split: 'text-orange-600',
  skip: 'text-slate-400',
  error: 'text-red-500 font-bold',
};

// ============================================================================
// Stats Section
// ============================================================================

const TreeStats: React.FC = () => {
  const { counts } = useGraphCounts(['knowledge_node', 'timeline_event']);
  const knowledgeNodes = useGraphData<KnowledgeNodeItem>('knowledge_node', { limit: 5000 });

  const stats = (() => {
    const activeNodes = knowledgeNodes.data.filter(n => !(n.metadata as Record<string, unknown>)?.deleted);
    const entityIds = new Set(activeNodes.map(n => n.entityId));
    const depths = activeNodes.map(n => n.depth ?? 0);
    const avgDepth = depths.length > 0 ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
    const maxDepth = depths.length > 0 ? Math.max(...depths) : 0;
    return {
      totalNodes: activeNodes.length,
      totalTrees: entityIds.size,
      avgDepth: Math.round(avgDepth * 10) / 10,
      maxDepth,
      timelineEvents: counts['timeline_event'] ?? 0,
    };
  })();

  return (
    <div className="text-[9px] text-slate-400 flex flex-wrap gap-x-3 gap-y-0.5">
      <span>Trees: {stats.totalTrees}</span>
      <span>Nodes: {stats.totalNodes}</span>
      <span>Avg depth: {stats.avgDepth}</span>
      <span>Max depth: {stats.maxDepth}</span>
      <span>Timeline: {stats.timelineEvents}</span>
    </div>
  );
};

// ============================================================================
// Log Entry Row
// ============================================================================

const LogEntryRow: React.FC<{ entry: BackfillLogEntry }> = ({ entry }) => {
  const time = new Date(entry.timestamp);
  const timeStr = time.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const color = ACTION_COLORS[entry.actionType] ?? 'text-slate-500';

  return (
    <div
      className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-slate-50 cursor-pointer rounded"
      onClick={() => {
        if (entry.entityId) {
          eventBus.emit('navigate:entity', { entityId: entry.entityId });
          if (entry.nodeId) {
            eventBus.emit('highlight:node', { nodeId: entry.nodeId });
          }
        }
      }}
    >
      <span className="text-[8px] text-slate-300 shrink-0 font-mono">{timeStr}</span>
      <span className="text-[9px] text-slate-500 shrink-0 truncate max-w-[80px]">[{entry.entityName}]</span>
      <span className={`text-[9px] ${color} shrink-0 uppercase`}>{entry.actionType}</span>
      {entry.nodeLabel && (
        <span className="text-[8px] text-slate-400 truncate">{entry.nodeLabel}</span>
      )}
      {entry.detail && (
        <span className="text-[8px] text-slate-400 truncate italic">"{entry.detail}"</span>
      )}
    </div>
  );
};

// ============================================================================
// Main Widget
// ============================================================================

export const TreeDevToolsWidget: React.FC<WidgetProps> = () => {
  const state = useSyncExternalStore(backfillService.subscribe, backfillService.getState);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [delayMs, setDelayMs] = useState(backfillService.delayMs);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Read counts from DuckDB
  const { count: convCount } = useConversationCount();
  const { data: entities } = useGraphData<EntityItem>('entity', { limit: 1000 });
  const eligibleEntities = entities.filter(e => (e.mentionCount ?? 0) >= 3).length;

  // Auto-scroll log to bottom
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.log.length]);

  const handleStart = useCallback(() => {
    backfillService.delayMs = delayMs;
    backfillService.start();
  }, [delayMs]);

  const handleReset = useCallback(async () => {
    // Delete all knowledge nodes and timeline events from DuckDB
    const knowledgeNodes = await graphMutations.query<{ id: string }>(
      `SELECT id FROM nodes WHERE list_contains(labels, 'knowledge_node')`
    );
    const timelineEvents = await graphMutations.query<{ id: string }>(
      `SELECT id FROM nodes WHERE list_contains(labels, 'timeline_event')`
    );

    await graphMutations.batch(async () => {
      for (const n of knowledgeNodes) {
        await graphMutations.deleteNode(n.id);
      }
      for (const e of timelineEvents) {
        await graphMutations.deleteNode(e.id);
      }
    });

    setShowResetConfirm(false);
  }, []);

  const handleExport = useCallback(async () => {
    const nodes = await graphMutations.query<Record<string, unknown>>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'knowledge_node')`
    );
    const data = nodes.map(n => {
      const props = (n.properties ?? {}) as Record<string, unknown>;
      return {
        id: n.id,
        entityId: props.entityId,
        parentId: props.parentId,
        depth: props.depth,
        label: props.label,
        summary: props.summary,
        content: props.content,
        nodeType: props.nodeType,
        source: props.source,
        verification: props.verification,
        memoryIds: props.memoryIds,
        templateKey: props.templateKey,
      };
    });
    const json = JSON.stringify(data, null, 2);
    await navigator.clipboard.writeText(json);
  }, []);

  const isRunning = state.status === 'running';
  const isPaused = state.status === 'paused';
  const progressPct = state.totalCount > 0
    ? Math.round((state.processedCount / state.totalCount) * 100)
    : 0;

  const formatElapsed = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}m ${sec}s`;
  };

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:flask","title":"Tree Dev Tools","desc":"Testing panel for knowledge tree system. Run backfill, view curation logs, and monitor tree stats."}'
    >
      {/* Header */}
      <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center gap-1.5">
        <FlaskConical size={12} className="text-slate-400" />
        <span className="text-[10px] text-slate-500 font-medium">Tree Dev Tools</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-2 space-y-3">

        {/* Backfill Section */}
        <div>
          <div className="text-[9px] text-slate-400 font-medium mb-1">── Backfill ──</div>
          <div className="text-[9px] text-slate-500 mb-1.5">
            Conversations: {convCount} &nbsp; Entities eligible: {eligibleEntities} (≥3 mentions)
          </div>

          {/* Controls */}
          <div className="flex items-center gap-1.5 mb-1.5">
            {!isRunning && !isPaused ? (
              <button
                onClick={handleStart}
                className="flex items-center gap-1 px-2 py-0.5 text-[9px] bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
              >
                <Play size={10} /> Start
              </button>
            ) : (
              <>
                {isRunning ? (
                  <button
                    onClick={() => backfillService.pause()}
                    className="flex items-center gap-1 px-2 py-0.5 text-[9px] bg-amber-50 text-amber-700 rounded hover:bg-amber-100 transition-colors"
                  >
                    <Pause size={10} /> Pause
                  </button>
                ) : (
                  <button
                    onClick={() => backfillService.resume()}
                    className="flex items-center gap-1 px-2 py-0.5 text-[9px] bg-green-50 text-green-700 rounded hover:bg-green-100 transition-colors"
                  >
                    <Play size={10} /> Resume
                  </button>
                )}
                <button
                  onClick={() => backfillService.stop()}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] bg-red-50 text-red-700 rounded hover:bg-red-100 transition-colors"
                >
                  <Square size={10} /> Stop
                </button>
              </>
            )}

            {/* Delay slider */}
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[8px] text-slate-400">delay:</span>
              <input
                type="range"
                min={0}
                max={2000}
                step={100}
                value={delayMs}
                onChange={e => setDelayMs(Number(e.target.value))}
                className="w-16 h-2"
                disabled={isRunning || isPaused}
              />
              <span className="text-[8px] text-slate-400 w-8">{delayMs}ms</span>
            </div>
          </div>

          {/* Progress */}
          {(isRunning || isPaused || state.status === 'complete') && (
            <div className="space-y-1">
              {/* Progress bar */}
              <div className="w-full h-2 bg-slate-100 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-400 transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[8px] text-slate-400">
                <span>{state.processedCount}/{state.totalCount} ({progressPct}%)</span>
                <span>{formatElapsed(state.elapsedMs)}</span>
              </div>
              {state.currentConversationText && (
                <div className="text-[8px] text-slate-400 truncate">
                  Current: "{state.currentConversationText}"
                </div>
              )}
              <div className="text-[8px] text-slate-500">
                Trees: {state.stats.treesUpdated} &nbsp;
                Nodes created: {state.stats.nodesCreated} &nbsp;
                Errors: {state.stats.errors}
              </div>
              {Object.keys(state.stats.actionsApplied).length > 0 && (
                <div className="text-[8px] text-slate-400">
                  Actions: {Object.entries(state.stats.actionsApplied)
                    .map(([type, count]) => `${count} ${type}s`)
                    .join(', ')}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Curation Log */}
        {state.log.length > 0 && (
          <div>
            <div className="text-[9px] text-slate-400 font-medium mb-1">── Curation Log ──</div>
            <div className="max-h-40 overflow-auto border border-slate-100 rounded p-1">
              {state.log.slice(-50).map((entry, i) => (
                <LogEntryRow key={i} entry={entry} />
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* Stats */}
        <div>
          <div className="text-[9px] text-slate-400 font-medium mb-1">── Stats ──</div>
          <TreeStats />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {showResetConfirm ? (
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-red-500">Delete all trees?</span>
              <button
                onClick={handleReset}
                className="px-1.5 py-0.5 text-[9px] bg-red-50 text-red-600 rounded hover:bg-red-100"
              >
                Yes
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-1.5 py-0.5 text-[9px] bg-slate-50 text-slate-500 rounded hover:bg-slate-100"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-red-500 hover:bg-red-50 rounded transition-colors"
              disabled={isRunning || isPaused}
            >
              <RotateCcw size={10} /> Reset Trees
            </button>
          )}
          <button
            onClick={handleExport}
            className="flex items-center gap-1 px-2 py-0.5 text-[9px] text-slate-500 hover:bg-slate-50 rounded transition-colors"
          >
            <Download size={10} /> Export
          </button>
        </div>
      </div>
    </div>
  );
};
