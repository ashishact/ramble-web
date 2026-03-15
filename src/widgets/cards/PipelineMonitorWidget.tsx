/**
 * Pipeline Monitor Widget — Real-time telemetry event stream
 *
 * Shows live pipeline events grouped by pipeline run (correlationId).
 * Collapses start/end pairs into single completed steps with duration.
 * LLM calls are visually distinguished from non-LLM operations.
 * Rich data rendering: text previews, entity lists, memory content.
 */

import React, { useState, useSyncExternalStore, useRef, useEffect, useCallback, useMemo } from 'react'
import { Activity, Trash2, Pause, Play, ChevronDown, ChevronRight, Zap, Database, Cpu, Radio } from 'lucide-react'
import { telemetry } from '../../program/telemetry'
import { eventBus } from '../../lib/eventBus'
import type { TelemetryEvent, PipelineRun } from '../../program/telemetry'
import type { WidgetProps } from '../types'

// ============================================================================
// Types
// ============================================================================

/** A collapsed step merging start + end events for the same action */
interface CollapsedStep {
  action: string
  category: string
  startEvent: TelemetryEvent
  endEvent?: TelemetryEvent
  durationMs?: number
  isLLM: boolean
  status: 'running' | 'success' | 'error'
  /** Merged data from both start and end events */
  data: Record<string, unknown>
}

// ============================================================================
// Helpers
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatTokens(count: number): string {
  if (typeof count !== 'number') return String(count)
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

/** Collapse events into steps: pair start/end by action, merge data */
function collapseEvents(events: TelemetryEvent[]): CollapsedStep[] {
  const steps: CollapsedStep[] = []
  const pending = new Map<string, TelemetryEvent>() // action → start event

  for (const event of events) {
    // Skip raw 'llm' category events — they duplicate the caller's LLM step
    // BUT keep error events so LLM failures are always visible
    if (event.category === 'llm' && event.status !== 'error') continue

    if (event.phase === 'start') {
      pending.set(event.action, event)
      // Don't add to steps yet — wait for end
    } else {
      // 'end' event — find matching start
      const startEvent = pending.get(event.action)
      if (startEvent) {
        pending.delete(event.action)
        steps.push({
          action: event.action,
          category: event.category,
          startEvent,
          endEvent: event,
          durationMs: event.ts - startEvent.ts,
          isLLM: !!(startEvent.isLLM || event.isLLM),
          status: event.status === 'error' ? 'error' : 'success',
          data: { ...startEvent.data, ...event.data },
        })
      } else {
        // End without start (loaded from localStorage)
        steps.push({
          action: event.action,
          category: event.category,
          startEvent: event,
          endEvent: event,
          durationMs: undefined,
          isLLM: !!event.isLLM,
          status: event.status === 'error' ? 'error' : 'success',
          data: event.data ?? {},
        })
      }
    }
  }

  // Add any still-pending start events as "running"
  for (const [action, startEvent] of pending) {
    steps.push({
      action,
      category: startEvent.category,
      startEvent,
      isLLM: !!startEvent.isLLM,
      status: 'running',
      data: startEvent.data ?? {},
    })
  }

  return steps
}

/** Human-readable label for an action */
function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    'processInputItem': 'Process Input',
    'dictionary-corrections': 'Dictionary Corrections',
    'phonetic-hints': 'Phonetic Hints',
    'learned-corrections': 'Learned Corrections',
    'llm-normalize': 'LLM Normalize',
    'phase1-normalize': 'Normalize Input',
    'phase2-context': 'Retrieve Context',
    'phase3-llm-extraction': 'LLM Extraction',
    'phase4-save-extraction': 'Save to DB',
    'phase5-auto-reinforce': 'Auto-Reinforce',
    'phase6-queue-tasks': 'Queue Follow-ups',
    'context-build': 'Build Context',
    'llm-pass': 'LLM Tree Edit',
    'apply-actions': 'Apply Actions',
    'load-context': 'Load Context',
    'llm-call': 'LLM Call',
    'blocking': 'Blocking',
    'scoring': 'Scoring',
    'verify-creates': 'Verify Creates',
    'id-resolution': 'Resolve IDs',
    'action-dropped': 'Action Dropped',
    'embed-nodes': 'Embed Nodes',
    'embed-model-load': 'Load Embedding Model',
  }
  return labels[action] ?? action
}

// ============================================================================
// Data Renderers — rich inline display
// ============================================================================

/** Render a text preview block — scrollable for long content */
const TextPreview: React.FC<{ label: string; text: string }> = ({ label, text }) => (
  <div className="mt-0.5">
    <span className="text-[9px] uppercase tracking-wider text-slate-400">{label}</span>
    <div className="text-[10px] text-slate-600 bg-slate-50 rounded px-1.5 py-1 mt-0.5 whitespace-pre-wrap break-words leading-relaxed border border-slate-100 max-h-[200px] overflow-y-auto">
      {text}
    </div>
  </div>
)

/** Render a tag list (entities, topics, etc.) */
const TagList: React.FC<{ label: string; items: string[]; color?: string }> = ({ label, items, color = 'blue' }) => {
  if (items.length === 0) return null
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber: 'bg-amber-50 text-amber-700 border-amber-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    slate: 'bg-slate-50 text-slate-600 border-slate-200',
  }
  const cls = colorClasses[color] ?? colorClasses.blue
  return (
    <div className="mt-0.5">
      <span className="text-[9px] uppercase tracking-wider text-slate-400">{label}</span>
      <div className="flex flex-wrap gap-0.5 mt-0.5">
        {items.map((item, i) => (
          <span key={i} className={`text-[9px] px-1 py-0 rounded border ${cls}`}>{item}</span>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Native Feed — Real-time entity & transcription display
// ============================================================================

type NativeFeedItem =
  | { type: 'text'; ts: number; text: string; audioType: string; mode?: string; recordingId?: string }
  | { type: 'entities'; ts: number; entities?: Record<string, string[]>; nlTaggerEntities?: Record<string, string[]>; sessionEntities?: Record<string, string[]>; recordingId?: string }
  | { type: 'final'; ts: number; text: string; audioType: string; entities?: Record<string, string[]>; duration?: number; mode?: string; recordingId?: string }

const MAX_FEED_ITEMS = 60

const entityMapColorClasses: Record<string, { label: string; tag: string }> = {
  blue:   { label: 'text-blue-500',   tag: 'bg-blue-50 text-blue-700 border-blue-200' },
  purple: { label: 'text-purple-500', tag: 'bg-purple-50 text-purple-700 border-purple-200' },
  green:  { label: 'text-emerald-500', tag: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

/** Render a categorized entity map (e.g. { PersonalName: ["John"], PlaceName: ["SF"] }) */
const EntityMapDisplay: React.FC<{ label: string; entityMap: Record<string, string[]>; color: string }> = ({ label, entityMap, color }) => {
  const entries = Object.entries(entityMap).filter(([, v]) => v.length > 0)
  if (entries.length === 0) return null

  const cls = entityMapColorClasses[color] ?? entityMapColorClasses.blue
  return (
    <div className="mt-0.5">
      <span className={`text-[9px] uppercase tracking-wider ${cls.label}`}>{label}</span>
      {entries.map(([category, names]) => (
        <div key={category} className="flex flex-wrap items-center gap-0.5 mt-0.5">
          <span className="text-[9px] text-slate-400 mr-0.5 font-medium">{category}:</span>
          {names.map((name, i) => (
            <span key={i} className={`text-[9px] px-1 py-0 rounded border ${cls.tag}`}>{name}</span>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Count total entities across a map */
function countEntities(map?: Record<string, string[]>): number {
  if (!map) return 0
  return Object.values(map).reduce((sum, arr) => sum + arr.length, 0)
}

const NativeFeedRow: React.FC<{ item: NativeFeedItem }> = ({ item }) => {
  const [expanded, setExpanded] = useState(false)

  if (item.type === 'text') {
    return (
      <div className="px-1.5 py-[3px] text-[11px] font-mono hover:bg-black/[0.03] cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-1">
          <span className="text-slate-400 flex-shrink-0 w-[52px] text-[10px]">{formatTime(item.ts)}</span>
          <span className="text-[9px] px-1 rounded bg-sky-100 text-sky-600">{item.audioType}</span>
          {item.mode && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-500">{item.mode}</span>}
          <span className="text-slate-700 truncate flex-1">{item.text.slice(0, 100)}{item.text.length > 100 ? '...' : ''}</span>
          {item.text.length > 100 && (expanded ? <ChevronDown size={10} className="text-slate-300 flex-shrink-0" /> : <ChevronRight size={10} className="text-slate-300 flex-shrink-0" />)}
        </div>
        {expanded && <TextPreview label="Full Text" text={item.text} />}
      </div>
    )
  }

  if (item.type === 'entities') {
    const totalCount = countEntities(item.entities) + countEntities(item.nlTaggerEntities) + countEntities(item.sessionEntities)
    return (
      <div className="px-1.5 py-[3px] border-l-2 border-l-purple-300 bg-purple-50/30">
        <div className="flex items-center gap-1 text-[11px] font-mono cursor-pointer hover:bg-black/[0.03]" onClick={() => setExpanded(!expanded)}>
          <span className="text-slate-400 flex-shrink-0 w-[52px] text-[10px]">{formatTime(item.ts)}</span>
          <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-600">entities</span>
          <span className="text-[9px] text-purple-400">{totalCount} detected</span>
          <div className="flex-1" />
          {expanded ? <ChevronDown size={10} className="text-slate-300" /> : <ChevronRight size={10} className="text-slate-300" />}
        </div>
        {expanded && (
          <div className="mt-0.5">
            {item.entities && <EntityMapDisplay label="Entities" entityMap={item.entities} color="blue" />}
            {item.nlTaggerEntities && <EntityMapDisplay label="NLTagger" entityMap={item.nlTaggerEntities} color="purple" />}
            {item.sessionEntities && <EntityMapDisplay label="Session (cumulative)" entityMap={item.sessionEntities} color="green" />}
          </div>
        )}
      </div>
    )
  }

  if (item.type === 'final') {
    const entityCount = countEntities(item.entities)
    return (
      <div className="px-1.5 py-[3px] border-l-2 border-l-emerald-400 bg-emerald-50/40">
        <div className="flex items-center gap-1 text-[11px] font-mono cursor-pointer hover:bg-black/[0.03]" onClick={() => setExpanded(!expanded)}>
          <span className="text-slate-400 flex-shrink-0 w-[52px] text-[10px]">{formatTime(item.ts)}</span>
          <span className="text-[9px] px-1 rounded bg-emerald-100 text-emerald-700 font-medium">final</span>
          <span className="text-[9px] px-1 rounded bg-sky-100 text-sky-600">{item.audioType}</span>
          {item.mode && <span className="text-[9px] px-1 rounded bg-slate-100 text-slate-500">{item.mode}</span>}
          {item.duration != null && <span className="text-[9px] text-slate-400">{item.duration.toFixed(1)}s</span>}
          {entityCount > 0 && <span className="text-[9px] text-emerald-500">{entityCount}E</span>}
          <span className="text-slate-700 truncate flex-1">{item.text.slice(0, 80)}{item.text.length > 80 ? '...' : ''}</span>
          {expanded ? <ChevronDown size={10} className="text-slate-300 flex-shrink-0" /> : <ChevronRight size={10} className="text-slate-300 flex-shrink-0" />}
        </div>
        {expanded && (
          <div className="mt-0.5">
            <TextPreview label="Final Text" text={item.text} />
            {item.entities && <EntityMapDisplay label="Accumulated Entities" entityMap={item.entities} color="blue" />}
          </div>
        )}
      </div>
    )
  }

  return null
}

const NativeFeedSection: React.FC<{ items: NativeFeedItem[]; onClear: () => void }> = ({ items, onClear }) => {
  const [collapsed, setCollapsed] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new items
  useEffect(() => {
    if (!collapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [items.length, collapsed])

  if (items.length === 0) return null

  return (
    <div className="border rounded-md mb-2 border-orange-300 bg-orange-50/30">
      <div className="flex items-center gap-1.5 px-2 py-1 cursor-pointer" onClick={() => setCollapsed(!collapsed)}>
        <Radio size={12} className="text-orange-500" />
        <span className="text-[11px] font-medium text-slate-700">Native Input</span>
        <span className="text-[9px] text-slate-400">{items.length} events</span>
        <div className="flex-1" />
        <button
          onClick={(e) => { e.stopPropagation(); onClear() }}
          className="p-0.5 rounded hover:bg-orange-100 text-slate-400 hover:text-red-500"
          title="Clear native feed"
        >
          <Trash2 size={10} />
        </button>
        {collapsed ? <ChevronRight size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
      </div>
      {!collapsed && (
        <div ref={scrollRef} className="border-t border-orange-200/50 max-h-[300px] overflow-y-auto">
          {items.map((item, i) => (
            <NativeFeedRow key={`${item.type}-${item.ts}-${i}`} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Render LLM-specific metadata line */
const LLMInfo: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  const parts: string[] = []
  if (data.model) parts.push(String(data.model))
  if (data.tier) parts.push(`tier:${data.tier}`)
  if (typeof data.inputTokens === 'number' && typeof data.outputTokens === 'number') {
    parts.push(`${formatTokens(data.inputTokens)}in / ${formatTokens(data.outputTokens)}out`)
  } else if (data.tokensUsed) {
    parts.push(`${formatTokens(data.tokensUsed as number)} tok`)
  }
  if (data.durationMs) parts.push(formatDuration(data.durationMs as number))
  if (data.promptLength) parts.push(`prompt:${formatTokens(data.promptLength as number)} chars`)
  if (parts.length === 0) return null
  return (
    <div className="text-[9px] text-violet-500 mt-0.5 flex items-center gap-1">
      <Zap size={8} className="flex-shrink-0" />
      {parts.join(' · ')}
    </div>
  )
}

/** Render step data richly based on data keys present */
const StepData: React.FC<{ step: CollapsedStep }> = ({ step }) => {
  const d = step.data
  if (!d || Object.keys(d).length === 0) return null

  const elements: React.ReactNode[] = []

  // Error message — always show first if present
  if (d.error && typeof d.error === 'string') {
    elements.push(
      <div key="error" className="mt-0.5">
        <span className="text-[9px] uppercase tracking-wider text-red-400">Error</span>
        <div className="text-[10px] text-red-700 bg-red-50 rounded px-1.5 py-1 mt-0.5 border border-red-200 max-h-[200px] overflow-y-auto whitespace-pre-wrap break-words">
          {d.error}
        </div>
      </div>
    )
  }

  // Text previews — inputs first, then outputs
  if (d.inputText) elements.push(<TextPreview key="input" label="Input" text={String(d.inputText)} />)
  if (d.normalizedText) elements.push(<TextPreview key="norm" label="Normalized" text={String(d.normalizedText)} />)
  if (d.extractionText) elements.push(<TextPreview key="ext" label="Extraction Input" text={String(d.extractionText)} />)
  if (d.systemPromptPreview) elements.push(<TextPreview key="sysprompt" label="System Prompt" text={String(d.systemPromptPreview)} />)
  if (d.promptPreview) elements.push(<TextPreview key="prompt" label="Prompt Sent" text={String(d.promptPreview)} />)
  if (d.responsePreview) elements.push(<TextPreview key="resp" label="LLM Response" text={String(d.responsePreview)} />)
  if (d.summary) elements.push(<TextPreview key="summary" label="Summary" text={String(d.summary)} />)

  // Tag lists
  if (Array.isArray(d.entityNames) && d.entityNames.length > 0) {
    elements.push(<TagList key="ent" label="Entities" items={d.entityNames as string[]} color="blue" />)
  }
  if (Array.isArray(d.topicNames) && d.topicNames.length > 0) {
    elements.push(<TagList key="top" label="Topics" items={d.topicNames as string[]} color="green" />)
  }
  if (Array.isArray(d.entityHints) && d.entityHints.length > 0) {
    elements.push(<TagList key="hints" label="Entity Hints" items={d.entityHints as string[]} color="purple" />)
  }
  if (Array.isArray(d.topicHints) && d.topicHints.length > 0) {
    elements.push(<TagList key="thints" label="Topic Hints" items={d.topicHints as string[]} color="green" />)
  }
  if (Array.isArray(d.corrections) && d.corrections.length > 0) {
    elements.push(<TagList key="corr" label="Corrections" items={d.corrections as string[]} color="amber" />)
  }
  if (Array.isArray(d.retractions) && d.retractions.length > 0) {
    elements.push(<TagList key="retr" label="Retractions" items={d.retractions as string[]} color="amber" />)
  }
  if (d.goalDetails && typeof d.goalDetails === 'string') {
    elements.push(<TextPreview key="goal" label="Goal" text={d.goalDetails} />)
  }
  if (d.reason && typeof d.reason === 'string') {
    elements.push(<TextPreview key="reason" label="Reason" text={d.reason} />)
  }
  if (d.actionPreview && typeof d.actionPreview === 'string') {
    elements.push(<TextPreview key="actionPrev" label="Action" text={d.actionPreview} />)
  }

  // Actions previews (arrays of action objects from ID resolution)
  if (Array.isArray(d.actionsPreview) && d.actionsPreview.length > 0) {
    elements.push(
      <div key="actionsPrev" className="mt-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Actions (pre-resolve)</span>
        {(d.actionsPreview as Array<Record<string, string>>).map((a, i) => (
          <div key={i} className="text-[10px] text-slate-600 bg-slate-50 rounded px-1.5 py-0.5 mt-0.5 border border-slate-100 font-mono">
            <span className="text-blue-600 font-medium">{a.type}</span>
            {a.node && <span className="ml-1">node:<span className="text-amber-600">{a.node}</span></span>}
            {a.parent && <span className="ml-1">parent:<span className="text-amber-600">{a.parent}</span></span>}
            {a.label && <span className="ml-1 text-emerald-600">&quot;{a.label}&quot;</span>}
            {a.source && <span className="ml-1">src:<span className="text-amber-600">{a.source}</span></span>}
            {a.target && <span className="ml-1">tgt:<span className="text-amber-600">{a.target}</span></span>}
          </div>
        ))}
      </div>
    )
  }
  if (Array.isArray(d.resolvedPreview) && d.resolvedPreview.length > 0) {
    elements.push(
      <div key="resolvedPrev" className="mt-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Actions (post-resolve)</span>
        {(d.resolvedPreview as Array<Record<string, string>>).map((a, i) => (
          <div key={i} className="text-[10px] text-slate-600 bg-slate-50 rounded px-1.5 py-0.5 mt-0.5 border border-slate-100 font-mono">
            <span className="text-blue-600 font-medium">{a.type}</span>
            {a.node && <span className="ml-1">node:<span className="text-purple-600">{a.node.slice(0, 12)}</span></span>}
            {a.parent && <span className="ml-1">parent:<span className="text-purple-600">{a.parent.slice(0, 12)}</span></span>}
            {a.label && <span className="ml-1 text-emerald-600">&quot;{a.label}&quot;</span>}
          </div>
        ))}
      </div>
    )
  }
  if (Array.isArray(d.unresolvedDetails) && d.unresolvedDetails.length > 0) {
    elements.push(
      <div key="unresolved" className="mt-0.5">
        <span className="text-[9px] uppercase tracking-wider text-red-400">Unresolved IDs</span>
        {(d.unresolvedDetails as Array<{ type: string; field: string; unresolvedId: string }>).map((u, i) => (
          <div key={i} className="text-[10px] text-red-600 bg-red-50 rounded px-1.5 py-0.5 mt-0.5 border border-red-200 font-mono">
            {u.type}.{u.field} = <span className="font-bold">{u.unresolvedId}</span> (not in idMap)
          </div>
        ))}
      </div>
    )
  }
  if (Array.isArray(d.groupSizes) && d.groupSizes.length > 0) {
    elements.push(
      <TagList key="groups" label="Entity Groups" items={(d.groupSizes as Array<{ entity: string; actions: number }>).map(g => `${g.entity} (${g.actions})`)} color="blue" />
    )
  }

  // Memory previews
  if (Array.isArray(d.memoryPreviews) && d.memoryPreviews.length > 0) {
    elements.push(
      <div key="mem" className="mt-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-400">Memories</span>
        {(d.memoryPreviews as string[]).map((m, i) => (
          <div key={i} className="text-[10px] text-slate-600 bg-amber-50/50 rounded px-1.5 py-0.5 mt-0.5 border border-amber-100">
            {m}
          </div>
        ))}
      </div>
    )
  }

  // LLM info
  if (step.isLLM) {
    elements.push(<LLMInfo key="llm" data={d} />)
  }

  // Numeric stats that weren't rendered above
  const renderedKeys = new Set([
    'inputText', 'normalizedText', 'extractionText', 'responsePreview',
    'promptPreview', 'systemPromptPreview', 'summary',
    'entityNames', 'topicNames', 'entityHints', 'topicHints', 'corrections',
    'memoryPreviews', 'model', 'tier', 'tokensUsed', 'durationMs', 'promptLength',
    'responseLength', 'inputTokens', 'outputTokens',
    'goalDetails', 'retractions',
    'error', 'reason', 'actionPreview', 'actionsPreview', 'resolvedPreview',
    'unresolvedDetails', 'unresolvedCount', 'groupSizes', 'provider',
  ])
  const remaining = Object.entries(d).filter(([k, v]) => !renderedKeys.has(k) && v !== undefined && v !== null)
  if (remaining.length > 0) {
    elements.push(
      <div key="stats" className="flex flex-wrap gap-x-3 gap-y-0 mt-0.5 text-[9px] text-slate-400">
        {remaining.map(([k, v]) => (
          <span key={k}>
            {k}: <span className="text-slate-600">{Array.isArray(v) ? `[${v.length}]` : String(v)}</span>
          </span>
        ))}
      </div>
    )
  }

  if (elements.length === 0) return null
  return <div className="px-1.5 pb-1">{elements}</div>
}

// ============================================================================
// Step Row — single collapsed step
// ============================================================================

const StepRow: React.FC<{ step: CollapsedStep; index: number }> = ({ step, index }) => {
  const [expanded, setExpanded] = useState(false)
  const hasData = step.data && Object.keys(step.data).length > 0

  const statusDot = step.status === 'running'
    ? 'bg-blue-500 animate-pulse'
    : step.status === 'error'
    ? 'bg-red-500'
    : 'bg-emerald-500'

  const statusText = step.status === 'running'
    ? 'text-blue-600'
    : step.status === 'error'
    ? 'text-red-600'
    : 'text-slate-700'

  // LLM calls get a distinct visual treatment; alternating bg for readability
  const evenOddBg = index % 2 === 0 ? 'bg-white' : 'bg-slate-50/70'
  const rowBg = step.isLLM
    ? 'bg-violet-50/60 border-l-2 border-l-violet-300'
    : step.status === 'error'
    ? 'bg-red-50/60 border-l-2 border-l-red-300'
    : `${evenOddBg} border-l-2 border-l-transparent`

  return (
    <div className={`${rowBg} rounded-sm`}>
      <div
        className="flex items-center gap-1.5 px-1.5 py-[3px] hover:bg-black/[0.03] rounded-sm cursor-pointer text-[11px] font-mono"
        onClick={() => hasData && setExpanded(!expanded)}
      >
        {/* Timestamp */}
        <span className="text-slate-400 flex-shrink-0 w-[52px] text-[10px]">
          {formatTime(step.startEvent.ts)}
        </span>

        {/* Status dot */}
        <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${statusDot}`} />

        {/* Icon */}
        {step.isLLM ? (
          <Zap size={10} className="flex-shrink-0 text-violet-500" />
        ) : step.category === 'save' ? (
          <Database size={10} className="flex-shrink-0 text-slate-400" />
        ) : (
          <Cpu size={10} className="flex-shrink-0 text-slate-400" />
        )}

        {/* Category badge */}
        <span className={`flex-shrink-0 text-[9px] px-1 py-0 rounded ${
          step.isLLM
            ? 'bg-violet-100 text-violet-600'
            : 'bg-slate-100 text-slate-500'
        }`}>
          {step.category}
        </span>

        {/* Action label */}
        <span className={`flex-1 truncate ${statusText}`}>
          {actionLabel(step.action)}
          {step.status === 'running' && (
            <span className="text-blue-400 ml-1 text-[10px]">running...</span>
          )}
        </span>

        {/* Quick stats inline */}
        {step.data.entities !== undefined && (
          <span className="text-[9px] text-blue-400 flex-shrink-0">{String(step.data.entities)}E</span>
        )}
        {step.data.memories !== undefined && (
          <span className="text-[9px] text-amber-400 flex-shrink-0">{String(step.data.memories)}M</span>
        )}

        {/* Duration */}
        {step.durationMs != null && (
          <span className={`flex-shrink-0 text-[10px] ${
            step.isLLM ? 'text-violet-400 font-medium' : 'text-slate-400'
          }`}>
            {formatDuration(step.durationMs)}
          </span>
        )}

        {/* Expand arrow */}
        {hasData && (
          <span className="text-slate-300 flex-shrink-0">
            {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
        )}
      </div>

      {/* Expanded data */}
      {expanded && <StepData step={step} />}
    </div>
  )
}

// ============================================================================
// Run Group
// ============================================================================

const RUN_COLORS = [
  { border: 'border-emerald-300 bg-emerald-50/50', dot: 'bg-emerald-500' },
  { border: 'border-amber-300 bg-amber-50/50', dot: 'bg-amber-500' },
  { border: 'border-sky-300 bg-sky-50/50', dot: 'bg-sky-500' },
  { border: 'border-purple-300 bg-purple-50/50', dot: 'bg-purple-500' },
]

function runStatusColor(run: PipelineRun, index: number): string {
  if (run.status === 'running') return 'border-blue-400 bg-blue-50/50'
  if (run.status === 'error') return 'border-red-300 bg-red-50/50'
  return RUN_COLORS[index % RUN_COLORS.length].border
}

function runStatusDot(run: PipelineRun, index: number): string {
  if (run.status === 'running') return 'bg-blue-500 animate-pulse'
  if (run.status === 'error') return 'bg-red-500'
  return RUN_COLORS[index % RUN_COLORS.length].dot
}

const RunGroup: React.FC<{ run: PipelineRun; index: number }> = ({ run, index }) => {
  const [collapsed, setCollapsed] = useState(false)
  const steps = useMemo(() => collapseEvents(run.events), [run.events])

  // Get input text preview from the first event
  const inputPreview = run.events[0]?.data?.inputText as string | undefined

  // Count LLM vs non-LLM steps
  const llmCount = steps.filter(s => s.isLLM).length
  const totalSteps = steps.length

  return (
    <div className={`border rounded-md mb-1.5 ${runStatusColor(run, index)}`}>
      <div
        className="flex items-center gap-1.5 px-2 py-1 cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${runStatusDot(run, index)}`} />
        <span className="text-[11px] font-medium text-slate-700 flex-1">
          {formatTime(run.startTs)}
          {run.durationMs != null && (
            <span className="text-slate-400 font-normal ml-1">({formatDuration(run.durationMs)})</span>
          )}
          {inputPreview && (
            <span className="text-slate-400 font-normal ml-1.5 text-[10px]">
              — {inputPreview.slice(0, 60)}{inputPreview.length > 60 ? '...' : ''}
            </span>
          )}
        </span>
        <span className="text-[9px] text-slate-400">{totalSteps} steps</span>
        {llmCount > 0 && (
          <span className="text-[9px] text-violet-400 flex items-center gap-0.5">
            <Zap size={8} />{llmCount}
          </span>
        )}
        {collapsed ? <ChevronRight size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
      </div>
      {!collapsed && (
        <div className="border-t border-slate-200/50 px-0.5 py-0.5">
          {steps.map((step, i) => (
            <StepRow key={`${step.action}-${i}`} step={step} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Widget Component
// ============================================================================

export const PipelineMonitorWidget: React.FC<WidgetProps> = () => {
  const snapshot = useSyncExternalStore(telemetry.subscribe, telemetry.getSnapshot)
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [pausedSnapshot, setPausedSnapshot] = useState(snapshot)
  const [nativeFeed, setNativeFeed] = useState<NativeFeedItem[]>([])

  const displaySnapshot = paused ? pausedSnapshot : snapshot

  // Subscribe to native input events (text, entities, final)
  useEffect(() => {
    const unsubs = [
      eventBus.on('native:transcription-intermediate', (p) => {
        if (paused) return
        setNativeFeed(prev => [...prev.slice(-(MAX_FEED_ITEMS - 1)), {
          type: 'text', ts: p.ts, text: p.text, audioType: p.audioType, mode: p.mode, recordingId: p.recordingId,
        }])
      }),
      eventBus.on('native:intermediate-entities', (p) => {
        if (paused) return
        setNativeFeed(prev => [...prev.slice(-(MAX_FEED_ITEMS - 1)), {
          type: 'entities', ts: p.ts, entities: p.entities, nlTaggerEntities: p.nlTaggerEntities, sessionEntities: p.sessionEntities, recordingId: p.recordingId,
        }])
      }),
      eventBus.on('native:transcription-final', (p) => {
        if (paused) return
        setNativeFeed(prev => [...prev.slice(-(MAX_FEED_ITEMS - 1)), {
          type: 'final', ts: p.ts, text: p.text, audioType: p.audioType, entities: p.entities, duration: p.duration, mode: p.mode, recordingId: p.recordingId,
        }])
      }),
    ]
    return () => unsubs.forEach(u => u())
  }, [paused])

  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [snapshot.events.length, paused])

  const handlePause = useCallback(() => {
    if (!paused) setPausedSnapshot(snapshot)
    setPaused(p => !p)
  }, [paused, snapshot])

  const handleClear = useCallback(() => {
    telemetry.clearEvents()
    setNativeFeed([])
  }, [])

  const handleClearNativeFeed = useCallback(() => {
    setNativeFeed([])
  }, [])

  const runs = useMemo(() => [...displaySnapshot.runs].reverse(), [displaySnapshot.runs])
  const runCorrelationIds = useMemo(() => new Set(runs.map(r => r.correlationId)), [runs])
  const ungroupedEvents = useMemo(
    () => displaySnapshot.events.filter(e => !runCorrelationIds.has(e.correlationId)),
    [displaySnapshot.events, runCorrelationIds]
  )
  const ungroupedSteps = useMemo(() => collapseEvents(ungroupedEvents), [ungroupedEvents])

  return (
    <div
      className="w-full h-full flex flex-col bg-white"
      data-doc='{"icon":"lucide:activity","title":"Pipeline Monitor","desc":"Real-time telemetry event stream for the processing pipeline"}'
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 flex-shrink-0">
        <Activity size={14} className="text-blue-500" />
        <span className="text-xs font-medium text-slate-700">Pipeline Monitor</span>
        {displaySnapshot.activeRun && (
          <span className="flex items-center gap-1 text-[10px] text-blue-500">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
            Running
          </span>
        )}
        <div className="flex-1" />

        {/* Legend */}
        <span className="flex items-center gap-0.5 text-[9px] text-violet-400">
          <Zap size={8} /> LLM
        </span>
        <span className="flex items-center gap-0.5 text-[9px] text-slate-400">
          <Cpu size={8} /> Compute
        </span>

        <span className="text-[10px] text-slate-400 ml-1">{runs.length} runs</span>
        <button
          onClick={handlePause}
          className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600"
          title={paused ? 'Resume' : 'Pause'}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
        </button>
        <button
          onClick={handleClear}
          className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500"
          title="Clear events"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Event Stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-1.5">
        {displaySnapshot.events.length === 0 && nativeFeed.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-400">
            No events yet. Speak or type something to see pipeline activity.
          </div>
        ) : (
          <>
            {/* Native Input Feed — entities & transcription from native app */}
            <NativeFeedSection items={nativeFeed} onClear={handleClearNativeFeed} />

            {runs.map((run, i) => (
              <RunGroup key={run.correlationId} run={run} index={i} />
            ))}
            {ungroupedSteps.length > 0 && (
              <div className="border rounded-md border-slate-200 px-0.5 py-0.5">
                {ungroupedSteps.map((step, i) => (
                  <StepRow key={`${step.action}-${i}`} step={step} index={i} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
