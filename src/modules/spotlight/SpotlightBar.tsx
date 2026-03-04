/**
 * Spotlight Bar — Switchable header bar system.
 *
 * Renders the active bar, handles ALT+click picker for switching.
 * All bar useData() hooks are called unconditionally (SPOTLIGHT_BARS
 * is a constant-length array — safe for React hook rules).
 * Bar Components are rendered as JSX elements (own hook context),
 * so only the active bar's component mounts — no hidden elements needed.
 */

import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { SPOTLIGHT_BARS } from './registry';
import { spotlightStore } from './spotlightStore';
import type { SpotlightBarData } from './types';

export function SpotlightBar() {
	const activeType = useSyncExternalStore(spotlightStore.subscribe, spotlightStore.get);
	const [pickerOpen, setPickerOpen] = useState(false);
	const pickerRef = useRef<HTMLDivElement>(null);
	const barRef = useRef<HTMLDivElement>(null);

	// Call ALL bar useData() hooks unconditionally — array is constant-length
	const allData: SpotlightBarData[] = SPOTLIGHT_BARS.map(bar => bar.useData());

	// Find active bar index
	const activeIndex = Math.max(0, SPOTLIGHT_BARS.findIndex(b => b.type === activeType));
	const activeBar = SPOTLIGHT_BARS[activeIndex];
	const ActiveComponent = activeBar.Component;

	// Close picker on ALT key release
	useEffect(() => {
		if (!pickerOpen) return;

		const handleKeyUp = (e: KeyboardEvent) => {
			if (e.key === 'Alt') setPickerOpen(false);
		};
		const handleBlur = () => setPickerOpen(false);

		window.addEventListener('keyup', handleKeyUp);
		window.addEventListener('blur', handleBlur);
		return () => {
			window.removeEventListener('keyup', handleKeyUp);
			window.removeEventListener('blur', handleBlur);
		};
	}, [pickerOpen]);

	// Close picker on click outside
	useEffect(() => {
		if (!pickerOpen) return;

		const handleClick = (e: MouseEvent) => {
			if (
				pickerRef.current && !pickerRef.current.contains(e.target as Node) &&
				barRef.current && !barRef.current.contains(e.target as Node)
			) {
				setPickerOpen(false);
			}
		};

		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [pickerOpen]);

	const handleBarClick = (e: React.MouseEvent) => {
		if (e.altKey) {
			e.preventDefault();
			e.stopPropagation();
			setPickerOpen(prev => !prev);
		}
	};

	const handleSelect = (type: typeof activeBar.type) => {
		spotlightStore.set(type);
		setPickerOpen(false);
	};

	return (
		<div className="relative flex-1 min-w-0">
			{/* Active bar */}
			<div
				ref={barRef}
				onClick={handleBarClick}
				className={`group flex items-center gap-2 px-2 py-0.5 rounded text-xs min-w-0 ${activeBar.bgClass}`}
				data-doc='{"title":"Spotlight Bar","desc":"Shows highlighted info. ALT+click to switch between goal, memory, and question bars."}'
			>
				{/* Bar content — rendered as JSX element, own hook context */}
				<ActiveComponent data={allData[activeIndex]} />
			</div>

			{/* Picker dropdown */}
			{pickerOpen && (
				<div
					ref={pickerRef}
					className="absolute top-full left-0 mt-1 w-full min-w-[300px] bg-white border border-slate-200 rounded-lg shadow-lg z-50 py-1 overflow-hidden"
				>
					{SPOTLIGHT_BARS.map((bar, i) => {
						const Icon = bar.icon;
						const data = allData[i];
						const isActive = bar.type === activeType;

						return (
							<button
								key={bar.type}
								onClick={() => handleSelect(bar.type)}
								className={`w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-slate-50 spotlight-slide-in ${
									isActive ? 'bg-slate-50' : ''
								}`}
								style={{ animationDelay: `${i * 50}ms` }}
							>
								{/* Icon */}
								<Icon size={14} className={isActive ? bar.textClass : 'text-slate-400'} />

								{/* Name */}
								<span className={`font-medium flex-shrink-0 ${isActive ? bar.textClass : 'text-slate-600'}`}>
									{bar.name}
								</span>

								{/* Preview label */}
								<span className="text-slate-400 truncate ml-1">
									{data.hasContent ? data.label : <em>No data</em>}
								</span>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
