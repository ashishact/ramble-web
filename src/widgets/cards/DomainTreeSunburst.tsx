/**
 * DomainTreeSunburst
 *
 * Standalone sunburst visualization of a user's domain tree.
 * Fetches domain-tree.jsonl independently — can be dropped anywhere.
 *
 * Inner ring  = top-level domains  (e.g. "Ramble", "Superatom")
 * Outer ring  = sub-domains        (e.g. "Engineering", "Sales")
 *
 * Weight drives arc size and color saturation.
 * Nodes seen today are highlighted with the family accent.
 */

import { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, GitBranch } from 'lucide-react'
import { SunburstChart } from '../on-demand/knowledge-map/SunburstChart'
import type { SunburstNode } from '../on-demand/knowledge-map/sunburstData'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DomainNode {
  id: string          // dot-notation: "ramble", "ramble.engineering"
  label: string
  description?: string
  weight?: number
  lastSeen?: string   // YYYY-MM-DD UTC
  fixed?: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function parseDomainTreeJsonl(text: string): DomainNode[] {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .flatMap(line => {
      try { return [JSON.parse(line) as DomainNode] }
      catch { return [] }
    })
}

function nodeDepth(id: string): number {
  return id.split('.').length - 1
}

function nodeParentId(id: string): string | null {
  const parts = id.split('.')
  if (parts.length === 1) return null
  return parts.slice(0, -1).join('.')
}

// ── Color families (matches knowledge-map palette) ────────────────────────────

interface ColorFamily {
  domain: string
  light: string
  mid: string
  deep: string
  accent: string
}

const COLOR_FAMILIES: ColorFamily[] = [
  { domain: '#E0897A', light: '#F2C4BC', mid: '#E8937E', deep: '#C8604D', accent: '#B5483A' },
  { domain: '#5BA89A', light: '#B5DDD4', mid: '#6BB8A8', deep: '#3D8B7A', accent: '#2D7568' },
  { domain: '#D4A64E', light: '#F0DDB0', mid: '#E0B45C', deep: '#B8893A', accent: '#9A7030' },
  { domain: '#6B8DB5', light: '#B8CDE0', mid: '#7A9CC4', deep: '#4A729A', accent: '#3A5F85' },
  { domain: '#A07AAD', light: '#D4BDD9', mid: '#B08ABC', deep: '#7D5A8A', accent: '#6A4A78' },
  { domain: '#B08560', light: '#DCC8AE', mid: '#C09570', deep: '#8E6840', accent: '#755530' },
  { domain: '#7FA06E', light: '#C4D9B8', mid: '#8FB07E', deep: '#5E8550', accent: '#4D7040' },
  { domain: '#C47A8A', light: '#E8BEC6', mid: '#D48A9A', deep: '#A85A6A', accent: '#924A5A' },
]

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function lerpColor(a: string, b: string, t: number): string {
  const ca = hexToRgb(a), cb = hexToRgb(b)
  return `rgb(${Math.round(ca.r + (cb.r - ca.r) * t)},${Math.round(ca.g + (cb.g - ca.g) * t)},${Math.round(ca.b + (cb.b - ca.b) * t)})`
}

function childColor(family: ColorFamily, score: number, isLive: boolean): string {
  if (isLive) return lerpColor(family.mid, family.accent, Math.max(0.3, score))
  if (score < 0.5) return lerpColor(family.light, family.mid, score * 2)
  return lerpColor(family.mid, family.deep, (score - 0.5) * 2)
}

// ── Sunburst data builder ─────────────────────────────────────────────────────

export function buildDomainSunburstData(nodes: DomainNode[], today: string): SunburstNode {
  const topLevel = nodes.filter(n => nodeDepth(n.id) === 0)
  const maxWeight = Math.max(1, ...nodes.map(n => n.weight ?? 1))

  const domainNodes: SunburstNode[] = topLevel.map((parent, di) => {
    const family = COLOR_FAMILIES[di % COLOR_FAMILIES.length]
    const children = nodes.filter(n => nodeParentId(n.id) === parent.id)

    const childNodes: SunburstNode[] = children.map(child => {
      const score = (child.weight ?? 1) / maxWeight
      const isLive = child.lastSeen === today
      return {
        name: child.label,
        value: Math.max(1, child.weight ?? 1),
        topicData: { score, matchCount: 0, mentionCount: child.weight ?? 1, isLive },
        itemStyle: { color: childColor(family, score, isLive) },
      }
    })

    // Leaf domain — synthetic self-child so it appears in the outer ring
    if (childNodes.length === 0) {
      const score = (parent.weight ?? 1) / maxWeight
      const isLive = parent.lastSeen === today
      childNodes.push({
        name: parent.label,
        value: Math.max(1, parent.weight ?? 1),
        topicData: { score, matchCount: 0, mentionCount: parent.weight ?? 1, isLive },
        itemStyle: { color: childColor(family, score, isLive) },
      })
    }

    return {
      name: parent.label,
      value: childNodes.reduce((s, c) => s + c.value, 0),
      children: childNodes,
      itemStyle: { color: family.domain },
    }
  })

  return {
    name: 'Domains',
    children: domainNodes,
    value: domainNodes.reduce((s, d) => s + d.value, 0),
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

interface DomainTreeSunburstProps {
  nodes: DomainNode[]
  /** UTC date string YYYY-MM-DD — nodes seen on this date are highlighted */
  today: string
  /** Height of the sunburst in px (default 200) */
  height?: number
}

export const DomainTreeSunburst: React.FC<DomainTreeSunburstProps> = ({
  nodes,
  today,
  height = 200,
}) => {
  const [open, setOpen] = useState(true)

  const topLevelCount = useMemo(
    () => nodes.filter(n => nodeDepth(n.id) === 0).length,
    [nodes],
  )

  const sunburstData = useMemo(
    () => buildDomainSunburstData(nodes, today),
    [nodes, today],
  )

  if (nodes.length === 0) return null

  return (
    <div className="mb-1">
      {/* Section header */}
      <button
        onClick={() => setOpen(prev => !prev)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left group"
      >
        <GitBranch size={9} className="text-slate-300 shrink-0" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
          Domains
        </span>
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-[9px] text-slate-300 tabular-nums">{topLevelCount}</span>
        <span className="text-slate-200 group-hover:text-slate-400 transition-colors ml-1">
          {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        </span>
      </button>

      {/* Sunburst */}
      {open && (
        <div style={{ height }} className="w-full">
          <SunburstChart data={sunburstData} currentTopic={null} />
        </div>
      )}

      {/* Divider */}
      <div className="mx-3 mt-1 mb-1 h-px bg-slate-100" />
    </div>
  )
}
