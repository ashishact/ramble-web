/**
 * System Pause — Global reactive toggle for pausing all kernel input processing.
 *
 * In-memory only — auto-resets on reload so the system always starts running.
 * Provides a subscribe() compatible with React's useSyncExternalStore.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

let paused = false;

function notify(): void {
  listeners.forEach(fn => fn());
}

export const systemPause = {
  get isPaused(): boolean {
    return paused;
  },

  toggle(): boolean {
    paused = !paused;
    notify();
    return paused;
  },

  pause(): void {
    paused = true;
    notify();
  },

  resume(): void {
    paused = false;
    notify();
  },

  /** Subscribe to changes. Returns unsubscribe function. Compatible with useSyncExternalStore. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
