/**
 * Position calculation utilities for D3 graph visualization
 * Smart angular distribution algorithm for placing new nodes around parents
 */
import type { GraphNode } from './types';
import { getNodeRadius } from './scaling';
import { OUTER_RING_GAP } from './constants';

/**
 * Calculate smart initial position for new nodes around parent
 * Finds gaps in existing angles and distributes new nodes evenly
 */
export const calculateInitialPosition = (
  parentNode: GraphNode | undefined,
  existingNodes: GraphNode[],
  newNodeIndex: number,
  totalNewNodes: number
): { x: number; y: number } => {
  if (!parentNode || parentNode.x === undefined || parentNode.y === undefined) {
    return { x: 0, y: 0 };
  }

  // Calculate angles of existing connected nodes
  const existingAngles: number[] = [];
  existingNodes.forEach((node) => {
    if (node.x !== undefined && node.y !== undefined) {
      const dx = node.x - parentNode.x!;
      const dy = node.y - parentNode.y!;
      const angle = Math.atan2(dy, dx);
      existingAngles.push(angle);
    }
  });

  // Distribute new nodes evenly around a circle
  const baseAngle = (2 * Math.PI) / totalNewNodes;
  let angle = baseAngle * newNodeIndex;

  // Try to avoid existing node angles if possible
  if (existingAngles.length > 0) {
    // Find the largest gap in existing angles and start from there
    existingAngles.sort((a, b) => a - b);
    let maxGap = 0;
    let maxGapStart = 0;

    for (let i = 0; i < existingAngles.length; i++) {
      const nextI = (i + 1) % existingAngles.length;
      const gap =
        nextI === 0
          ? 2 * Math.PI - existingAngles[i] + existingAngles[0]
          : existingAngles[nextI] - existingAngles[i];

      if (gap > maxGap) {
        maxGap = gap;
        maxGapStart = existingAngles[i];
      }
    }

    // Start distributing from the middle of the largest gap
    angle = maxGapStart + maxGap / 2 + baseAngle * newNodeIndex;
  }

  // Position at parent's outer circumference
  const startRadius = getNodeRadius(parentNode.distance || 0) + OUTER_RING_GAP + 10;
  const x = parentNode.x + Math.cos(angle) * startRadius;
  const y = parentNode.y + Math.sin(angle) * startRadius;

  return { x, y };
};
