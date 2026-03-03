/**
 * Keyboard Shortcut Registry — Central system for managing global shortcuts.
 *
 * Components register shortcuts via `registerShortcut()` / `unregisterShortcut()`,
 * or more conveniently through the `useShortcut` React hook.
 *
 * A single global `keydown` listener dispatches to the matching handler.
 * Shortcuts are skipped when an input, textarea, or contentEditable element is focused.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShortcutCombo {
  /** The key to match — uses `event.key` (e.g. '[', ']', '1', 'a') */
  key?: string;
  /** Physical key code — uses `event.code` (e.g. 'KeyU', 'Digit1').
   *  Use this instead of `key` when modifiers alter the character (e.g. Alt+U → dead key on macOS). */
  code?: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface Shortcut {
  id: string;
  combo: ShortcutCombo;
  handler: () => void;
  /** Human-readable description for future help/discovery UI */
  description?: string;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, Shortcut>();

/** Register a shortcut. Overwrites any existing shortcut with the same id. */
export const registerShortcut = (shortcut: Shortcut): void => {
  registry.set(shortcut.id, shortcut);
};

/** Unregister a shortcut by id. */
export const unregisterShortcut = (id: string): void => {
  registry.delete(id);
};

/** Get all registered shortcuts (for help/discovery UI). */
export const getShortcuts = (): Shortcut[] => [...registry.values()];

// ---------------------------------------------------------------------------
// Matcher
// ---------------------------------------------------------------------------

const isInputFocused = (): boolean => {
  const el = document.activeElement;
  if (!el) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el as HTMLElement).isContentEditable
  );
};

const matchesCombo = (e: KeyboardEvent, combo: ShortcutCombo): boolean => {
  // Match on physical code or character key (at least one must be specified)
  if (combo.code) {
    if (e.code !== combo.code) return false;
  } else if (combo.key) {
    if (e.key !== combo.key) return false;
  } else {
    return false;
  }
  if (!!combo.ctrl !== e.ctrlKey) return false;
  if (!!combo.alt !== e.altKey) return false;
  if (!!combo.shift !== e.shiftKey) return false;
  if (!!combo.meta !== e.metaKey) return false;
  return true;
};

// ---------------------------------------------------------------------------
// Global listener (installed once on import)
// ---------------------------------------------------------------------------

const handleKeyDown = (e: KeyboardEvent): void => {
  // Don't intercept when user is typing in an input
  if (isInputFocused()) return;

  for (const shortcut of registry.values()) {
    if (matchesCombo(e, shortcut.combo)) {
      e.preventDefault();
      e.stopPropagation();
      shortcut.handler();
      return;
    }
  }
};

window.addEventListener('keydown', handleKeyDown, true);
