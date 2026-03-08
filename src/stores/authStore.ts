/**
 * Auth Store — Device UUID + JWT token management
 *
 * Persists device identity and auth tokens in localStorage.
 * Provides subscribe/getState pattern for useSyncExternalStore.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

const LS_DEVICE_ID = 'ramble_user_id';
const LS_AUTH_TOKENS = 'ramble_auth_tokens';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
}

export interface AuthState {
  deviceId: string;
  isAuthenticated: boolean;
  tokens: AuthTokens | null;
  email: string | null;
}

// ── Initialize device ID ─────────────────────────────────────────────

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

function loadTokens(): AuthTokens | null {
  try {
    const raw = localStorage.getItem(LS_AUTH_TOKENS);
    if (!raw) return null;
    return JSON.parse(raw) as AuthTokens;
  } catch {
    return null;
  }
}

// ── State ────────────────────────────────────────────────────────────

const deviceId = getOrCreateDeviceId();
let tokens = loadTokens();

function buildState(): AuthState {
  return {
    deviceId,
    isAuthenticated: tokens !== null,
    tokens,
    email: tokens?.email ?? null,
  };
}

let currentState = buildState();

function notify(): void {
  currentState = buildState();
  listeners.forEach(fn => fn());
}

// ── Public API ───────────────────────────────────────────────────────

export const authStore = {
  get deviceId(): string {
    return deviceId;
  },

  get isAuthenticated(): boolean {
    return tokens !== null;
  },

  setTokens(newTokens: AuthTokens): void {
    tokens = newTokens;
    localStorage.setItem(LS_AUTH_TOKENS, JSON.stringify(newTokens));
    notify();
  },

  updateAccessToken(accessToken: string): void {
    if (!tokens) return;
    tokens = { ...tokens, accessToken };
    localStorage.setItem(LS_AUTH_TOKENS, JSON.stringify(tokens));
    notify();
  },

  clearTokens(): void {
    tokens = null;
    localStorage.removeItem(LS_AUTH_TOKENS);
    notify();
  },

  /** Subscribe to changes. Returns unsubscribe function. Compatible with useSyncExternalStore. */
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  getState(): AuthState {
    return currentState;
  },
};
