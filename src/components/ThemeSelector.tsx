import { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';

const DAISYUI_THEMES = [
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
        <Icon icon="mdi:theme-light-dark" className="w-4 h-4" />
        <span className="hidden sm:inline">{currentTheme}</span>
      </summary>
      <ul className="dropdown-content menu z-50 p-2 shadow-xl bg-base-300 rounded-box w-52 max-h-96 overflow-y-auto mt-2">
        {DAISYUI_THEMES.map((theme) => (
          <li key={theme}>
            <button
              className={`text-sm ${
                currentTheme === theme ? 'active' : ''
              }`}
              onClick={() => handleThemeChange(theme)}
            >
              <span className="flex-1 text-left capitalize">{theme}</span>
              {currentTheme === theme && (
                <Icon icon="mdi:check" className="w-4 h-4" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
