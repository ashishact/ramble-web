/**
 * Auth Store — Device identity + server-assigned userId + JWT tokens
 *
 * Identity model:
 *   deviceId  — client-generated UUID, unique per device, never changes
 *   userId    — server-assigned on first call to POST /api/v1/identity,
 *               stored locally, sent as X-User-ID on every request.
 *               One userId per person, many deviceIds possible.
 *
 * On signup: email is attached to userId on the server.
 * On login: server returns userId (looked up by email), client stores it.
 */

type Listener = () => void;
const listeners = new Set<Listener>();

const LS_DEVICE_ID = 'ramble_device_id';         // client-generated UUID, unique per device
const LS_USER_ID   = 'ramble_canonical_user_id'; // server-assigned userId
const LS_AUTH_TOKENS = 'ramble_auth_tokens';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
}

export interface AuthState {
  deviceId: string;
  userId: string | null;
  isAuthenticated: boolean;
  tokens: AuthTokens | null;
  email: string | null;
}

// ── Initialize ────────────────────────────────────────────────────────

function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(LS_DEVICE_ID, id);
  }
  return id;
}

function loadUserId(): string | null {
  return localStorage.getItem(LS_USER_ID);
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

// ── State ─────────────────────────────────────────────────────────────

const deviceId = getOrCreateDeviceId();
let userId = loadTokens()?.userId ?? loadUserId();  // JWT userId takes priority
let tokens = loadTokens();

function buildState(): AuthState {
  return {
    deviceId,
    userId,
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

// ── Public API ────────────────────────────────────────────────────────

export const authStore = {
  get deviceId(): string {
    return deviceId;
  },

  get userId(): string | null {
    return userId;
  },

  get isAuthenticated(): boolean {
    return tokens !== null;
  },

  /** Called on first launch after POST /api/v1/identity returns a userId */
  setUserId(id: string): void {
    userId = id;
    localStorage.setItem(LS_USER_ID, id);
    notify();
  },

  setTokens(newTokens: AuthTokens): void {
    tokens = newTokens;
    // JWT userId is the canonical userId — keep them in sync
    userId = newTokens.userId;
    localStorage.setItem(LS_USER_ID, newTokens.userId);
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

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  getState(): AuthState {
    return currentState;
  },
};
