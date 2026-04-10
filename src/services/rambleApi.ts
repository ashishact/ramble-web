/**
 * Ramble API Client — Auth + Cloud Store
 *
 * Wraps /api/auth/* and /api/v1/store/* endpoints.
 */

import { authStore } from '../stores/authStore';
import { getWorkerHeaders } from './cfGateway';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

// ── Auth ─────────────────────────────────────────────────────────────

export async function register(email: string, password: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/auth/register`, {
    method: 'POST',
    headers: getWorkerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((data as any).error || `Registration failed: ${res.status}`);
  }

  const tokens = await res.json() as { accessToken: string; refreshToken: string; userId: string; email: string };
  authStore.setTokens(tokens);
}

export async function login(email: string, password: string): Promise<void> {
  const res = await fetch(`${WORKER_URL}/api/auth/login`, {
    method: 'POST',
    headers: getWorkerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((data as any).error || `Login failed: ${res.status}`);
  }

  const tokens = await res.json() as { accessToken: string; refreshToken: string; userId: string; email: string };
  authStore.setTokens(tokens);
}

export async function refreshToken(): Promise<boolean> {
  const state = authStore.getState();
  if (!state.tokens) return false;

  try {
    const res = await fetch(`${WORKER_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: getWorkerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        refreshToken: state.tokens.refreshToken,
        userId: state.tokens.userId,
      }),
    });

    if (!res.ok) {
      authStore.clearTokens();
      return false;
    }

    const data = await res.json() as { accessToken: string; refreshToken: string };
    authStore.setTokens({
      ...state.tokens,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    return true;
  } catch {
    authStore.clearTokens();
    return false;
  }
}

// ── Proactive token refresh ──────────────────────────────────────────

const REFRESH_BUFFER_MS = 2 * 60 * 1000; // refresh 2 min before expiry
let refreshPromise: Promise<boolean> | null = null;

function getTokenExpiry(): number | null {
  const state = authStore.getState();
  if (!state.tokens?.accessToken) return null;
  try {
    const payload = JSON.parse(atob(state.tokens.accessToken.split('.')[1]));
    return payload.exp * 1000; // convert to ms
  } catch {
    return null;
  }
}

async function ensureFreshToken(): Promise<void> {
  if (!authStore.isAuthenticated) return;

  const expiry = getTokenExpiry();
  if (!expiry) return;

  if (Date.now() + REFRESH_BUFFER_MS < expiry) return; // still fresh

  // Deduplicate concurrent refresh calls
  if (!refreshPromise) {
    refreshPromise = refreshToken().finally(() => { refreshPromise = null; });
  }
  await refreshPromise;
}

// ── Auth fetch wrapper ───────────────────────────────────────────────

/**
 * Fetch with automatic token refresh.
 * Use this instead of raw fetch() for all worker API calls that need auth.
 */
export async function authFetch(url: string, init: RequestInit): Promise<Response> {
  // Proactively refresh before it expires
  await ensureFreshToken();

  const res = await fetch(url, {
    ...init,
    headers: getWorkerHeaders(init.headers as Record<string, string> | undefined),
  });

  // Safety net: if we still got 401 (clock skew, race), try one refresh + retry
  if (res.status !== 401 || !authStore.isAuthenticated) return res;

  const refreshed = await refreshToken();
  if (!refreshed) return res;

  return fetch(url, {
    ...init,
    headers: getWorkerHeaders(init.headers as Record<string, string> | undefined),
  });
}

// ── Store ────────────────────────────────────────────────────────────

export async function storePut(
  namespace: string,
  key: string,
  body: string | ArrayBuffer,
  contentType = 'text/html',
): Promise<{ ok: boolean; publicUrl: string; size: number }> {
  const res = await authFetch(`${WORKER_URL}/api/v1/store/${namespace}/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((data as any).error || `Store put failed: ${res.status}`);
  }

  return res.json() as Promise<{ ok: boolean; publicUrl: string; size: number }>;
}

export async function storeGet(namespace: string, key: string): Promise<Response> {
  return authFetch(`${WORKER_URL}/api/v1/store/${namespace}/${key}`, {
    method: 'GET',
  });
}

export async function storeDelete(namespace: string, key: string): Promise<void> {
  const res = await authFetch(`${WORKER_URL}/api/v1/store/${namespace}/${key}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((data as any).error || `Store delete failed: ${res.status}`);
  }
}

export async function storeList(namespace?: string): Promise<any[]> {
  const url = namespace
    ? `${WORKER_URL}/api/v1/store?namespace=${encodeURIComponent(namespace)}`
    : `${WORKER_URL}/api/v1/store`;

  const res = await authFetch(url, {
    method: 'GET',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((data as any).error || `Store list failed: ${res.status}`);
  }

  return res.json() as Promise<any[]>;
}
