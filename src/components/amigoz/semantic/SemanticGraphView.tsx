/**
 * Semantic Graph View - D3 clustered visualization for semantic search results
 * Results clustered by tags/similarity with no edges, colored by tag
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
  tags: string[];
  cluster?: number;
  primaryTag?: string;
}

export function SemanticGraphView({ queryText, results, onNodeSelect }: SemanticGraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null);

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

    // Apply aggressive scaling to create dramatic size differences
    // Nodes above 0.5 similarity get exponentially larger
    // Nodes below 0.5 similarity get exponentially smaller
    const scaleSimilarity = (similarity: number) => {
      if (similarity > 0.5) {
        // Above 0.5: exponential growth (exponent 4)
        const normalized = (similarity - 0.5) * 2; // 0.5->1.0 becomes 0->1
        return 0.5 + Math.pow(normalized, 4) * 0.5; // Maps to 0.5->1.0 range
      } else {
        // Below 0.5: exponential decay (exponent 4)
        const normalized = similarity * 2; // 0->0.5 becomes 0->1
        return Math.pow(normalized, 4) * 0.5; // Maps to 0->0.5 range
      }
    };

    // Calculate node radius based on similarity (aggressively scaled)
    const getNodeRadius = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      // Dramatic range: 10-50px
      return 10 + scaled * 40;
    };

    // Calculate font size based on similarity (scaled proportionally)
    const getFontSize = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      // Font size: 8-13px
      return 8 + scaled * 5;
    };

    // Get all unique tags from results
    const allTags = new Set<string>();
    results.forEach((node) => node.tags.forEach((tag) => allTags.add(tag)));
    const uniqueTags = Array.from(allTags);

    // Create tag-to-color mapping (using graph component's color palette)
    const colorPalette = [
      { outerRing: '#ffd700', innerRing: '#d4af37' }, // Light Gold -> Gold
      { outerRing: '#cd853f', innerRing: '#8b4513' }, // Peru -> Saddle Brown
      { outerRing: '#87ceeb', innerRing: '#4169e1' }, // Sky Blue -> Royal Blue
      { outerRing: '#90ee90', innerRing: '#32cd32' }, // Light Green -> Lime Green
      { outerRing: '#ffa07a', innerRing: '#ff6347' }, // Light Salmon -> Tomato
      { outerRing: '#dda0dd', innerRing: '#9370db' }, // Plum -> Medium Purple
      { outerRing: '#7fffd4', innerRing: '#20b2aa' }, // Aquamarine -> Light Sea Green
    ];

    const tagColorMap = new Map<string, typeof colorPalette[0]>();
    uniqueTags.forEach((tag, index) => {
      tagColorMap.set(tag, colorPalette[index % colorPalette.length]);
    });

    // Determine optimal number of clusters using square root heuristic
    const numClusters = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(results.length))));

    // Create nodes with cluster assignment based on primary tag
    const nodes: GraphNode[] = results.map((node) => {
      const primaryTag = node.tags[0] || 'untagged';
      const clusterIndex = uniqueTags.indexOf(primaryTag);

      return {
        id: node.id,
        label: node.title.length > 30 ? node.title.substring(0, 30) + '...' : node.title,
        icon: node.icon,
        similarity: node.similarity ?? 0.5,
        tags: node.tags,
        primaryTag,
        cluster: clusterIndex >= 0 ? clusterIndex % numClusters : 0,
      };
    });

    // Calculate cluster centers (distribute in a grid or circle)
    const clusterCenters: { x: number; y: number }[] = [];
    const angleStep = (2 * Math.PI) / numClusters;
    const clusterRadius = Math.min(width, height) * 0.3;

    for (let i = 0; i < numClusters; i++) {
      const angle = i * angleStep;
      clusterCenters.push({
        x: Math.cos(angle) * clusterRadius,
        y: Math.sin(angle) * clusterRadius,
      });
    }

    // Create force simulation without links
    const simulation = d3
      .forceSimulation(nodes)
      .force('charge', d3.forceManyBody().strength(-200)) // Moderate repulsion
      .force(
        'collision',
        d3.forceCollide().radius((d) => getNodeRadius((d as GraphNode).similarity) + 10)
      )
      .force(
        'cluster',
        // Custom force to pull nodes toward their cluster center
        (alpha) => {
          nodes.forEach((node) => {
            const center = clusterCenters[node.cluster ?? 0];
            const k = alpha * 0.1;
            node.vx = (node.vx ?? 0) + (center.x - (node.x ?? 0)) * k;
            node.vy = (node.vy ?? 0) + (center.y - (node.y ?? 0)) * k;
          });
        }
      )
      .alpha(0.8) // Higher initial energy
      .alphaDecay(0.015); // Slower decay

    simulationRef.current = simulation;

    // Get node colors based on primary tag
    const getNodeColors = (node: GraphNode) => {
      const color = tagColorMap.get(node.primaryTag ?? 'untagged') ?? colorPalette[0];
      return color;
    };

    // Create node groups
    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on('click', (_event, d) => {
        onNodeSelect(d.id);
      });

    // Add outer ring
    node
      .append('circle')
      .attr('class', 'outer-ring')
      .attr('r', (d) => getNodeRadius(d.similarity) + OUTER_RING_GAP)
      .attr('fill', 'none')
      .attr('stroke', (d) => getNodeColors(d).outerRing)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3')
      .attr('opacity', 0.9);

    // Add inner ring
    node
      .append('circle')
      .attr('class', 'inner-ring')
      .attr('r', (d) => getNodeRadius(d.similarity))
      .attr('fill', '#ffffff')
      .attr('stroke', (d) => getNodeColors(d).innerRing)
      .attr('stroke-width', 2.5)
      .attr('opacity', 1);

    // Add icon at center
    node.each(function (d: GraphNode) {
      const nodeGroup = d3.select(this);

      if (d.icon) {
        // Add icon as text emoji
        nodeGroup
          .append('text')
          .attr('class', 'node-icon')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em')
          .attr('font-size', getNodeRadius(d.similarity) * 1.2)
          .attr('opacity', 1)
          .text(d.icon);
      }
    });

    // Add labels below nodes
    node
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => getNodeRadius(d.similarity) + OUTER_RING_GAP + 16)
      .attr('font-size', (d) => getFontSize(d.similarity))
      .attr('font-weight', 'normal')
      .attr('fill', themeColors.baseContent)
      .attr('opacity', 0.8)
      .text((d) => d.label);

    // Update positions on tick
    simulation.on('tick', () => {
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
