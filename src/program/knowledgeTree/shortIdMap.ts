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
    if (typeof value === 'string' && map.toReal.has(value)) {
      (resolved as Record<string, unknown>)[field] = map.toReal.get(value)!
    }
    if (Array.isArray(value)) {
      (resolved as Record<string, unknown>)[field] = value.map((v: unknown) =>
        typeof v === 'string' && map.toReal.has(v) ? map.toReal.get(v)! : v
      )
    }
  }
  return resolved
}
