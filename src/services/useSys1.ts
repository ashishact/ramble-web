/**
 * useSys1 — hook for sending messages through the SYS-I worker API
 *
 * Handles the full flow: POST to worker → get quickResponse → save to local DuckDB.
 * All text and audio results go through this hook.
 */

import { useCallback } from 'react';
import { useKernel } from '../program/hooks';
import { authFetch } from './rambleApi';
import { profileStorage } from '../lib/profileStorage';
import { eventBus } from '../lib/eventBus';
import type { STTQuickResponse } from './stt/types';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

export const SYS1_SESSION_KEY = 'sys1-chat-session-id';

export function useSys1() {
  const { saveUserTurn, ingestQuickResult } = useKernel();

  const sendMessage = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const sessionId = profileStorage.getItem(SYS1_SESSION_KEY) ?? 'default';

    // Write user turn immediately — message is never lost even if the API fails
    const userConvId = await saveUserTurn(trimmed, sessionId, 'typed');

    const res = await authFetch(`${WORKER_URL}/api/v1/sys1/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: trimmed, sessionId }),
    });

    if (!res.ok) throw new Error(`SYS-I message failed: HTTP ${res.status}`);

    const data = await res.json() as { messageId: string; quickResponse?: STTQuickResponse };

    if (data.quickResponse?.response?.trim()) {
      const responseText = data.quickResponse.response.trim();
      eventBus.emit('tts:speak', { text: responseText, mode: 'replace' });
      // Pass userConvId so ingestQuickResult skips re-writing the user turn
      await ingestQuickResult({ transcript: trimmed, quickResponse: data.quickResponse, sessionId }, userConvId);
    }
  }, [saveUserTurn, ingestQuickResult]);

  return { sendMessage };
}
