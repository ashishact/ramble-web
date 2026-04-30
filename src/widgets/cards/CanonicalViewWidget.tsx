/**
 * CanonicalViewWidget
 *
 * Displays the canonical view — the synthesised picture of what the user
 * cares about, organised by domain with priorities, statuses, and
 * natural-language concept descriptions built by System 3.
 *
 * Fetches from: GET /api/v1/store/ramble/views/canonical
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { WidgetProps } from '../types';
import { storeGet } from '../../services/rambleApi';
import { profileStorage } from '../../lib/profileStorage';

const CACHE_ALL_KEY = 'cache:canonical-all';
const CACHE_TODAY_KEY = 'cache:canonical-today';
import {
  Layers,
  RefreshCw,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Target,
  ParkingCircle,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type Priority = 'critical' | 'high' | 'medium' | 'low';
type Status   = 'open' | 'in_progress' | 'resolved' | 'parked';
type ConceptType = 'situation' | 'goal' | 'decision' | 'concern' | 'idea' | 'belief' | 'process';

interface Concept {
  id: string;
  label: string;
  description: string;   // normalised from `detail` in old format
  type: ConceptType;
  priority: Priority;
  status: Status;
  recurrenceCount: number;
  firstSeen: string;
  lastSeen: string;
  signals: string[];     // normalised from `tags` in old format
  conflict: boolean;
  conflictNote: string | null;
}

interface Domain {
  id: string;
  label: string;
  priority: Priority;
  concepts: Concept[];   // normalised from `items` in old format
}

interface CanonicalViewSummary {
  oneLiner: string;
  biggestOpenDecision: string;
  canPark: string;
}

interface CanonicalView {
  generatedAt: string;
  mergedDates: string[];
  totalConcepts: number;
  summary: CanonicalViewSummary;
  domains: Domain[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}


// ── Normalise raw API response ────────────────────────────────────────────────
// Handles three shapes:
//   1. Global view  — { domains: [{concepts:[]}] }
//   2. Old format   — { domains: [{items:[]}] }
//   3. Daily delta  — { date, concepts: [{domain, ...}] } (flat list)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseConcept(c: any, date?: string): Concept {
  return {
    id: c.id ?? '',
    label: c.label ?? '',
    description: c.description ?? c.detail ?? '',
    type: c.type ?? 'situation',
    priority: c.priority ?? 'medium',
    status: c.status ?? 'open',
    recurrenceCount: c.recurrenceCount ?? 1,
    firstSeen: c.firstSeen ?? c.sourceDate ?? date ?? '',
    lastSeen: c.lastSeen ?? c.sourceDate ?? date ?? '',
    signals: c.signals ?? c.tags ?? [],
    conflict: c.conflict ?? false,
    conflictNote: c.conflictNote ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalise(raw: any): CanonicalView {
  // Daily delta — flat concepts array with a `domain` field on each concept
  if (raw.date && Array.isArray(raw.concepts) && !raw.domains) {
    const byDomain = new Map<string, { label: string; concepts: Concept[] }>();
    const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low'];
    for (const c of raw.concepts) {
      const domainId: string = c.domain ?? 'other';
      const domainLabel: string = c.domainLabel ?? domainId.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase());
      if (!byDomain.has(domainId)) byDomain.set(domainId, { label: domainLabel, concepts: [] });
      byDomain.get(domainId)!.concepts.push(normaliseConcept(c, raw.date));
    }
    const domains: Domain[] = Array.from(byDomain.entries()).map(([id, { label, concepts }]) => {
      const topPriority = concepts.reduce<Priority>((best, c) => {
        return PRIORITY_ORDER.indexOf(c.priority) < PRIORITY_ORDER.indexOf(best) ? c.priority : best;
      }, 'low');
      return { id, label, priority: topPriority, concepts };
    });
    domains.sort((a, b) => PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority));
    return {
      generatedAt: raw.extractedAt ?? raw.date ?? '',
      mergedDates: [raw.date],
      totalConcepts: raw.concepts.length,
      summary: { oneLiner: '', biggestOpenDecision: '', canPark: '' },
      domains,
    };
  }

  // Global / old format — domain-grouped
  const domains: Domain[] = (raw.domains ?? []).map((d: any) => {
    const items: any[] = d.concepts ?? d.items ?? [];
    return {
      id: d.id ?? '',
      label: d.label ?? '',
      priority: d.priority ?? 'medium',
      concepts: items.map((c: any) => normaliseConcept(c)),
    };
  });

  return {
    generatedAt: raw.generatedAt ?? '',
    mergedDates: raw.mergedDates ?? [],
    totalConcepts: raw.totalConcepts ?? raw.totalItems ?? domains.reduce((n, d) => n + d.concepts.length, 0),
    summary: raw.summary ?? { oneLiner: '', biggestOpenDecision: '', canPark: '' },
    domains,
  };
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const PRIORITY_DOT: Record<Priority, string> = {
  critical: 'bg-rose-300',
  high:     'bg-amber-300',
  medium:   'bg-slate-300',
  low:      'bg-slate-200',
};

const PRIORITY_TEXT: Record<Priority, string> = {
  critical: 'text-slate-500',
  high:     'text-slate-500',
  medium:   'text-slate-400',
  low:      'text-slate-400',
};

const TYPE_COLOR: Record<ConceptType, string> = {
  situation: 'text-slate-400',
  goal:      'text-slate-400',
  decision:  'text-slate-400',
  concern:   'text-slate-400',
  idea:      'text-slate-400',
  belief:    'text-slate-400',
  process:   'text-slate-400',
};

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── ConceptRow ────────────────────────────────────────────────────────────────

const ConceptRow: React.FC<{ concept: Concept }> = ({ concept }) => {
  const [open, setOpen] = useState(false);
  const isResolved = concept.status === 'resolved';
  const isParked   = concept.status === 'parked';
  const faded = isResolved || isParked;

  return (
    <div className={faded ? 'opacity-45' : ''}>
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-start gap-2.5 px-3 py-2 text-left rounded-lg hover:bg-slate-50 transition-colors group"
      >
        {/* Priority dot */}
        <div className={`mt-[5px] w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[concept.priority]}`} />

        {/* Label */}
        <span className={`flex-1 text-[11px] leading-snug ${
          faded ? 'line-through text-slate-400' : 'text-slate-700'
        }`}>
          {concept.label}
        </span>

        {/* Type + conflict + chevron */}
        <div className="flex items-center gap-1.5 shrink-0">
          {concept.conflict && <AlertTriangle size={9} className="text-amber-300" />}
          <span className={`text-[9px] capitalize ${TYPE_COLOR[concept.type]}`}>{concept.type}</span>
          <span className="text-slate-200 group-hover:text-slate-400 transition-colors">
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </span>
        </div>
      </button>

      {/* Expanded description */}
      {open && (
        <div className="mx-3 mb-1 px-3 py-2.5 bg-slate-50 rounded-lg">
          {concept.description && (
            <p className="text-[10px] text-slate-600 leading-relaxed">{concept.description}</p>
          )}
          {concept.conflict && concept.conflictNote && (
            <p className="text-[9px] text-slate-500 mt-1.5 leading-snug">{concept.conflictNote}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            {(concept.signals ?? []).map(s => (
              <span key={s} className="text-[8px] text-slate-400 bg-white border border-slate-100 px-1.5 py-px rounded-full">
                {s}
              </span>
            ))}
            {concept.lastSeen && (
              <span className="text-[8px] text-slate-300 ml-auto">
                {formatDate(concept.lastSeen)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ── DomainSection ─────────────────────────────────────────────────────────────

const DomainSection: React.FC<{ domain: Domain; defaultOpen: boolean }> = ({
  domain,
  defaultOpen,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const concepts = domain.concepts ?? [];
  const active   = concepts.filter(c => c.status !== 'resolved' && c.status !== 'parked');
  const inactive = concepts.filter(c => c.status === 'resolved' || c.status === 'parked');

  return (
    <div>
      {/* Domain header — simple section label */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left group"
      >
        <span className={`text-[9px] font-bold uppercase tracking-widest ${PRIORITY_TEXT[domain.priority]}`}>
          {domain.label}
        </span>
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-[9px] text-slate-300 tabular-nums">{concepts.length}</span>
        <span className="text-slate-200 group-hover:text-slate-400 transition-colors ml-1">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {/* Concept rows */}
      {open && (
        <div className="mb-1">
          {active.map(c => <ConceptRow key={c.id} concept={c} />)}
          {inactive.map(c => <ConceptRow key={c.id} concept={c} />)}
        </div>
      )}
    </div>
  );
};

// ── SummaryCard ───────────────────────────────────────────────────────────────

const SummaryCard: React.FC<{ summary: CanonicalViewSummary }> = ({ summary }) => (
  <div className="px-3 py-3 mb-1">
    <p className="text-[11px] text-slate-700 leading-relaxed font-medium">{summary.oneLiner}</p>
    {summary.biggestOpenDecision && (
      <div className="flex items-start gap-1.5 mt-2">
        <Target size={9} className="text-slate-300 mt-0.5 shrink-0" />
        <p className="text-[9px] text-slate-500 leading-snug">{summary.biggestOpenDecision}</p>
      </div>
    )}
    {summary.canPark && (
      <div className="flex items-start gap-1.5 mt-1.5">
        <ParkingCircle size={9} className="text-slate-300 mt-0.5 shrink-0" />
        <p className="text-[9px] text-slate-400 leading-snug italic">{summary.canPark}</p>
      </div>
    )}
    <div className="mt-2 h-px bg-slate-100" />
  </div>
);

// ── Main widget ───────────────────────────────────────────────────────────────

type ViewMode = 'today' | 'all';

export const CanonicalViewWidget: React.FC<WidgetProps> = () => {
  const [mode, setMode] = useState<ViewMode>('today');
  const [todayData, setTodayData] = useState<CanonicalView | null>(null);
  const [allData, setAllData] = useState<CanonicalView | null>(null);
  const [todayExists, setTodayExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unauthenticated, setUnauthenticated] = useState(false);
  const hasDataRef = useRef(false);

  // Load from cache on mount — show stale data immediately before network responds
  useEffect(() => {
    let found = false;

    const cachedAll = profileStorage.getItem(CACHE_ALL_KEY);
    if (cachedAll) {
      try {
        setAllData(JSON.parse(cachedAll) as CanonicalView);
        found = true;
      } catch {}
    }

    const cachedToday = profileStorage.getItem(CACHE_TODAY_KEY);
    if (cachedToday) {
      try {
        const wrapper = JSON.parse(cachedToday) as { date: string; data: CanonicalView };
        if (wrapper.date === todayKey()) {
          setTodayData(wrapper.data);
          setTodayExists(true);
          setMode('today');
          found = true;
        }
      } catch {}
    }

    if (found) {
      hasDataRef.current = true;
      setLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (hasDataRef.current) setRefreshing(true);
    else setLoading(true);
    setError(null);
    setUnauthenticated(false);
    try {
      const today = todayKey();
      const [todayRes, allRes] = await Promise.all([
        storeGet('ramble', `views/canonical/${today}`),
        storeGet('ramble', 'views/canonical'),
      ]);

      if (todayRes.status === 401 || allRes.status === 401 ||
          todayRes.status === 403 || allRes.status === 403) {
        if (!hasDataRef.current) setUnauthenticated(true);
        return;
      }
      if (!allRes.ok && allRes.status !== 404) {
        if (!hasDataRef.current) setError(`Failed to load: ${allRes.status}`);
        return;
      }

      const hasTodayData = todayRes.ok;
      setTodayExists(hasTodayData);

      if (hasTodayData) {
        const data = normalise(await todayRes.json());
        setTodayData(data);
        profileStorage.setItem(CACHE_TODAY_KEY, JSON.stringify({ date: today, data }));
      }
      if (allRes.ok) {
        const data = normalise(await allRes.json());
        setAllData(data);
        profileStorage.setItem(CACHE_ALL_KEY, JSON.stringify(data));
      }

      // Only auto-select mode on first load (no cached data was driving it)
      if (!hasDataRef.current) {
        setMode(hasTodayData ? 'today' : 'all');
      }
      hasDataRef.current = true;
    } catch (e) {
      if (!hasDataRef.current) setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const data = mode === 'today' ? todayData : allData;

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div
        className="w-full h-full flex items-center justify-center gap-2 text-slate-400"
        data-doc='{"icon":"mdi:layers","title":"Canonical View","desc":"What matters most — synthesised concepts and situations from your conversations."}'
      >
        <Loader2 size={14} className="animate-spin" />
        <span className="text-xs">Loading…</span>
      </div>
    );
  }

  // ── Not signed in ─────────────────────────────────────────────────────
  if (unauthenticated) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4"
        data-doc='{"icon":"mdi:layers","title":"Canonical View","desc":"What matters most — synthesised concepts and situations from your conversations."}'
      >
        <Layers className="w-8 h-8 mb-2 opacity-40" />
        <span className="text-sm">Sign in to view</span>
        <span className="text-xs opacity-50 mt-1">Your canonical view is private</span>
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-400 p-4"
        data-doc='{"icon":"mdi:layers","title":"Canonical View","desc":"What matters most — synthesised concepts and situations from your conversations."}'
      >
        <Layers className="w-7 h-7 opacity-40" />
        <p className="text-xs text-red-400">{error}</p>
        <button
          onClick={load}
          className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={10} />
          Retry
        </button>
      </div>
    );
  }

  // ── Empty ──────────────────────────────────────────────────────────────
  if (!todayData && !allData) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center text-slate-400 p-4"
        data-doc='{"icon":"mdi:layers","title":"Canonical View","desc":"What matters most — synthesised concepts and situations from your conversations."}'
      >
        <Layers className="w-8 h-8 mb-2 opacity-40" />
        <span className="text-sm">No canonical view yet</span>
        <span className="text-xs opacity-50 mt-1 text-center">
          Run canonical-view-daily-ramble then canonical-view-build-ramble
        </span>
      </div>
    );
  }

  const domains = (data?.domains ?? []);
  const activeDomains = domains.filter(
    d => (d.concepts ?? []).some(c => c.status !== 'resolved' && c.status !== 'parked')
  );
  const otherDomains = domains.filter(
    d => !(d.concepts ?? []).some(c => c.status !== 'resolved' && c.status !== 'parked')
  );

  return (
    <div
      className="w-full h-full flex flex-col overflow-hidden"
      data-doc='{"icon":"mdi:layers","title":"Canonical View","desc":"What matters most — synthesised concepts and situations from your conversations."}'
    >
      {/* Header */}
      <div className="flex-shrink-0 px-2.5 py-1.5 border-b border-slate-100 flex items-center gap-1.5">
        {/* Today / All toggle */}
        <div className="flex items-center bg-slate-100/70 rounded p-px">
          <button
            onClick={() => setMode('today')}
            disabled={!todayExists}
            className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
              mode === 'today'
                ? 'bg-white text-slate-600 shadow-sm'
                : todayExists
                  ? 'text-slate-400 hover:text-slate-500'
                  : 'text-slate-300 cursor-not-allowed'
            }`}
            title={todayExists ? 'Today\'s extraction' : 'No extraction for today yet'}
          >
            Today
          </button>
          <button
            onClick={() => setMode('all')}
            disabled={!allData}
            className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
              mode === 'all'
                ? 'bg-white text-slate-600 shadow-sm'
                : allData
                  ? 'text-slate-400 hover:text-slate-500'
                  : 'text-slate-300 cursor-not-allowed'
            }`}
          >
            All
          </button>
        </div>

        <span className="text-[10px] text-slate-300 flex-1">
          {data ? `${data.totalConcepts ?? 0} concepts` : ''}
        </span>

        <button
          onClick={load}
          className="p-0.5 rounded hover:bg-slate-100 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={11} className={`text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto py-1">

        {/* No data for selected mode */}
        {!data && (
          <div className="text-[10px] text-slate-400 text-center py-8">
            {mode === 'today' ? 'No extraction for today yet' : 'No cumulative view yet'}
          </div>
        )}

        {/* Summary */}
        {data?.summary?.oneLiner && <SummaryCard summary={data.summary} />}

        {/* Active domains */}
        {activeDomains.map((d, i) => (
          <DomainSection key={d.id} domain={d} defaultOpen={i === 0} />
        ))}

        {/* Quiet domains — collapsed */}
        {otherDomains.map((d) => (
          <DomainSection key={d.id} domain={d} defaultOpen={false} />
        ))}

        {domains.length === 0 && (
          <div className="text-[10px] text-slate-400 text-center py-6">No domains yet</div>
        )}

        {/* Footer */}
        {data?.generatedAt && (
          <div className="text-[8px] text-slate-300 font-mono px-3 pt-1 pb-3">
            generated {new Date(data.generatedAt).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </div>
        )}
      </div>
    </div>
  );
};
