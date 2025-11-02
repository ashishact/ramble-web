/**
 * Semantic Graph View - D3 radial visualization for semantic search results
 * Query node at center, results arranged radially based on similarity
 */
import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { getThemeColors } from '../graph/theme';
import { OUTER_RING_GAP } from '../graph/constants';

interface KnowledgeNode {
  id: number;
  title: string;
  content: string;
  tags: string[];
  icon?: string;
  similarity?: number;
  createdAt: string;
}

interface SemanticGraphViewProps {
  queryText: string;
  results: KnowledgeNode[];
  onNodeSelect: (nodeId: number) => void;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: number;
  label: string;
  icon?: string;
  similarity: number;
  isQuery: boolean;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: number | GraphNode;
  target: number | GraphNode;
  similarity: number;
}

export function SemanticGraphView({ queryText, results, onNodeSelect }: SemanticGraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  useEffect(() => {
    if (!svgRef.current || results.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Clear previous content
    svg.selectAll('*').remove();

    // Create main group with zoom
    const g = svg
      .append('g')
      .attr('class', 'main-group');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Center the view
    const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2);
    svg.call(zoom.transform, initialTransform);

    const themeColors = getThemeColors();

    // Create nodes: query node + result nodes
    const queryNode: GraphNode = {
      id: -1,
      label: queryText.length > 30 ? queryText.substring(0, 30) + '...' : queryText,
      similarity: 1,
      isQuery: true,
      x: 0,
      y: 0,
      fx: 0, // Fixed at center
      fy: 0,
    };

    const resultNodes: GraphNode[] = results.map((node) => ({
      id: node.id,
      label: node.title.length > 30 ? node.title.substring(0, 30) + '...' : node.title,
      icon: node.icon,
      similarity: node.similarity ?? 0.5,
      isQuery: false,
    }));

    const nodes: GraphNode[] = [queryNode, ...resultNodes];

    // Create links from query to all results
    const links: GraphLink[] = resultNodes.map((node) => ({
      source: -1,
      target: node.id,
      similarity: node.similarity,
    }));

    // Apply exponential scaling to stretch similarity differences
    // This makes small differences (e.g., 0.0234 vs 0.0244) more visible
    const scaleSimilarity = (similarity: number) => {
      // Use power function to stretch the range
      // Higher exponent = more dramatic differences
      const exponent = 3;
      return Math.pow(similarity, exponent);
    };

    // Calculate node radius based on similarity (higher similarity = larger node)
    const getNodeRadius = (node: GraphNode) => {
      if (node.isQuery) return 40; // Query node is largest
      const scaled = scaleSimilarity(node.similarity);
      // Result nodes: 18-40px based on scaled similarity (exponentially scaled)
      return 18 + scaled * 22;
    };

    // Calculate edge length based on similarity (higher similarity = closer)
    const getEdgeLength = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      // Closer for high similarity (80-280px range, 30% reduction)
      return 280 - scaled * 200;
    };

    // Calculate opacity based on similarity
    const getOpacity = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      return 0.3 + scaled * 0.7; // 0.3 to 1.0
    };

    // Create force simulation
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(links)
          .id((d) => d.id)
          .distance((d) => getEdgeLength(d.similarity))
          .strength(0.5) // Reduce link strength to allow more spreading
      )
      .force('charge', d3.forceManyBody().strength(-500)) // Increase repulsion
      .force('collision', d3.forceCollide().radius((d) => getNodeRadius(d as GraphNode) + 15))
      .alpha(0.5) // Higher initial energy
      .alphaDecay(0.01); // Slower decay for more settling time

    simulationRef.current = simulation;

    // Create links
    const link = g
      .append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', themeColors.secondary)
      .attr('stroke-width', (d) => 1 + d.similarity * 2) // 1-3px based on similarity
      .attr('stroke-opacity', (d) => getOpacity(d.similarity))
      .attr('stroke-dasharray', '4,3');

    // Create node groups
    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', (d) => (d.isQuery ? 'default' : 'pointer'))
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (d.isQuery) return; // Don't drag query node
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            if (d.isQuery) return;
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (d.isQuery) return;
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on('click', (_event, d) => {
        if (!d.isQuery) {
          onNodeSelect(d.id);
        }
      });

    // Add outer ring
    node
      .append('circle')
      .attr('class', 'outer-ring')
      .attr('r', (d) => getNodeRadius(d) + OUTER_RING_GAP)
      .attr('fill', 'none')
      .attr('stroke', (d) => (d.isQuery ? themeColors.accent : themeColors.secondary))
      .attr('stroke-width', (d) => (d.isQuery ? 3 : 2))
      .attr('stroke-dasharray', (d) => (d.isQuery ? 'none' : '4,3'))
      .attr('opacity', (d) => (d.isQuery ? 1 : getOpacity(d.similarity)));

    // Add inner ring
    node
      .append('circle')
      .attr('class', 'inner-ring')
      .attr('r', (d) => getNodeRadius(d))
      .attr('fill', '#ffffff')
      .attr('stroke', (d) => (d.isQuery ? themeColors.accent : themeColors.secondary))
      .attr('stroke-width', (d) => (d.isQuery ? 3 : 2))
      .attr('opacity', (d) => (d.isQuery ? 1 : getOpacity(d.similarity)));

    // Add icon or text at center
    node.each(function (d: GraphNode) {
      const nodeGroup = d3.select(this);

      if (d.icon) {
        // Add icon as text emoji
        nodeGroup
          .append('text')
          .attr('class', 'node-icon')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', getNodeRadius(d) * 1.2)
          .attr('opacity', d.isQuery ? 1 : getOpacity(d.similarity))
          .text(d.icon);
      } else if (d.isQuery) {
        // Query node without icon - show search icon
        nodeGroup
          .append('text')
          .attr('class', 'node-icon')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', getNodeRadius(d) * 1.2)
          .text('🔍');
      }
    });

    // Add labels below nodes
    node
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => getNodeRadius(d) + OUTER_RING_GAP + 16)
      .attr('font-size', (d) => (d.isQuery ? 14 : 12))
      .attr('font-weight', (d) => (d.isQuery ? 'bold' : 'normal'))
      .attr('fill', themeColors.baseContent)
      .attr('opacity', (d) => (d.isQuery ? 1 : getOpacity(d.similarity)))
      .text((d) => d.label);

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d) => {
          const source = typeof d.source === 'number' ? nodes.find((n) => n.id === d.source) : d.source;
          return source?.x ?? 0;
        })
        .attr('y1', (d) => {
          const source = typeof d.source === 'number' ? nodes.find((n) => n.id === d.source) : d.source;
          return source?.y ?? 0;
        })
        .attr('x2', (d) => {
          const target = typeof d.target === 'number' ? nodes.find((n) => n.id === d.target) : d.target;
          return target?.x ?? 0;
        })
        .attr('y2', (d) => {
          const target = typeof d.target === 'number' ? nodes.find((n) => n.id === d.target) : d.target;
          return target?.y ?? 0;
        });

      node.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [queryText, results, onNodeSelect]);

  if (results.length === 0) {
    return null;
  }

  return <svg ref={svgRef} className="w-full h-full" />;
}
