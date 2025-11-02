/**
 * Theme utilities for D3 graph visualization
 * Extracts computed DaisyUI theme colors for use in D3
 */

// Utility function to get computed color from a temporary element with DaisyUI class
const getThemeColor = (className: string): string => {
  const tempEl = document.createElement('div');
  tempEl.className = className;
  tempEl.style.display = 'none';
  document.body.appendChild(tempEl);

  const computed = getComputedStyle(tempEl);
  // For text classes (text-*), read color, for background classes (bg-*), read backgroundColor
  const color = className.startsWith('text-') ? computed.color : computed.backgroundColor;

  document.body.removeChild(tempEl);
  return color || '#666666';
};

// Get theme colors for graph by reading from DaisyUI utility classes
export const getThemeColors = () => ({
  primary: getThemeColor('bg-primary'),
  secondary: getThemeColor('bg-secondary'),
  baseContent: getThemeColor('text-base-content'),
  accent: getThemeColor('bg-accent'),
});
