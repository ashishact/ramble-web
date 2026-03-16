/**
 * Sunburst Data Transform — Knowledge Map
 *
 * Converts TopicCoverage[] into ECharts sunburst data tree.
 * Ring 1 = domains, Ring 2 = topics.
 *
 * Color approach inspired by the Coffee Sensory Lexicon wheel:
 * - Each domain gets a curated color family (warm coral, teal, amber, etc.)
 * - Topics within a domain are tints/shades of that family
 * - Coverage score controls depth: well-covered = deeper, gaps = lighter
 */

import type { TopicCoverage } from './coverageScorer'

export interface SunburstNode {
  name: string
  value: number
  children?: SunburstNode[]
  itemStyle?: {
    color?: string
    borderColor?: string
    borderWidth?: number
    shadowBlur?: number
    shadowColor?: string
  }
  emphasis?: {
    itemStyle?: {
      shadowBlur?: number
      shadowColor?: string
    }
  }
  topicData?: {
    score: number
    matchCount: number
    mentionCount: number
    isLive: boolean
  }
}

// ── Curated Color Families ─────────────────────────────────────────
// Each family: [domain ring, ...topic shades from lightest to deepest]
// Inspired by warm, rich palettes — earthy, editorial feel.

interface ColorFamily {
  domain: string        // Muted color for domain ring
  light: string         // Low-coverage topic
  mid: string           // Medium coverage
  deep: string          // High coverage
  accent: string        // Live/current topic highlight
}

const COLOR_FAMILIES: ColorFamily[] = [
  // Coral / Terracotta
  { domain: '#E0897A', light: '#F2C4BC', mid: '#E8937E', deep: '#C8604D', accent: '#B5483A' },
  // Teal / Sea
  { domain: '#5BA89A', light: '#B5DDD4', mid: '#6BB8A8', deep: '#3D8B7A', accent: '#2D7568' },
  // Amber / Gold
  { domain: '#D4A64E', light: '#F0DDB0', mid: '#E0B45C', deep: '#B8893A', accent: '#9A7030' },
  // Slate Blue / Steel
  { domain: '#6B8DB5', light: '#B8CDE0', mid: '#7A9CC4', deep: '#4A729A', accent: '#3A5F85' },
  // Plum / Mauve
  { domain: '#A07AAD', light: '#D4BDD9', mid: '#B08ABC', deep: '#7D5A8A', accent: '#6A4A78' },
  // Warm Brown / Spice
  { domain: '#B08560', light: '#DCC8AE', mid: '#C09570', deep: '#8E6840', accent: '#755530' },
  // Sage / Olive
  { domain: '#7FA06E', light: '#C4D9B8', mid: '#8FB07E', deep: '#5E8550', accent: '#4D7040' },
  // Rose / Dusty Pink
  { domain: '#C47A8A', light: '#E8BEC6', mid: '#D48A9A', deep: '#A85A6A', accent: '#924A5A' },
  // Burnt Orange
  { domain: '#CC7A45', light: '#E8C0A0', mid: '#D88A55', deep: '#B06030', accent: '#954E25' },
  // Ocean / Deep Teal
  { domain: '#4A90A0', light: '#A8CED6', mid: '#5AA0B0', deep: '#387888', accent: '#2D6575' },
  // Moss / Forest
  { domain: '#6E9060', light: '#B8D0AE', mid: '#7EA070', deep: '#507848', accent: '#40653A' },
  // Dusty Violet
  { domain: '#8A70A8', light: '#C4B4D6', mid: '#9A80B8', deep: '#6E5090', accent: '#5C4080' },
]

/**
 * Interpolate between two hex colors.
 * t = 0 → colorA, t = 1 → colorB
 */
function lerpColor(colorA: string, colorB: string, t: number): string {
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)
  const r = Math.round(a.r + (b.r - a.r) * t)
  const g = Math.round(a.g + (b.g - a.g) * t)
  const bl = Math.round(a.b + (b.b - a.b) * t)
  return `rgb(${r}, ${g}, ${bl})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * Get topic color from its domain's family.
 * Score 0 → light, score 0.5 → mid, score 1 → deep.
 * Live topics shift toward accent.
 */
function topicColor(family: ColorFamily, score: number, isLive: boolean): string {
  if (isLive) {
    // Live: blend from mid toward accent
    return lerpColor(family.mid, family.accent, Math.max(0.3, score))
  }
  if (score < 0.5) {
    // Low coverage: light → mid
    return lerpColor(family.light, family.mid, score * 2)
  }
  // High coverage: mid → deep
  return lerpColor(family.mid, family.deep, (score - 0.5) * 2)
}

/**
 * Deterministic family index from a string.
 */
function stringToIndex(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % COLOR_FAMILIES.length
}

/**
 * Build the sunburst data tree from coverage data.
 */
export function buildSunburstData(topics: TopicCoverage[], currentTopic: string | null): SunburstNode {
  // Group by domain
  const domainMap = new Map<string, TopicCoverage[]>()
  for (const t of topics) {
    const list = domainMap.get(t.domain) || []
    list.push(t)
    domainMap.set(t.domain, list)
  }

  const domainNodes: SunburstNode[] = []
  const domainNames = Array.from(domainMap.keys())
  const isSingleDomain = domainNames.length === 1

  for (let di = 0; di < domainNames.length; di++) {
    const domain = domainNames[di]
    const domainTopics = domainMap.get(domain)!

    // When only one domain, give each TOPIC its own color family
    // When multiple domains, each domain gets one family
    const domainFamilyIdx = domainNames.length <= COLOR_FAMILIES.length
      ? di
      : stringToIndex(domain)
    const domainFamily = COLOR_FAMILIES[domainFamilyIdx % COLOR_FAMILIES.length]

    const topicChildren: SunburstNode[] = domainTopics.map((t, ti) => {
      const family = isSingleDomain
        ? COLOR_FAMILIES[ti % COLOR_FAMILIES.length]
        : domainFamily
      const isCurrent = t.topicName === currentTopic
      const color = topicColor(family, t.score, t.isLive)

      return {
        name: t.shortName,
        value: Math.max(1, t.mentionCount),
        topicData: {
          score: t.score,
          matchCount: t.matchCount,
          mentionCount: t.mentionCount,
          isLive: t.isLive,
        },
        itemStyle: {
          color,
          ...(isCurrent ? {
            borderColor: '#fff',
            borderWidth: 2,
            shadowBlur: 12,
            shadowColor: family.accent + '99',
          } : {}),
        },
        ...(isCurrent ? {
          emphasis: {
            itemStyle: {
              shadowBlur: 16,
              shadowColor: family.accent + 'CC',
            },
          },
        } : {}),
      }
    })

    domainNodes.push({
      name: domain,
      value: topicChildren.reduce((sum, c) => sum + c.value, 0),
      children: topicChildren,
      itemStyle: {
        color: isSingleDomain ? '#9E8E82' : domainFamily.domain,
      },
    })
  }

  return {
    name: 'Knowledge',
    children: domainNodes,
    value: domainNodes.reduce((sum, d) => sum + d.value, 0),
  }
}
