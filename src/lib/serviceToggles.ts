/**
 * Service Toggles — Reactive enable/disable gates for extension & native services.
 *
 * Persisted in profileStorage so toggles survive reload.
 * Provides subscribe() compatible with React's useSyncExternalStore.
 *
 * When disabled, the corresponding service reports unavailable
 * through its existing isAvailable / isRambleAvailable gate.
 */

import { profileStorage } from './profileStorage';

type Listener = () => void;
const listeners = new Set<Listener>();

const EXT_KEY = 'service-extension-enabled';
const NATIVE_KEY = 'service-native-enabled';

function notify(): void {
  listeners.forEach(fn => fn());
}

export function getExtensionEnabled(): boolean {
  const val = profileStorage.getItem(EXT_KEY);
  return val === null ? true : val === 'true';
}

export function setExtensionEnabled(enabled: boolean): void {
  profileStorage.setItem(EXT_KEY, String(enabled));
  notify();
}

export function getNativeEnabled(): boolean {
  const val = profileStorage.getItem(NATIVE_KEY);
  return val === null ? true : val === 'true';
}

export function setNativeEnabled(enabled: boolean): void {
  profileStorage.setItem(NATIVE_KEY, String(enabled));
  notify();
}

/** Subscribe to any toggle change. Returns unsubscribe. Compatible with useSyncExternalStore. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
