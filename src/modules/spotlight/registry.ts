/**
 * Spotlight Bar Registry
 *
 * Module-level constant array of all bar definitions.
 * IMPORTANT: This array's length must be stable — the SpotlightBar wrapper
 * calls each bar's useData() unconditionally in a loop, which is safe
 * because this is a constant-length array (satisfies React hook rules).
 *
 * Color assignments (hardcoded Tailwind — NOT daisyUI variables):
 *   Goal     → violet   (bg-violet-50, text-violet-700, bg-violet-500)
 *   Memory   → teal     (bg-teal-50,   text-teal-700,   bg-teal-500)
 *   Question → sky      (bg-sky-50,    text-sky-700,    bg-sky-500)
 *
 * Available for future bars:
 *   amber, rose, emerald, orange, indigo, fuchsia, lime, cyan
 */

import { goalBar } from './bars/GoalBar';
import { memoryBar } from './bars/MemoryBar';
import type { SpotlightBarDefinition } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SPOTLIGHT_BARS: SpotlightBarDefinition<any>[] = [
	goalBar,
	memoryBar,
];
