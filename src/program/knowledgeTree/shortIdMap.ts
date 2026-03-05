import type { ShortIdMap } from './types'

// Prefixes: e=entity, n=node, m=memory, g=goal, t=timeline
export function createShortIdMap(): ShortIdMap {
  return {
    toShort: new Map(),
    toReal: new Map(),
    nextIndex: { e: 1, n: 1, m: 1, g: 1, t: 1 },
  }
}

export function addMapping(map: ShortIdMap, realId: string, prefix: string): string {
  const existing = map.toShort.get(realId)
  if (existing) return existing

  if (!(prefix in map.nextIndex)) {
    map.nextIndex[prefix] = 1
  }

  const shortId = `${prefix}${map.nextIndex[prefix]++}`
  map.toShort.set(realId, shortId)
  map.toReal.set(shortId, realId)
  return shortId
}

export function resolveShortId(map: ShortIdMap, shortId: string): string | undefined {
  return map.toReal.get(shortId)
}

// Resolve all short IDs in an action's fields to real IDs
export function resolveActionIds<T extends Record<string, unknown>>(
  map: ShortIdMap,
  action: T,
  fields: string[]
): T {
  const resolved = { ...action }
  for (const field of fields) {
    const value = resolved[field]
    if (typeof value === 'string') {
      if (map.toReal.has(value)) {
        (resolved as Record<string, unknown>)[field] = map.toReal.get(value)!
      } else if (/^[a-z]\d+$/.test(value)) {
        // Looks like a short ID (e.g. "n5", "m3") but wasn't in the map
        console.warn(`[ShortIdMap] Unresolved short ID "${value}" in field "${field}" for action type "${(action as Record<string, unknown>).type}"`)
      }
    }
    if (Array.isArray(value)) {
      (resolved as Record<string, unknown>)[field] = value.map((v: unknown) => {
        if (typeof v === 'string' && map.toReal.has(v)) return map.toReal.get(v)!
        if (typeof v === 'string' && /^[a-z]\d+$/.test(v)) {
          console.warn(`[ShortIdMap] Unresolved short ID "${v}" in array field "${field}" for action type "${(action as Record<string, unknown>).type}"`)
        }
        return v
      })
    }
  }
  return resolved
}
