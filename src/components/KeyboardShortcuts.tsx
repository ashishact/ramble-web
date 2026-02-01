/**
 * Keyboard Shortcuts Manager
 *
 * Global component that manages keyboard shortcuts with timing constraints.
 * Shortcuts require the key to be pressed and released within a time limit
 * to prevent conflicts with other uses of the same keys.
 *
 * Pattern: Modifier (Alt/Option) + Key (pressed and released within 300ms)
 */

import { useEffect, useRef, useCallback } from 'react';

// Time limit for key press duration (in milliseconds)
const KEY_PRESS_TIME_LIMIT = 300;

interface ShortcutHandler {
	code: string; // Physical key code (e.g., 'KeyU')
	modifiers: {
		alt?: boolean;
		ctrl?: boolean;
		shift?: boolean;
		meta?: boolean;
	};
	action: () => void;
}

interface KeyboardShortcutsProps {
	onProfileSwitcher: () => void;
}

export function KeyboardShortcuts({ onProfileSwitcher }: KeyboardShortcutsProps) {
	// Track when keys are pressed down
	const keyDownTimesRef = useRef<Map<string, number>>(new Map());

	// Define all shortcuts
	const shortcuts: ShortcutHandler[] = [
		{
			code: 'KeyU',
			modifiers: { alt: true },
			action: onProfileSwitcher,
		},
		// Add more shortcuts here as needed
	];

	const handleKeyDown = useCallback((e: KeyboardEvent) => {
		// Record the time when a key is pressed (if not already recorded)
		if (!keyDownTimesRef.current.has(e.code)) {
			keyDownTimesRef.current.set(e.code, Date.now());
		}
	}, []);

	const handleKeyUp = useCallback((e: KeyboardEvent) => {
		const keyDownTime = keyDownTimesRef.current.get(e.code);
		keyDownTimesRef.current.delete(e.code);

		// If we don't have a keydown time, ignore
		if (!keyDownTime) return;

		// Check if key was held for too long
		const pressDuration = Date.now() - keyDownTime;
		if (pressDuration > KEY_PRESS_TIME_LIMIT) {
			return; // Key was held too long, ignore
		}

		// Check each shortcut
		for (const shortcut of shortcuts) {
			if (e.code !== shortcut.code) continue;

			// Check modifiers
			const modifiersMatch =
				(shortcut.modifiers.alt ?? false) === e.altKey &&
				(shortcut.modifiers.ctrl ?? false) === e.ctrlKey &&
				(shortcut.modifiers.shift ?? false) === e.shiftKey &&
				(shortcut.modifiers.meta ?? false) === e.metaKey;

			if (modifiersMatch) {
				e.preventDefault();
				e.stopPropagation();
				shortcut.action();
				return;
			}
		}
	}, [shortcuts]);

	useEffect(() => {
		window.addEventListener('keydown', handleKeyDown, true);
		window.addEventListener('keyup', handleKeyUp, true);

		return () => {
			window.removeEventListener('keydown', handleKeyDown, true);
			window.removeEventListener('keyup', handleKeyUp, true);
		};
	}, [handleKeyDown, handleKeyUp]);

	return null; // This component doesn't render anything
}
