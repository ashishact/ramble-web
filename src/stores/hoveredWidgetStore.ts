/**
 * Hovered Widget Store — Tracks the currently-hovered bento leaf.
 *
 * In-memory only — hover state is ephemeral.
 * Provides subscribe() compatible with React's useSyncExternalStore.
 */

export interface HoveredWidget {
  nodeId: string;
  widgetType: string;
}

type Listener = () => void;
const listeners = new Set<Listener>();

let hovered: HoveredWidget | null = null;

function notify(): void {
  listeners.forEach(fn => fn());
}

export const hoveredWidgetStore = {
  /** Set the currently-hovered widget. */
  set(nodeId: string, widgetType: string): void {
    hovered = { nodeId, widgetType };
    notify();
  },

  /** Clear hover — only if the clearing node is still the hovered one (prevents race conditions). */
  clear(nodeId: string): void {
    if (hovered?.nodeId === nodeId) {
      hovered = null;
      notify();
    }
  },

  getState(): HoveredWidget | null {
    return hovered;
  },

  /** Subscribe to changes. Returns unsubscribe function. Compatible with useSyncExternalStore. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
