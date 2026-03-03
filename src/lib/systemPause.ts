/**
 * System Pause — Global reactive toggle for pausing all kernel input processing.
 *
 * Stored in raw localStorage (not profileStorage) because this is a system-level
 * control, not per-profile. Provides a subscribe() for React components to
 * re-render when the state changes.
 */

const STORAGE_KEY = 'ramble:system-paused';

type Listener = (paused: boolean) => void;
const listeners = new Set<Listener>();

function read(): boolean {
  return localStorage.getItem(STORAGE_KEY) === 'true';
}

function write(paused: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(paused));
  listeners.forEach(fn => fn(paused));
}

export const systemPause = {
  get isPaused(): boolean {
    return read();
  },

  toggle(): boolean {
    const next = !read();
    write(next);
    return next;
  },

  pause(): void {
    write(true);
  },

  resume(): void {
    write(false);
  },

  /** Subscribe to changes. Returns unsubscribe function. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
