import React, { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';

// ---------------------------------------------------------------------------
// Reusable theme swatch — renders primary/secondary/accent/neutral circles
// Uses data-theme on a wrapper so DaisyUI CSS variables cascade automatically.
// ---------------------------------------------------------------------------

export const ThemeSwatch: React.FC<{ theme: string; size?: number }> = ({ theme, size = 12 }) => (
  <div data-theme={theme} className="flex gap-0.5 flex-shrink-0 bg-base-100 p-0.5 rounded-md">
    <span className="rounded-full bg-primary" style={{ width: size, height: size }} />
    <span className="rounded-full bg-secondary" style={{ width: size, height: size }} />
    <span className="rounded-full bg-accent" style={{ width: size, height: size }} />
    <span className="rounded-full bg-neutral" style={{ width: size, height: size }} />
  </div>
);

export const DAISYUI_THEMES = [
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'synthwave',
  'retro',
  'cyberpunk',
  'valentine',
  'halloween',
  'garden',
  'forest',
  'aqua',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'luxury',
  'dracula',
  'cmyk',
  'autumn',
  'business',
  'acid',
  'lemonade',
  'night',
  'coffee',
  'winter',
  'dim',
  'nord',
  'sunset',
];

export function ThemeSelector() {
  const [currentTheme, setCurrentTheme] = useState('dark');

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  const handleThemeChange = (theme: string) => {
    setCurrentTheme(theme);
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    // Close dropdown by removing focus
    (document.activeElement as HTMLElement)?.blur();
  };

  return (
    <details className="dropdown dropdown-end">
      <summary className="btn btn-sm btn-ghost gap-2">
        <Icon icon="streamline-ultimate-color:color-palette" className="w-4 h-4" />
        <span className="hidden sm:inline">{currentTheme}</span>
      </summary>
      <div className="dropdown-content z-50 p-2 shadow-xl bg-base-300 rounded-box w-96 max-h-96 overflow-y-auto mt-2 grid grid-cols-2 gap-0.5">
        {DAISYUI_THEMES.map((theme) => (
          <button
            key={theme}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors ${
              currentTheme === theme ? 'bg-primary/15 font-medium' : 'hover:bg-base-200'
            }`}
            onClick={() => handleThemeChange(theme)}
          >
            <ThemeSwatch theme={theme} size={14} />
            <span className="flex-1 text-left capitalize truncate">{theme}</span>
            {currentTheme === theme && (
              <Icon icon="mdi:check" className="w-4 h-4 flex-shrink-0" />
            )}
          </button>
        ))}
      </div>
    </details>
  );
}
