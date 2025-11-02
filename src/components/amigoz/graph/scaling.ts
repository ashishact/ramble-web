/**
 * Scaling utilities for D3 graph visualization
 * Provides size, stroke, opacity, and distance calculations based on node distance
 */
import {
  SCALE_RADIUS,
  SCALE_STROKE_OUTER,
  SCALE_STROKE_INNER,
  SCALE_EDGE_LENGTH,
  SCALE_OPACITY,
} from './constants';

// Get node radius based on distance from selected node
export const getNodeRadius = (distance: number): number => {
  const index = Math.min(distance, SCALE_RADIUS.length - 1);
  return SCALE_RADIUS[index];
};

// Get stroke widths based on distance
export const getStrokeWidths = (distance: number) => {
  const index = Math.min(distance, SCALE_STROKE_OUTER.length - 1);
  return {
    outerRing: SCALE_STROKE_OUTER[index],
    innerRing: SCALE_STROKE_INNER[index],
  };
};

// Get edge length based on distance
export const getEdgeLength = (distance: number): number => {
  const index = Math.min(distance, SCALE_EDGE_LENGTH.length - 1);
  return SCALE_EDGE_LENGTH[index];
};

// Get node opacity based on distance
export const getNodeOpacity = (distance: number): number => {
  const index = Math.min(distance, SCALE_OPACITY.length - 1);
  return SCALE_OPACITY[index];
};
