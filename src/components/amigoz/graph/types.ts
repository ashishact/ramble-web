/**
 * Type definitions for D3 graph visualization
 */
import * as d3 from 'd3';

export interface GraphNode extends d3.SimulationNodeDatum {
  id: number;
  label: string;
  distance?: number;
  childCount?: number;  // Number of relationships this node has
}

export interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  source: number | GraphNode;
  target: number | GraphNode;
}
