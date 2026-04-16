/**
 * Knowledge Graph Feature Flags
 *
 * Controls progressive migration from WatermelonDB to DuckDB.
 * Each flag gates a specific phase of the migration.
 *
 * All flags default to false — enable them as each phase is verified.
 * Flags are stored in localStorage so they persist across page reloads
 * and can be toggled from the browser console.
 */

const PREFIX = 'ramble:kg:'

function getFlag(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue
  const stored = localStorage.getItem(PREFIX + key)
  if (stored === null) return defaultValue
  return stored === 'true'
}

function setFlag(key: string, value: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(PREFIX + key, String(value))
}

/** Phase 1-3 complete: DuckDB initialized and reactive layer ready */
export function isDuckDBEnabled(): boolean {
  return getFlag('duckdbEnabled', false)
}

/** Phase 4: Conversations are dual-written to both WatermelonDB and DuckDB */
export function isDualWriteConversations(): boolean {
  return getFlag('dualWriteConversations', false)
}

/** Phase 6: Input routed through SinglePassProcessor instead of old pipeline */
export function isSinglePassProcessor(): boolean {
  return getFlag('singlePassProcessor', false)
}

/** Phase 11: Per-widget flag for rendering from DuckDB instead of WatermelonDB */
export function isWidgetUsingDuckDB(widgetId: string): boolean {
  return getFlag(`widget:${widgetId}`, false)
}

/** Final: WatermelonDB fully disabled — DuckDB is the sole data store */
export function isWatermelonDisabled(): boolean {
  return getFlag('watermelonDisabled', false)
}

/**
 * SYS-II consolidation via ChatGPT extension.
 * Disabled by default — enable from console: kgFlags.sys2Consolidation = true
 * TODO: remove once we migrate SYS-II to a direct API path
 */
export function isSys2ConsolidationEnabled(): boolean {
  return getFlag('sys2Consolidation', false)
}

// ============================================================================
// Console API for toggling flags
// ============================================================================

export const featureFlags = {
  get duckdbEnabled() { return isDuckDBEnabled() },
  set duckdbEnabled(v: boolean) { setFlag('duckdbEnabled', v) },

  get dualWriteConversations() { return isDualWriteConversations() },
  set dualWriteConversations(v: boolean) { setFlag('dualWriteConversations', v) },

  get singlePassProcessor() { return isSinglePassProcessor() },
  set singlePassProcessor(v: boolean) { setFlag('singlePassProcessor', v) },

  get watermelonDisabled() { return isWatermelonDisabled() },
  set watermelonDisabled(v: boolean) { setFlag('watermelonDisabled', v) },

  get sys2Consolidation() { return isSys2ConsolidationEnabled() },
  set sys2Consolidation(v: boolean) { setFlag('sys2Consolidation', v) },

  setWidget(widgetId: string, enabled: boolean) {
    setFlag(`widget:${widgetId}`, enabled)
  },

  isWidgetEnabled(widgetId: string) {
    return isWidgetUsingDuckDB(widgetId)
  },
}

// Expose to browser console
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).kgFlags = featureFlags
}
