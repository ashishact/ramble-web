/**
 * Spotlight Store — Persists selected bar type.
 *
 * Follows hoveredWidgetStore pattern: get/set/subscribe compatible
 * with React's useSyncExternalStore.
 * Persists to localStorage so selection survives reload.
 */

import type { SpotlightBarType } from './types';

const STORAGE_KEY = 'ramble:spotlight-bar';
const DEFAULT: SpotlightBarType = 'goal';
// Keep in sync with SpotlightBarType when adding new bars
const VALID_TYPES: ReadonlySet<string> = new Set<SpotlightBarType>(['goal', 'memory', 'question']);

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
	listeners.forEach(fn => fn());
}

function readFromStorage(): SpotlightBarType {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw && VALID_TYPES.has(raw)) return raw as SpotlightBarType;
	} catch {
		// localStorage unavailable — fall through
	}
	return DEFAULT;
}

let current: SpotlightBarType = readFromStorage();

export const spotlightStore = {
	get(): SpotlightBarType {
		return current;
	},

	set(type: SpotlightBarType): void {
		if (current === type) return;
		current = type;
		try {
			localStorage.setItem(STORAGE_KEY, type);
		} catch {
			// localStorage unavailable — in-memory only
		}
		notify();
	},

	subscribe(fn: Listener): () => void {
		listeners.add(fn);
		return () => listeners.delete(fn);
	},
};
