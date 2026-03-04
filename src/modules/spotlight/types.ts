/**
 * Spotlight Bar System — Type Definitions
 *
 * Each bar implements this contract so the SpotlightBar wrapper can:
 * 1. Call all useData() hooks unconditionally (React hook rules)
 * 2. Render the picker dropdown generically (icon + name + preview)
 * 3. Apply consistent color styling without per-bar branching
 */

import type { LucideIcon } from 'lucide-react';
import type { FC } from 'react';

export type SpotlightBarType = 'goal' | 'memory' | 'question';

export interface SpotlightBarData {
	hasContent: boolean;
	label: string;
}

export interface SpotlightBarDefinition<T extends SpotlightBarData = SpotlightBarData> {
	type: SpotlightBarType;
	name: string;
	icon: LucideIcon;
	/** Static Tailwind classes — avoids JIT issues with dynamic interpolation */
	bgClass: string;
	textClass: string;
	/** React hook returning bar-specific data. Called unconditionally by wrapper. */
	useData: () => T;
	/** React component for bar content. Rendered as JSX (own hook context). */
	Component: FC<{ data: T }>;
}
