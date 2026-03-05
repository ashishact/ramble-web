import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import type { WidgetProps } from '../types';
import { database } from '../../db/database';
import KnowledgeNode from '../../db/models/KnowledgeNode';
import Entity from '../../db/models/Entity';
import { formatRelativeTime } from '../../program/utils';
import { eventBus } from '../../lib/eventBus';
import { GitBranch, ChevronRight, ChevronDown, Activity, Search, ArrowUpDown } from 'lucide-react';

// ============================================================================
// Tree Structure Builder
// ============================================================================

interface TreeItem {
  node: KnowledgeNode;
  children: TreeItem[];
}

function buildTreeFromFlatNodes(nodes: KnowledgeNode[]) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const childrenMap = new Map<string | null, KnowledgeNode[]>();

  for (const node of nodes) {
    const parentId = node.parentId;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(node);
  }

  // Sort children by sortOrder
  for (const [, kids] of childrenMap) {
    kids.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  function buildItem(node: KnowledgeNode): TreeItem {
    const kids = childrenMap.get(node.id) ?? [];
    return {
      node,
      children: kids.map(k => buildItem(k)),
    };
  }

  const roots = (childrenMap.get(null) ?? []).map(n => buildItem(n));
  return { roots, byId, childrenMap };
}

// ============================================================================
// Verification + NodeType styling
// ============================================================================

function verificationClass(v: string): string {
  switch (v) {
    case 'contradicted': return 'text-red-400/70 line-through';
    case 'unverified': return 'text-slate-400 opacity-60';
    default: return '';
  }
}

function nodeTypeBadge(t: string): string | null {
  switch (t) {
    case 'keyvalue': return 'KV';
    case 'table': return 'TBL';
    case 'reference': return 'REF';
    default: return null;
  }
}

// ============================================================================
// Node Detail Panel
// ============================================================================

const NodeDetail: React.FC<{ node: KnowledgeNode }> = ({ node }) => (
  <div className="bg-slate-50 border border-slate-200 rounded p-2 mt-0.5 mb-1 mx-2">
    <div className="flex items-center gap-2 mb-1">
      <span className="text-[10px] font-medium text-slate-700">{node.label}</span>
      <span className="text-[8px] px-1 rounded bg-slate-200/60 text-slate-500">{node.nodeType}</span>
    </div>
    {node.content ? (
      <p className="text-[10px] text-slate-600 whitespace-pre-wrap mb-1.5">{node.content}</p>
    ) : (
      <p className="text-[10px] text-slate-300 italic mb-1.5">(no content)</p>
    )}
    <div className="flex items-center gap-3 text-[8px] text-slate-400">
      <span>source: {node.source}</span>
      <span>verified: {node.verification}</span>
      {node.memoryIdsParsed.length > 0 && (
        <span>memories: {node.memoryIdsParsed.length}</span>
      )}
      <span>modified: {formatRelativeTime(node.modifiedAt)}</span>
      {node.templateKey && <span>template: {node.templateKey}</span>}
    </div>
  </div>
);

// ============================================================================
// Tree Node Row (recursive)
// ============================================================================

type HighlightType = 'new' | 'updated' | 'search';

interface CurationStatus {
  phase: 'idle' | 'thinking' | 'searching' | 'verifying' | 'applying' | 'complete' | 'error';
  entityName?: string;
  entityIds: string[];
  activeEntityId?: string;
  message?: string;
  startedAt?: number;
  elapsedMs?: number;
}

const CURATION_IDLE: CurationStatus = { phase: 'idle', entityIds: [] };

const TreeNodeRow: React.FC<{
  item: TreeItem;
  depth: number;
  expandedIds: Set<string>;
  detailNodeId: string | null;
  highlightedNodeIds: Map<string, HighlightType>;
  onToggle: (id: string) => void;
  onDetail: (id: string) => void;
}> = ({ item, depth, expandedIds, detailNodeId, highlightedNodeIds, onToggle, onDetail }) => {
  const { node, children } = item;
  const isGroup = children.length > 0 || node.nodeType === 'group';
  const isExpanded = expandedIds.has(node.id);
  const showDetail = detailNodeId === node.id;
  const highlightType = highlightedNodeIds.get(node.id);
  const badge = nodeTypeBadge(node.nodeType);
  const vClass = verificationClass(node.verification);

  const highlightClass = highlightType === 'new'
    ? 'bg-green-50/80 ring-1 ring-green-300 animate-pulse'
    : highlightType === 'updated'
    ? 'bg-blue-50/80 ring-1 ring-blue-300 animate-pulse'
    : highlightType === 'search'
    ? 'bg-amber-50/80 ring-1 ring-amber-300'
    : '';

  return (
    <>
      <div
        className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer hover:bg-slate-100/80 transition-colors ${highlightClass}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        onClick={() => isGroup ? onToggle(node.id) : onDetail(node.id)}
      >
        {/* Expand arrow for groups */}
        {isGroup ? (
          <button
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            className="w-3 text-center text-[10px] text-slate-400 shrink-0"
          >
            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {/* Label */}
        <span className={`text-[10px] font-medium text-slate-700 truncate ${vClass}`}>
          {node.label}
        </span>

        {/* Badge */}
        {badge && (
          <span className="text-[8px] px-1 rounded bg-slate-200/60 text-slate-500 shrink-0">{badge}</span>
        )}

        {/* Summary or child count */}
        {isGroup && !isExpanded && children.length > 0 ? (
          <span className="text-[9px] text-slate-400 truncate">
            ({children.length})
          </span>
        ) : !isGroup && node.summary ? (
          <span className={`text-[10px] text-slate-500 truncate ${vClass}`}>
            : {node.summary}
          </span>
        ) : !isGroup && !node.content ? (
          <span className="text-[10px] text-slate-300 italic">(empty)</span>
        ) : !isGroup && node.content ? (
          <span className={`text-[10px] text-slate-500 truncate ${vClass}`}>
            : {node.content.slice(0, 60)}
          </span>
        ) : null}
      </div>

      {/* Detail panel */}
      {showDetail && <NodeDetail node={node} />}

      {/* Children (when expanded) */}
      {isGroup && isExpanded && children.map(child => (
        <TreeNodeRow
          key={child.node.id}
          item={child}
          depth={depth + 1}
          expandedIds={expandedIds}
          detailNodeId={detailNodeId}
          highlightedNodeIds={highlightedNodeIds}
          onToggle={onToggle}
          onDetail={onDetail}
        />
      ))}
    </>
  );
};

// ============================================================================
// Entity Option
// ============================================================================

interface EntityOption {
  id: string;
  name: string;
  type: string;
  nodeCount: number;
  lastModified: number;
  createdAt: number;
}

// ============================================================================
// Entity Section (collapsible accordion item)
// ============================================================================

const EntitySection: React.FC<{
  entity: EntityOption;
  nodes: KnowledgeNode[];
  isExpanded: boolean;
  expandedIds: Set<string>;
  detailNodeId: string | null;
  highlightedNodeIds: Map<string, HighlightType>;
  curationStatus: CurationStatus;
  onToggleEntity: () => void;
  onToggleNode: (id: string) => void;
  onDetail: (id: string) => void;
  sectionRef: (el: HTMLDivElement | null) => void;
}> = ({ entity, nodes, isExpanded, expandedIds, detailNodeId, highlightedNodeIds, curationStatus, onToggleEntity, onToggleNode, onDetail, sectionRef }) => {
  const tree = useMemo(() => buildTreeFromFlatNodes(nodes), [nodes]);

  // Count highlighted nodes in this entity
  const highlightCount = useMemo(() => {
    let count = 0;
    for (const node of nodes) {
      if (highlightedNodeIds.has(node.id)) count++;
    }
    return count;
  }, [nodes, highlightedNodeIds]);

  return (
    <div ref={sectionRef} className="mb-0.5">
      {/* Entity header */}
      <div
        onClick={onToggleEntity}
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-slate-50 rounded transition-colors"
      >
        <span className="text-slate-400 shrink-0">
          {isExpanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </span>
        <span className="text-[11px] font-semibold text-slate-700 truncate">{entity.name}</span>
        <span className="text-[8px] px-1 rounded bg-slate-100 text-slate-500 shrink-0">{entity.type}</span>
        {curationStatus.phase !== 'idle' && (
          curationStatus.activeEntityId === entity.id && curationStatus.phase === 'applying' ? (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" title="Applying actions" />
          ) : curationStatus.entityIds.includes(entity.id) && ['thinking', 'searching', 'verifying'].includes(curationStatus.phase) ? (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" title="Curating" />
          ) : curationStatus.entityIds.includes(entity.id) && curationStatus.phase === 'complete' ? (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" title="Complete" />
          ) : null
        )}
        <span className="text-[9px] text-slate-400 shrink-0">{entity.nodeCount}</span>
        {highlightCount > 0 && (
          <span className="text-[8px] px-1 rounded-full bg-green-100 text-green-600 shrink-0 animate-pulse">
            +{highlightCount}
          </span>
        )}
        <span className="text-[9px] text-slate-300 ml-auto shrink-0">
          {formatRelativeTime(entity.lastModified)}
        </span>
      </div>

      {/* Tree body */}
      {isExpanded && (
        <div className="ml-1 border-l border-slate-100 pl-0.5">
          {tree.roots.length === 0 ? (
            <div className="text-[10px] text-slate-400 text-center py-2">No nodes</div>
          ) : (
            tree.roots.map(root => (
              <TreeNodeRow
                key={root.node.id}
                item={root}
                depth={0}
                expandedIds={expandedIds}
                detailNodeId={detailNodeId}
                highlightedNodeIds={highlightedNodeIds}
                onToggle={onToggleNode}
                onDetail={onDetail}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Activity Log
// ============================================================================

interface ActivityEntry {
  id: number;
  type: string;
  message: string;
  detail?: string;
  timestamp: number;
}

const ACTIVITY_COLORS: Record<string, string> = {
  'entity-created': 'text-green-500',
  'tree-created': 'text-green-500',
  'curation-complete': 'text-green-500',
  'curation-start': 'text-blue-500',
  'curation-llm-call': 'text-blue-500',
  'curation-llm-response': 'text-blue-500',
  'entity-resolved': 'text-blue-500',
  'curation-actions-applied': 'text-amber-500',
  'curation-action': 'text-slate-500',
  'curation-llm-error': 'text-red-500',
};

const ACTIVITY_ICONS: Record<string, string> = {
  'entity-created': '●',
  'tree-created': '●',
  'curation-complete': '✓',
  'curation-start': '◌',
  'curation-llm-call': '↗',
  'curation-llm-response': '↙',
  'entity-resolved': '●',
  'curation-actions-applied': '◆',
  'curation-action': '·',
  'curation-llm-error': '✗',
};

function formatLogTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const ActivityLog: React.FC<{
  entries: ActivityEntry[];
  isExpanded: boolean;
  onToggle: () => void;
}> = ({ entries, isExpanded, onToggle }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [entries.length, isExpanded]);

  return (
    <div className="flex-shrink-0 border-b border-slate-100">
      <div
        onClick={onToggle}
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-slate-50 transition-colors"
      >
        <Activity size={10} className="text-slate-400 shrink-0" />
        <span className="text-[10px] font-medium text-slate-500">Activity</span>
        {entries.length > 0 && (
          <span className="text-[9px] px-1 rounded-full bg-slate-100 text-slate-400">{entries.length}</span>
        )}
        <span className="text-slate-400 ml-auto shrink-0">
          {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </div>
      {isExpanded && (
        <div ref={scrollRef} className="max-h-[140px] overflow-auto px-1 pb-1">
          {entries.length === 0 ? (
            <div className="text-[9px] text-slate-300 text-center py-2">No activity yet</div>
          ) : (
            entries.map(entry => (
              <div key={entry.id} className="py-0.5 px-1">
                <div className="flex items-start gap-1">
                  <span className="text-[8px] text-slate-300 shrink-0 w-[52px] tabular-nums">
                    {formatLogTime(entry.timestamp)}
                  </span>
                  <span className={`text-[9px] shrink-0 w-3 text-center ${ACTIVITY_COLORS[entry.type] ?? 'text-slate-400'}`}>
                    {ACTIVITY_ICONS[entry.type] ?? '·'}
                  </span>
                  <span className="text-[9px] text-slate-600 truncate" title={entry.detail ?? entry.message}>
                    {entry.message}
                  </span>
                </div>
                {entry.detail && (
                  <div className="text-[8px] text-slate-400 ml-[68px] truncate">
                    {entry.detail}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Curation Status Bar
// ============================================================================

const PHASE_CONFIG = {
  thinking:  { icon: '◌', label: 'Thinking...',         border: 'border-blue-400',  text: 'text-blue-600',  bg: 'bg-blue-50/50',  pulse: true },
  searching: { icon: '◌', label: 'Searching trees...',  border: 'border-blue-400',  text: 'text-blue-600',  bg: 'bg-blue-50/50',  pulse: true },
  verifying: { icon: '◌', label: 'Verifying creates...', border: 'border-blue-400', text: 'text-blue-600',  bg: 'bg-blue-50/50',  pulse: true },
  applying:  { icon: '◆', label: 'Applying actions...',  border: 'border-amber-400', text: 'text-amber-600', bg: 'bg-amber-50/50', pulse: false },
  complete:  { icon: '✓', label: 'Done',                 border: 'border-green-400', text: 'text-green-600', bg: 'bg-green-50/50', pulse: false },
  error:     { icon: '✗', label: 'Failed',               border: 'border-red-400',   text: 'text-red-600',   bg: 'bg-red-50/50',   pulse: false },
} as const;

const CurationStatusBar: React.FC<{ status: CurationStatus }> = ({ status }) => {
  if (status.phase === 'idle') return null;

  const cfg = PHASE_CONFIG[status.phase];
  const elapsed = status.elapsedMs != null ? (status.elapsedMs / 1000).toFixed(1) : null;

  return (
    <div className={`flex-shrink-0 flex items-center gap-1.5 px-2 py-1 border-l-2 ${cfg.border} ${cfg.bg} ${cfg.pulse ? 'animate-pulse' : ''}`}>
      <span className={`text-[10px] ${cfg.text}`}>{cfg.icon}</span>
      <span className={`text-[10px] font-medium ${cfg.text}`}>{cfg.label}</span>
      {status.entityName && !['complete', 'error'].includes(status.phase) && (
        <span className="text-[9px] text-slate-500 truncate">· {status.entityName}</span>
      )}
      {status.phase === 'complete' && elapsed && (
        <span className="text-[9px] text-green-500">· {elapsed}s</span>
      )}
      {status.phase === 'error' && status.message && (
        <span className="text-[9px] text-red-400 truncate">· {status.message}</span>
      )}
    </div>
  );
};

// ============================================================================
// Main Widget
// ============================================================================

export const KnowledgeTreeWidget: React.FC<WidgetProps> = ({ config, onConfigChange }) => {
  const [allNodes, setAllNodes] = useState<KnowledgeNode[]>([]);
  const [entityOptions, setEntityOptions] = useState<EntityOption[]>([]);
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Map<string, HighlightType>>(new Map());
  const [filterEntityId, setFilterEntityId] = useState<string | null>(
    (config?.filterEntityId as string) ?? null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'updated' | 'name' | 'created'>(
    (config?.sortMode as 'updated' | 'name' | 'created') ?? 'updated'
  );
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [curationStatus, setCurationStatus] = useState<CurationStatus>(CURATION_IDLE);
  const activityIdRef = useRef(0);
  const curationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entityOptionsRef = useRef<EntityOption[]>([]);

  const prevNodeMapRef = useRef<Map<string, number>>(new Map());
  const entityCacheRef = useRef<Map<string, { name: string; type: string; createdAt: number }>>(new Map());
  const sectionRefsRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const allNodesRef = useRef<KnowledgeNode[]>([]);
  const initialLoadRef = useRef(true);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Group nodes by entity
  const nodesByEntity = useMemo(() => {
    const map = new Map<string, KnowledgeNode[]>();
    for (const node of allNodes) {
      const group = map.get(node.entityId);
      if (group) group.push(node);
      else map.set(node.entityId, [node]);
    }
    return map;
  }, [allNodes]);

  // Single subscription with change detection
  useEffect(() => {
    const subscription = database
      .get<KnowledgeNode>('knowledge_nodes')
      .query()
      .observe()
      .subscribe(rawNodes => {
        const active = rawNodes.filter(n => !n.metadataParsed?.deleted);

        // Change detection
        const currentMap = new Map(active.map(n => [n.id, n.modifiedAt]));
        const prev = prevNodeMapRef.current;
        const changedIds = new Map<string, HighlightType>();

        for (const [id, modifiedAt] of currentMap) {
          if (!prev.has(id)) changedIds.set(id, 'new');
          else if (prev.get(id) !== modifiedAt) changedIds.set(id, 'updated');
        }

        const isInitialLoad = initialLoadRef.current;
        prevNodeMapRef.current = currentMap;
        initialLoadRef.current = false;

        // Auto-expand and highlight on live changes (skip initial load)
        if (!isInitialLoad && changedIds.size > 0) {
          const byId = new Map(active.map(n => [n.id, n]));
          const toExpand = new Set<string>();
          const entityIdsToExpand = new Set<string>();

          for (const [nodeId] of changedIds) {
            const node = byId.get(nodeId);
            if (!node) continue;
            entityIdsToExpand.add(node.entityId);
            // Walk ancestor chain to auto-expand
            let current: KnowledgeNode | undefined = node;
            while (current?.parentId) {
              toExpand.add(current.parentId);
              current = byId.get(current.parentId);
            }
          }

          setExpandedIds(p => {
            const next = new Set(p);
            for (const id of toExpand) next.add(id);
            return next;
          });
          setExpandedEntities(p => {
            const next = new Set(p);
            for (const id of entityIdsToExpand) next.add(id);
            return next;
          });

          // Clear previous highlight timer
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          setHighlightedNodeIds(changedIds);
          highlightTimerRef.current = setTimeout(() => setHighlightedNodeIds(new Map()), 3000);
        }

        // Update refs and state
        allNodesRef.current = active;
        setAllNodes(active);

        // Resolve entity names (with cache)
        const entityMap = new Map<string, { count: number; lastModified: number }>();
        for (const n of active) {
          const existing = entityMap.get(n.entityId);
          if (existing) {
            existing.count++;
            existing.lastModified = Math.max(existing.lastModified, n.modifiedAt);
          } else {
            entityMap.set(n.entityId, { count: 1, lastModified: n.modifiedAt });
          }
        }

        const loadEntityNames = async () => {
          const options: EntityOption[] = [];
          for (const [entityId, stats] of entityMap) {
            const cached = entityCacheRef.current.get(entityId);
            if (cached) {
              options.push({ id: entityId, name: cached.name, type: cached.type, nodeCount: stats.count, lastModified: stats.lastModified, createdAt: cached.createdAt });
            } else {
              try {
                const entity = await database.get<Entity>('entities').find(entityId);
                const createdAt = entity.createdAt ?? 0;
                entityCacheRef.current.set(entityId, { name: entity.name, type: entity.type, createdAt });
                options.push({ id: entityId, name: entity.name, type: entity.type, nodeCount: stats.count, lastModified: stats.lastModified, createdAt });
              } catch {
                // Entity not found, skip
              }
            }
          }
          options.sort((a, b) => b.lastModified - a.lastModified);
          setEntityOptions(options);
          entityOptionsRef.current = options;
        };
        loadEntityNames();
      });

    return () => {
      subscription.unsubscribe();
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for navigate:entity events
  useEffect(() => {
    const unsub = eventBus.on('navigate:entity', ({ entityId }) => {
      setExpandedEntities(prev => new Set(prev).add(entityId));
      // Clear filter if it would hide this entity
      setFilterEntityId(prev => prev && prev !== entityId ? null : prev);
      // Scroll into view
      setTimeout(() => {
        sectionRefsRef.current.get(entityId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    });
    return unsub;
  }, []);

  // Listen for highlight:node events
  useEffect(() => {
    const unsub = eventBus.on('highlight:node', ({ nodeId }) => {
      const nodes = allNodesRef.current;
      const byId = new Map(nodes.map(n => [n.id, n]));
      const target = byId.get(nodeId);
      if (!target) return;

      // Expand entity section
      setExpandedEntities(prev => new Set(prev).add(target.entityId));
      // Clear filter if it would hide this entity
      setFilterEntityId(prev => prev && prev !== target.entityId ? null : prev);

      // Expand ancestor chain
      const toExpand = new Set<string>();
      let current: KnowledgeNode | undefined = target;
      while (current?.parentId) {
        toExpand.add(current.parentId);
        current = byId.get(current.parentId);
      }
      setExpandedIds(prev => {
        const next = new Set(prev);
        for (const id of toExpand) next.add(id);
        return next;
      });

      // Highlight node
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      setHighlightedNodeIds(new Map([[nodeId, 'updated']]));
      highlightTimerRef.current = setTimeout(() => setHighlightedNodeIds(new Map()), 3000);

      // Scroll entity section into view
      setTimeout(() => {
        sectionRefsRef.current.get(target.entityId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 100);
    });
    return unsub;
  }, []);

  // Subscribe to tree:activity events for activity log + curation status
  useEffect(() => {
    const unsub = eventBus.on('tree:activity', (payload) => {
      // Activity log entry (existing behaviour)
      const entry: ActivityEntry = {
        id: ++activityIdRef.current,
        type: payload.type,
        message: payload.message,
        detail: payload.detail,
        timestamp: payload.timestamp,
      };
      setActivityLog(prev => [entry, ...prev].slice(0, 50));

      // Derive curation status from event type
      switch (payload.type) {
        case 'curation-start': {
          if (curationTimerRef.current) clearTimeout(curationTimerRef.current);
          // Parse entity names from detail → match to IDs via entityOptionsRef
          const names = payload.detail?.split(', ') ?? [];
          const ids = names
            .map(name => entityOptionsRef.current.find(e => e.name === name)?.id)
            .filter((id): id is string => !!id);
          setCurationStatus({
            phase: 'thinking',
            entityName: payload.detail,
            entityIds: ids,
            startedAt: Date.now(),
          });
          break;
        }
        case 'curation-llm-call': {
          const msg = payload.message.toLowerCase();
          const phase: CurationStatus['phase'] =
            msg.includes('search loop') ? 'searching' :
            msg.includes('verification') ? 'verifying' : 'thinking';
          setCurationStatus(prev => ({ ...prev, phase, message: payload.message }));
          break;
        }
        case 'curation-action': {
          setCurationStatus(prev => {
            // Accumulate entityIds from action events
            const ids = payload.entityId && !prev.entityIds.includes(payload.entityId)
              ? [...prev.entityIds, payload.entityId]
              : prev.entityIds;
            return {
              ...prev,
              phase: 'applying',
              activeEntityId: payload.entityId,
              entityName: payload.entityName,
              entityIds: ids,
            };
          });
          break;
        }
        case 'curation-actions-applied': {
          setCurationStatus(prev => ({ ...prev, phase: 'applying', message: payload.message }));
          break;
        }
        case 'curation-complete': {
          setCurationStatus(prev => ({
            ...prev,
            phase: 'complete',
            message: payload.message,
            activeEntityId: undefined,
            elapsedMs: prev.startedAt ? Date.now() - prev.startedAt : undefined,
          }));
          curationTimerRef.current = setTimeout(() => {
            setCurationStatus(CURATION_IDLE);
          }, 3000);
          break;
        }
        case 'curation-llm-error': {
          if (curationTimerRef.current) clearTimeout(curationTimerRef.current);
          setCurationStatus(prev => ({
            ...prev,
            phase: 'error',
            message: payload.detail ?? payload.message,
            activeEntityId: undefined,
          }));
          break;
        }
      }
    });
    return () => {
      unsub();
      if (curationTimerRef.current) clearTimeout(curationTimerRef.current);
    };
  }, []);

  // Persist filter + sort to widget config
  useEffect(() => {
    if (onConfigChange) {
      onConfigChange({ ...config, filterEntityId, sortMode });
    }
  }, [filterEntityId, sortMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggleEntity = useCallback((entityId: string) => {
    setExpandedEntities(prev => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  }, []);

  const handleToggleNode = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDetail = useCallback((id: string) => {
    setDetailNodeId(prev => prev === id ? null : id);
  }, []);

  const setSectionRef = useCallback((entityId: string, el: HTMLDivElement | null) => {
    if (el) sectionRefsRef.current.set(entityId, el);
    else sectionRefsRef.current.delete(entityId);
  }, []);

  // Filter + search + sort entities to display
  const displayEntities = useMemo(() => {
    let list = entityOptions;

    // Narrow to single entity if filterEntityId set
    if (filterEntityId) {
      list = list.filter(e => e.id === filterEntityId);
    }

    // Search: match entity name OR node label/summary/content
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(entity => {
        if (entity.name.toLowerCase().includes(q)) return true;
        // Check nodes for this entity
        const nodes = nodesByEntity.get(entity.id);
        if (nodes) {
          return nodes.some(n =>
            n.label.toLowerCase().includes(q) ||
            (n.summary && n.summary.toLowerCase().includes(q)) ||
            (n.content && n.content.toLowerCase().includes(q))
          );
        }
        return false;
      });
    }

    // Sort
    const sorted = [...list];
    switch (sortMode) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'created':
        sorted.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'updated':
      default:
        sorted.sort((a, b) => b.lastModified - a.lastModified);
        break;
    }
    return sorted;
  }, [entityOptions, filterEntityId, searchQuery, sortMode, nodesByEntity]);

  // Search highlight: when search matches nodes, highlight them and auto-expand entity
  useEffect(() => {
    if (!searchQuery.trim()) return;
    const q = searchQuery.trim().toLowerCase();
    const matches = new Map<string, HighlightType>();
    const entitiesToExpand = new Set<string>();
    const nodesToExpand = new Set<string>();

    for (const [entityId, nodes] of nodesByEntity) {
      const byId = new Map(nodes.map(n => [n.id, n]));
      for (const node of nodes) {
        const matchesNode =
          node.label.toLowerCase().includes(q) ||
          (node.summary && node.summary.toLowerCase().includes(q)) ||
          (node.content && node.content.toLowerCase().includes(q));
        if (matchesNode) {
          matches.set(node.id, 'search');
          entitiesToExpand.add(entityId);
          // Walk ancestor chain to auto-expand
          let current: KnowledgeNode | undefined = node;
          while (current?.parentId) {
            nodesToExpand.add(current.parentId);
            current = byId.get(current.parentId);
          }
        }
      }
    }

    if (matches.size > 0) {
      setExpandedEntities(prev => {
        const next = new Set(prev);
        for (const id of entitiesToExpand) next.add(id);
        return next;
      });
      setExpandedIds(prev => {
        const next = new Set(prev);
        for (const id of nodesToExpand) next.add(id);
        return next;
      });
      setHighlightedNodeIds(matches);
    } else {
      setHighlightedNodeIds(new Map());
    }
  }, [searchQuery, nodesByEntity]); // eslint-disable-line react-hooks/exhaustive-deps

  // Global stats
  const stats = useMemo(() => {
    if (allNodes.length === 0) return null;
    const maxDepth = Math.max(...allNodes.map(n => n.depth));
    const lastModified = Math.max(...allNodes.map(n => n.modifiedAt));
    return { totalNodes: allNodes.length, entityCount: entityOptions.length, maxDepth, lastModified };
  }, [allNodes, entityOptions.length]);

  // Empty state
  if (entityOptions.length === 0) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4"
        data-doc='{"icon":"mdi:file-tree","title":"Knowledge Tree","desc":"Per-entity structured knowledge trees. Trees are created when entities have been mentioned 2+ times."}'
      >
        <GitBranch className="w-8 h-8 mb-2 opacity-50" />
        <span className="text-sm">No knowledge trees yet</span>
        <span className="text-xs opacity-50 mt-1">Trees appear after entities are mentioned 2+ times</span>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:file-tree","title":"Knowledge Tree","desc":"Multi-entity knowledge trees with live updates. All entity trees shown simultaneously."}'
    >
      {/* Header with search + sort */}
      <div className="flex-shrink-0 px-2 py-1 border-b border-slate-100 flex items-center gap-1.5">
        <GitBranch size={12} className="text-slate-400 shrink-0" />
        <div className="flex items-center gap-1 flex-1 min-w-0">
          <Search size={10} className="text-slate-400 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search entities & nodes..."
            className="text-[10px] text-slate-600 bg-transparent border-none outline-none flex-1 min-w-0 placeholder:text-slate-300"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-[9px] text-slate-400 hover:text-slate-600 shrink-0"
            >
              ✕
            </button>
          )}
        </div>
        <button
          onClick={() => setSortMode(prev =>
            prev === 'updated' ? 'name' : prev === 'name' ? 'created' : 'updated'
          )}
          className="flex items-center gap-0.5 text-[9px] text-slate-500 hover:text-slate-700 shrink-0 px-1 py-0.5 rounded hover:bg-slate-100 transition-colors"
          title={`Sort by: ${sortMode}`}
        >
          <ArrowUpDown size={9} />
          <span className="capitalize">{sortMode}</span>
        </button>
      </div>

      {/* Curation status bar */}
      <CurationStatusBar status={curationStatus} />

      {/* Activity log */}
      <ActivityLog
        entries={activityLog}
        isExpanded={activityExpanded}
        onToggle={() => setActivityExpanded(p => !p)}
      />

      {/* Entity sections */}
      <div className="flex-1 overflow-auto p-1">
        {displayEntities.map(entity => (
          <EntitySection
            key={entity.id}
            entity={entity}
            nodes={nodesByEntity.get(entity.id) ?? []}
            isExpanded={expandedEntities.has(entity.id)}
            expandedIds={expandedIds}
            detailNodeId={detailNodeId}
            highlightedNodeIds={highlightedNodeIds}
            curationStatus={curationStatus}
            onToggleEntity={() => handleToggleEntity(entity.id)}
            onToggleNode={handleToggleNode}
            onDetail={handleDetail}
            sectionRef={(el) => setSectionRef(entity.id, el)}
          />
        ))}
      </div>

      {/* Footer stats */}
      {stats && (
        <div className="flex-shrink-0 px-2 py-1 text-[9px] text-slate-400 border-t border-slate-100 flex items-center gap-3">
          <span>{stats.entityCount} entities</span>
          <span>{stats.totalNodes} nodes</span>
          <span>depth: {stats.maxDepth}</span>
          <span>last: {formatRelativeTime(stats.lastModified)}</span>
        </div>
      )}
    </div>
  );
};
