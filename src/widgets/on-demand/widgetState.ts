/**
 * Widget State — persistent per-widget state storage
 *
 * Each widget instance (keyed by bento leaf nodeId) can store arbitrary state
 * that persists across page reloads. Uses profileStorage so state is scoped
 * to the active profile.
 *
 * Storage shape: Record<nodeId, Record<string, unknown>>
 */

import { z } from 'zod';
import { profileStorage } from '../../lib/profileStorage';

const STORAGE_KEY = 'widget-states';

const WidgetStateSchema = z.record(z.string(), z.unknown());
const WidgetStatesSchema = z.record(z.string(), WidgetStateSchema);

export type WidgetState = z.infer<typeof WidgetStateSchema>;

function loadAll(): Record<string, WidgetState> {
  try {
    const raw = profileStorage.getJSON<unknown>(STORAGE_KEY);
    if (raw == null) return {};
    const result = WidgetStatesSchema.safeParse(raw);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function saveAll(states: Record<string, WidgetState>): void {
  try {
    profileStorage.setJSON(STORAGE_KEY, states);
  } catch (error) {
    console.warn('[widgetState] Failed to save:', error);
  }
}

/** Get the full state object for a widget instance */
export function getWidgetState(nodeId: string): WidgetState {
  return loadAll()[nodeId] ?? {};
}

/** Get a single value from widget state */
export function getWidgetValue<T = unknown>(nodeId: string, key: string, defaultValue?: T): T {
  const state = getWidgetState(nodeId);
  return (state[key] as T) ?? (defaultValue as T);
}

/** Merge a partial update into widget state */
export function updateWidgetState(nodeId: string, patch: Record<string, unknown>): void {
  const all = loadAll();
  all[nodeId] = { ...all[nodeId], ...patch };
  saveAll(all);
}

/** Remove all state for a widget instance */
export function removeWidgetState(nodeId: string): void {
  const all = loadAll();
  delete all[nodeId];
  saveAll(all);
}
