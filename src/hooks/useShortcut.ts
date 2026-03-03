/**
 * useShortcut — React hook for registering a global keyboard shortcut.
 *
 * Registers on mount, unregisters on unmount. Handler is kept fresh via ref
 * so the caller doesn't need to memoize it.
 *
 * Usage:
 *   useShortcut('workspace-next', { key: ']', ctrl: true }, () => { ... });
 */

import { useEffect, useRef } from 'react';
import { registerShortcut, unregisterShortcut } from '../lib/shortcuts';
import type { ShortcutCombo } from '../lib/shortcuts';

export const useShortcut = (
  id: string,
  combo: ShortcutCombo,
  handler: () => void,
  description?: string,
): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    registerShortcut({
      id,
      combo,
      handler: () => handlerRef.current(),
      description,
    });
    return () => unregisterShortcut(id);
    // Re-register if combo identity changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, combo.key, combo.code, combo.ctrl, combo.alt, combo.shift, combo.meta, description]);
};
