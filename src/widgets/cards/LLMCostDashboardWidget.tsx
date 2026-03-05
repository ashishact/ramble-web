/**
 * LLM Cost Dashboard Widget — Token & cost tracking
 *
 * Tabs: By Category | By Model | By Day
 * Time filter: Today | This Week | All Time
 * Summary header with totals.
 */

import React, { useState, useSyncExternalStore, useCallback } from 'react'
import { DollarSign, Trash2 } from 'lucide-react'
import { llmTracker } from '../../program/telemetry'
import type { CostEntry } from '../../program/telemetry'
import type { WidgetProps } from '../types'

// ============================================================================
// Helpers
// ============================================================================

type Tab = 'category' | 'model' | 'day'
type TimeFilter = 'today' | 'week' | 'all'

function formatCost(cost: number): string {
  if (cost < 0.001) return '$0.00'
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(3)}`
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

// ============================================================================
// Cost Table
// ============================================================================

const CostTable: React.FC<{ entries: CostEntry[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="text-xs text-slate-400 text-center py-4">
        No data yet.
      </div>
    )
  }

  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b border-slate-200 text-slate-500">
          <th className="text-left py-1 px-1.5 font-medium">Name</th>
          <th className="text-right py-1 px-1.5 font-medium">Calls</th>
          <th className="text-right py-1 px-1.5 font-medium">In</th>
          <th className="text-right py-1 px-1.5 font-medium">Out</th>
          <th className="text-right py-1 px-1.5 font-medium">Cost</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(entry => (
          <tr key={entry.key} className="border-b border-slate-100 hover:bg-slate-50">
            <td className="py-1 px-1.5 font-mono text-slate-700 truncate max-w-[120px]">{entry.key}</td>
            <td className="py-1 px-1.5 text-right text-slate-600">{entry.callCount}</td>
            <td className="py-1 px-1.5 text-right text-slate-500">{formatTokens(entry.inputTokens)}</td>
            <td className="py-1 px-1.5 text-right text-slate-500">{formatTokens(entry.outputTokens)}</td>
            <td className="py-1 px-1.5 text-right font-medium text-slate-700">{formatCost(entry.estimatedCost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ============================================================================
// Widget Component
// ============================================================================

export const LLMCostDashboardWidget: React.FC<WidgetProps> = () => {
  useSyncExternalStore(llmTracker.subscribe, llmTracker.getSnapshot)
  const [tab, setTab] = useState<Tab>('category')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')

  // Get entries for the current tab + time filter
  let entries: CostEntry[] = []
  switch (tab) {
    case 'category':
      entries = llmTracker.getUsageByCategory(timeFilter)
      break
    case 'model':
      entries = llmTracker.getUsageByModel(timeFilter)
      break
    case 'day':
      entries = llmTracker.getUsageByDay(timeFilter)
      break
  }

  // Compute filtered totals
  const totalCost = llmTracker.getTotalCost(timeFilter)
  const filteredCalls = entries.reduce((sum, e) => sum + e.callCount, 0)
  const filteredTokens = entries.reduce((sum, e) => sum + e.totalTokens, 0)

  const handleClear = useCallback(() => {
    llmTracker.clearRecords()
  }, [])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'category', label: 'By Category' },
    { key: 'model', label: 'By Model' },
    { key: 'day', label: 'By Day' },
  ]

  const timeFilters: { key: TimeFilter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'all', label: 'All Time' },
  ]

  return (
    <div
      className="w-full h-full flex flex-col bg-white"
      data-doc='{"icon":"lucide:dollar-sign","title":"LLM Dashboard","desc":"Token usage and estimated cost tracking for all LLM calls"}'
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 flex-shrink-0">
        <DollarSign size={14} className="text-amber-500" />
        <span className="text-xs font-medium text-slate-700">LLM Dashboard</span>
        <div className="flex-1" />
        <button
          onClick={handleClear}
          className="p-0.5 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500"
          title="Reset all data"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Summary */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-slate-100 bg-slate-50 flex-shrink-0">
        <div className="text-[10px] text-slate-500">
          <span className="font-medium text-slate-700">{filteredCalls}</span> calls
        </div>
        <div className="text-[10px] text-slate-500">
          <span className="font-medium text-slate-700">{formatTokens(filteredTokens)}</span> tokens
        </div>
        <div className="text-[10px] text-slate-500">
          est. <span className="font-medium text-amber-600">{formatCost(totalCost)}</span>
        </div>
      </div>

      {/* Time Filter */}
      <div className="flex items-center gap-0.5 px-3 py-1 border-b border-slate-100 flex-shrink-0">
        {timeFilters.map(f => (
          <button
            key={f.key}
            onClick={() => setTimeFilter(f.key)}
            className={`px-2 py-0.5 text-[10px] rounded-full transition-colors ${
              timeFilter === f.key
                ? 'bg-slate-200 text-slate-700 font-medium'
                : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center border-b border-slate-200 flex-shrink-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 text-center py-1.5 text-[11px] font-medium transition-colors border-b-2 ${
              tab === t.key
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-1">
        <CostTable entries={entries} />
      </div>
    </div>
  )
}
