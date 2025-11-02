/**
 * Graph algorithms for D3 visualization
 * BFS-based distance calculation and other graph operations
 */
import type { GraphLink } from './types';

/**
 * Calculate distance from a node using BFS
 * Traverses the graph using edges to find shortest path distances
 */
export const calculateDistances = (
  fromNodeId: number,
  edgesMap: Map<string, GraphLink>
): Map<number, number> => {
  const distances = new Map<number, number>();
  const queue: number[] = [fromNodeId];
  distances.set(fromNodeId, 0);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const currentDistance = distances.get(nodeId)!;

    edgesMap.forEach((edge) => {
      const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
      const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;

      let neighborId: number | null = null;
      if (sourceId === nodeId) {
        neighborId = targetId;
      } else if (targetId === nodeId) {
        neighborId = sourceId;
      }

      if (neighborId !== null && !distances.has(neighborId)) {
        distances.set(neighborId, currentDistance + 1);
        queue.push(neighborId);
      }
    });
  }

  return distances;
};
