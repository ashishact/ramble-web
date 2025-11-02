/**
 * Node styling utilities for D3 graph visualization
 * Determines node colors based on properties and distance
 */
import type { GraphNode } from './types';
import type { getThemeColors } from './theme';

/**
 * Get node colors based on properties (simulated for now with random selection)
 * Returns outerRing and innerRing colors
 */
export const getNodeColors = (
  node: GraphNode,
  themeColors: ReturnType<typeof getThemeColors>
) => {
  // For selected node (distance 0), use accent color for both rings
  if (node.distance === 0) {
    return {
      outerRing: themeColors.accent,
      innerRing: themeColors.accent,
    };
  }

  // Simulate random color selection based on node ID
  // In the future, this will be based on node properties
  // Outer ring uses lighter/pastel version, inner ring uses bolder color
  const colorPalette = [
    { outerRing: '#ffd700', innerRing: '#d4af37' }, // Light Gold -> Gold
    { outerRing: '#cd853f', innerRing: '#8b4513' }, // Peru -> Saddle Brown
    { outerRing: '#87ceeb', innerRing: '#4169e1' }, // Sky Blue -> Royal Blue
    { outerRing: '#90ee90', innerRing: '#32cd32' }, // Light Green -> Lime Green
    { outerRing: '#ffa07a', innerRing: '#ff6347' }, // Light Salmon -> Tomato
    { outerRing: '#dda0dd', innerRing: '#9370db' }, // Plum -> Medium Purple
    { outerRing: '#7fffd4', innerRing: '#20b2aa' }, // Aquamarine -> Light Sea Green
  ];

  const colorIndex = node.id % colorPalette.length;
  return colorPalette[colorIndex];
};
