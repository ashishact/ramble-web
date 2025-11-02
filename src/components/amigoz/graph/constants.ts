/**
 * Visual scaling constants for graph visualization
 * Each array index represents: [distance-0, distance-1, distance-2, distance-3+]
 */

// Node visual properties by distance
export const SCALE_RADIUS = [30, 18, 13, 10];        // Node radius
export const SCALE_STROKE_OUTER = [2, 1.5, 1, 0.8];  // Outer ring stroke width (thinner than inner)
export const SCALE_STROKE_INNER = [2.5, 1.8, 1.3, 1]; // Inner ring stroke width
export const SCALE_EDGE_LENGTH = [120, 70, 45, 30];  // Edge/link distance (more compact)
export const SCALE_OPACITY = [1, 0.75, 0.6, 0.6];    // Node opacity (capped at 0.6)

// Visual spacing constants
export const OUTER_RING_GAP = 8;  // Gap between inner and outer ring
export const LABEL_GAP = 5;       // Gap between outer ring and label text
