/**
 * OntologyBrowser — Collapsible package→concept→slot tree view
 *
 * Displays installed ontology packages as a clean tree.
 * Pure React/Tailwind — no ECharts. Scrollable if content exceeds container.
 */

import { useState, useCallback } from 'react'
import {
  Package,
  CircleDot,
  ChevronRight,
} from 'lucide-react'
import type { PackageView, ConceptView, SlotView } from './useOntologyData'

// ── Slot row ───────────────────────────────────────────────────────

function SlotRow({ slot }: { slot: SlotView }) {
  return (
    <div className="flex items-center gap-2 py-1 px-2 ml-10 rounded hover:bg-slate-50 transition-colors">
      <span className="text-[11px] text-slate-500 truncate">
        {slot.name}
      </span>
      {slot.description && (
        <span className="text-[9px] text-slate-300 truncate">
          {slot.description}
        </span>
      )}
    </div>
  )
}

// ── Concept row ────────────────────────────────────────────────────

function ConceptRow({ concept }: { concept: ConceptView }) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded(e => !e), [])

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full py-1.5 px-2 ml-5 rounded hover:bg-slate-50 transition-colors text-left"
      >
        <ChevronRight
          size={12}
          className={`text-slate-400 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <CircleDot size={12} className="text-indigo-400 shrink-0" />
        <span className="text-[11px] font-medium text-slate-600 truncate">
          {concept.name}
        </span>
        {concept.priority >= 0.7 && (
          <span className="text-[8px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded font-medium shrink-0">
            high
          </span>
        )}
      </button>
      {expanded && concept.slots.map(slot => (
        <SlotRow key={slot.id} slot={slot} />
      ))}
    </div>
  )
}

// ── Package card ───────────────────────────────────────────────────

function PackageCard({ pkg }: { pkg: PackageView }) {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => setExpanded(e => !e), [])

  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 hover:bg-slate-50/50 transition-colors text-left"
      >
        <ChevronRight
          size={13}
          className={`text-slate-400 shrink-0 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
        />
        <Package size={13} className="text-emerald-500 shrink-0" />
        <span className="text-[11px] font-semibold text-slate-700 truncate">
          {pkg.name}
        </span>
        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
          pkg.status === 'active'
            ? 'bg-emerald-50 text-emerald-600'
            : 'bg-slate-100 text-slate-400'
        }`}>
          {pkg.status}
        </span>
      </button>

      {/* Expanded concepts */}
      {expanded && (
        <div className="pb-2">
          {pkg.concepts.map(concept => (
            <ConceptRow key={concept.id} concept={concept} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────

export function OntologyBrowser({ packages }: { packages: PackageView[] }) {
  return (
    <div className="w-full h-full overflow-y-auto px-3 py-2 space-y-2">
      {packages.map(pkg => (
        <PackageCard key={pkg.id} pkg={pkg} />
      ))}
    </div>
  )
}
