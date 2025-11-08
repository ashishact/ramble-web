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
  selectedNodeId?: number;
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

export function SemanticGraphView({ results, onNodeSelect, selectedNodeId }: SemanticGraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, undefined> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  // Auto-select node with highest similarity when results change
  // Use a ref to track if we've already auto-selected for these results
  const autoSelectedRef = useRef<string>('');

  useEffect(() => {
    if (results.length === 0) return;

    // Create a stable key for these results
    const resultsKey = results.map(r => r.id).join(',');

    // Only auto-select once per search result set
    if (autoSelectedRef.current === resultsKey) return;
    autoSelectedRef.current = resultsKey;

    // Find node with highest similarity
    const bestMatch = results.reduce((best, current) => {
      const currentSim = current.similarity ?? 0;
      const bestSim = best.similarity ?? 0;
      return currentSim > bestSim ? current : best;
    }, results[0]);

    // Auto-select the best match
    if (bestMatch) {
      onNodeSelect(bestMatch.id);
    }
  }, [results]); // Remove onNodeSelect from dependencies

  // Initialize SVG and zoom only once
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    // Only initialize if not already initialized
    if (!gRef.current) {
      // Create main group with zoom
      const g = svg.append('g').attr('class', 'main-group');
      gRef.current = g;

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          g.attr('transform', event.transform);
        });

      zoomRef.current = zoom;
      svg.call(zoom);

      // Center the view
      const initialTransform = d3.zoomIdentity.translate(width / 2, height / 2);
      svg.call(zoom.transform, initialTransform);
    }
  }, []);

  // Update nodes when results change
  useEffect(() => {
    if (!svgRef.current || !gRef.current || results.length === 0) return;

    const g = gRef.current;
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const themeColors = getThemeColors();

    // Apply very aggressive scaling to create dramatic size differences
    // Nodes above 0.5 similarity get exponentially larger
    // Nodes below 0.5 similarity get exponentially smaller
    const scaleSimilarity = (similarity: number) => {
      if (similarity > 0.5) {
        // Above 0.5: exponential growth (exponent 6 for more drama)
        const normalized = (similarity - 0.5) * 2; // 0.5->1.0 becomes 0->1
        return 0.5 + Math.pow(normalized, 6) * 0.5; // Maps to 0.5->1.0 range
      } else {
        // Below 0.5: exponential decay (exponent 6 for more drama)
        const normalized = similarity * 2; // 0->0.5 becomes 0->1
        return Math.pow(normalized, 6) * 0.5; // Maps to 0->0.5 range
      }
    };

    // Calculate node radius based on similarity (aggressively scaled)
    const getNodeRadius = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      // Dramatic range: 10-50px with heavy skew
      return 10 + scaled * 40;
    };

    // Calculate font size based on similarity (scaled proportionally)
    const getFontSize = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      // Font size: 8-13px with heavy skew
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

    // Calculate cluster centers first (needed for initial positions)
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

    // Get existing nodes from simulation to preserve positions
    const existingNodes = simulationRef.current?.nodes() || [];
    const existingNodeMap = new Map(existingNodes.map(n => [n.id, n]));

    // Calculate adaptive similarity-based clustering using logarithmic distribution
    // This ensures good distribution even when all similarities are in a narrow range
    const getSimilarityCluster = (similarity: number): number => {
      // Find min and max similarity in results
      const similarities = results.map(r => r.similarity ?? 0.5);
      const minSim = Math.min(...similarities);
      const maxSim = Math.max(...similarities);

      // If all similarities are the same, put everything in cluster 0
      if (maxSim === minSim) return 0;

      // Normalize similarity to 0-1 range based on actual data range
      const normalized = (similarity - minSim) / (maxSim - minSim);

      // Apply gentle logarithmic transformation for better distribution
      // log(1 + x*9) gives a smooth curve from 0 to 1
      const logTransformed = Math.log(1 + normalized * 9) / Math.log(10);

      // Map to cluster index (higher similarity = lower cluster number for visual arrangement)
      const clusterIndex = Math.floor((1 - logTransformed) * numClusters);

      // Clamp to valid cluster range
      return Math.min(numClusters - 1, Math.max(0, clusterIndex));
    };

    // Create nodes with cluster assignment based on similarity
    const nodes: GraphNode[] = results.map((node) => {
      const primaryTag = node.tags[0] || 'untagged';
      const similarity = node.similarity ?? 0.5;
      const cluster = getSimilarityCluster(similarity);

      // Check if node already exists
      const existingNode = existingNodeMap.get(node.id);

      return {
        id: node.id,
        label: node.title.length > 30 ? node.title.substring(0, 30) + '...' : node.title,
        icon: node.icon,
        similarity,
        tags: node.tags,
        primaryTag,
        cluster,
        // Preserve existing position if node exists, otherwise start at cluster center
        x: existingNode?.x ?? clusterCenters[cluster].x + (Math.random() - 0.5) * 50,
        y: existingNode?.y ?? clusterCenters[cluster].y + (Math.random() - 0.5) * 50,
        vx: existingNode?.vx ?? 0,
        vy: existingNode?.vy ?? 0,
      };
    });

    // Update or create simulation
    let simulation = simulationRef.current;

    if (!simulation) {
      // Create new simulation
      simulation = d3
        .forceSimulation(nodes)
        .force('charge', d3.forceManyBody().strength(-200))
        .force(
          'collision',
          d3.forceCollide().radius((d) => getNodeRadius((d as GraphNode).similarity) + 10)
        )
        .force(
          'cluster',
          (alpha) => {
            nodes.forEach((node) => {
              const center = clusterCenters[node.cluster ?? 0];
              const k = alpha * 0.1;
              node.vx = (node.vx ?? 0) + (center.x - (node.x ?? 0)) * k;
              node.vy = (node.vy ?? 0) + (center.y - (node.y ?? 0)) * k;
            });
          }
        )
        .alpha(0.8)
        .alphaDecay(0.015);

      simulationRef.current = simulation;
    } else {
      // Update existing simulation with new nodes
      simulation.nodes(nodes);
      simulation.force(
        'collision',
        d3.forceCollide().radius((d) => getNodeRadius((d as GraphNode).similarity) + 10)
      );
      simulation.force(
        'cluster',
        (alpha) => {
          nodes.forEach((node) => {
            const center = clusterCenters[node.cluster ?? 0];
            const k = alpha * 0.1;
            node.vx = (node.vx ?? 0) + (center.x - (node.x ?? 0)) * k;
            node.vy = (node.vy ?? 0) + (center.y - (node.y ?? 0)) * k;
          });
        }
      );
      simulation.alpha(0.3).restart();
    }

    // Get node colors based on primary tag
    const getNodeColors = (node: GraphNode) => {
      const color = tagColorMap.get(node.primaryTag ?? 'untagged') ?? colorPalette[0];
      return color;
    };

    // Calculate cluster boundaries and average similarity for each cluster
    interface ClusterInfo {
      center: { x: number; y: number };
      radius: number;
      avgSimilarity: number;
      nodeCount: number;
    }

    const clusterInfo = new Map<number, ClusterInfo>();

    // Group nodes by cluster
    const nodesByCluster = new Map<number, GraphNode[]>();
    nodes.forEach(node => {
      const cluster = node.cluster ?? 0;
      if (!nodesByCluster.has(cluster)) {
        nodesByCluster.set(cluster, []);
      }
      nodesByCluster.get(cluster)!.push(node);
    });

    // Calculate cluster boundaries after simulation settles
    const updateClusterBoundaries = () => {
      clusterInfo.clear();

      nodesByCluster.forEach((clusterNodes, clusterId) => {
        if (clusterNodes.length === 0) return;

        // Calculate center and radius
        let centerX = 0, centerY = 0;
        let totalSimilarity = 0;

        clusterNodes.forEach(node => {
          centerX += node.x ?? 0;
          centerY += node.y ?? 0;
          totalSimilarity += node.similarity;
        });

        centerX /= clusterNodes.length;
        centerY /= clusterNodes.length;
        const avgSimilarity = totalSimilarity / clusterNodes.length;

        // Calculate radius: max distance from center + node radius + padding
        let maxDistance = 0;
        clusterNodes.forEach(node => {
          const dx = (node.x ?? 0) - centerX;
          const dy = (node.y ?? 0) - centerY;
          const distance = Math.sqrt(dx * dx + dy * dy) + getNodeRadius(node.similarity) + OUTER_RING_GAP;
          maxDistance = Math.max(maxDistance, distance);
        });

        // Add extra padding for single-node clusters
        const paddingMultiplier = clusterNodes.length === 1 ? 2.5 : 1.3;
        const radius = maxDistance * paddingMultiplier;

        clusterInfo.set(clusterId, {
          center: { x: centerX, y: centerY },
          radius,
          avgSimilarity,
          nodeCount: clusterNodes.length,
        });
      });
    };

    // Draw cluster boundary circles with similarity scores
    const clusterSelection = g
      .selectAll<SVGGElement, number>('g.cluster-group')
      .data(Array.from(nodesByCluster.keys()), (d) => d);

    // EXIT: Remove old clusters
    clusterSelection.exit().remove();

    // ENTER: Add new cluster groups
    const clusterEnter = clusterSelection
      .enter()
      .append('g')
      .attr('class', 'cluster-group')
      .attr('opacity', 0);

    // Add cluster boundary circle
    clusterEnter
      .append('circle')
      .attr('class', 'cluster-boundary')
      .attr('fill', 'none')
      .attr('stroke', themeColors.baseContent)
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.15);

    // Add similarity score text
    clusterEnter
      .append('text')
      .attr('class', 'cluster-similarity')
      .attr('text-anchor', 'middle')
      .attr('font-size', '11px')
      .attr('font-weight', '500')
      .attr('fill', themeColors.baseContent)
      .attr('opacity', 0.4);

    // MERGE enter + update
    const clusterMerge = clusterEnter.merge(clusterSelection);

    // Fade in new clusters
    clusterEnter
      .transition()
      .duration(500)
      .attr('opacity', 1);

    // Use enter/update/exit pattern for smooth transitions
    const nodeSelection = g
      .selectAll<SVGGElement, GraphNode>('g.node-group')
      .data(nodes, (d) => d.id);

    // EXIT: Remove nodes that are no longer in the data
    nodeSelection.exit()
      .transition()
      .duration(300)
      .attr('opacity', 0)
      .remove();

    // ENTER: Add new nodes
    const nodeEnter = nodeSelection
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .attr('cursor', 'pointer')
      .attr('opacity', 0)
      .on('click', (_event, d) => {
        onNodeSelect(d.id);
      });

    // Add outer ring
    nodeEnter
      .append('circle')
      .attr('class', 'outer-ring')
      .attr('fill', 'none')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3');

    // Add inner ring
    nodeEnter
      .append('circle')
      .attr('class', 'inner-ring')
      .attr('fill', '#ffffff')
      .attr('stroke-width', 2.5);

    // Add icon placeholder
    nodeEnter
      .append('text')
      .attr('class', 'node-icon')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em');

    // Add label
    nodeEnter
      .append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('font-weight', 'normal')
      .attr('fill', themeColors.baseContent);

    // MERGE enter + update
    const nodeMerge = nodeEnter.merge(nodeSelection);

    // Fade in new nodes
    nodeEnter
      .transition()
      .duration(300)
      .attr('opacity', 1);

    // Update all nodes (new and existing) - basic styling without selection
    nodeMerge.select('.outer-ring')
      .transition()
      .duration(300)
      .attr('r', (d) => getNodeRadius(d.similarity) + OUTER_RING_GAP)
      .attr('stroke', (d) => getNodeColors(d).outerRing)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '4,3')
      .attr('opacity', 0.9);

    nodeMerge.select('.inner-ring')
      .transition()
      .duration(300)
      .attr('r', (d) => getNodeRadius(d.similarity))
      .attr('stroke', (d) => getNodeColors(d).innerRing)
      .attr('opacity', 1);

    nodeMerge.select('.node-icon')
      .transition()
      .duration(300)
      .attr('font-size', (d) => getNodeRadius(d.similarity) * 1.2)
      .attr('opacity', (d) => d.icon ? 1 : 0)
      .text((d) => d.icon || '');

    nodeMerge.select('.node-label')
      .transition()
      .duration(300)
      .attr('dy', (d) => getNodeRadius(d.similarity) + OUTER_RING_GAP + 16)
      .attr('font-size', (d) => getFontSize(d.similarity))
      .attr('opacity', 0.8)
      .text((d) => d.label);

    // Apply drag behavior
    nodeMerge.call(
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
    );

    // Update positions on tick
    simulation.on('tick', () => {
      // Update node positions
      nodeMerge.attr('transform', (d) => `translate(${d.x},${d.y})`);

      // Update cluster boundaries
      updateClusterBoundaries();

      // Update cluster circles and labels
      clusterMerge.each(function(clusterId) {
        const info = clusterInfo.get(clusterId);
        if (!info) return;

        const group = d3.select(this);

        // Update circle
        group.select('.cluster-boundary')
          .attr('cx', info.center.x)
          .attr('cy', info.center.y)
          .attr('r', info.radius);

        // Update similarity text - position at the top edge of the circle
        const textY = info.center.y - info.radius - 8; // 8px above the circle
        group.select('.cluster-similarity')
          .attr('x', info.center.x)
          .attr('y', textY)
          .text(info.avgSimilarity.toFixed(2));
      });
    });
  }, [results]);

  // Separate effect to update selection highlighting without recreating nodes
  useEffect(() => {
    if (!gRef.current) return;

    const g = gRef.current;
    const themeColors = getThemeColors();

    // Helper functions (same as main effect)
    const scaleSimilarity = (similarity: number) => {
      if (similarity > 0.5) {
        const normalized = (similarity - 0.5) * 2;
        return 0.5 + Math.pow(normalized, 6) * 0.5;
      } else {
        const normalized = similarity * 2;
        return Math.pow(normalized, 6) * 0.5;
      }
    };

    const getNodeRadius = (similarity: number) => {
      const scaled = scaleSimilarity(similarity);
      return 10 + scaled * 40;
    };

    // Color palette for tags
    const colorPalette = [
      { outerRing: '#ffd700', innerRing: '#d4af37' },
      { outerRing: '#cd853f', innerRing: '#8b4513' },
      { outerRing: '#87ceeb', innerRing: '#4169e1' },
      { outerRing: '#90ee90', innerRing: '#32cd32' },
      { outerRing: '#ffa07a', innerRing: '#ff6347' },
      { outerRing: '#dda0dd', innerRing: '#9370db' },
      { outerRing: '#7fffd4', innerRing: '#20b2aa' },
    ];

    // Get all unique tags
    const allTags = Array.from(new Set<string>(results.flatMap(n => n.tags)));
    const tagColorMap = new Map<string, typeof colorPalette[0]>();
    allTags.forEach((tag, index) => {
      tagColorMap.set(tag, colorPalette[index % colorPalette.length]);
    });

    // Update all node groups
    g.selectAll<SVGGElement, GraphNode>('g.node-group')
      .each(function(d) {
        const nodeGroup = d3.select(this);
        const isSelected = selectedNodeId === d.id;
        const tagColor = tagColorMap.get(d.primaryTag ?? 'untagged') ?? colorPalette[0];
        const radius = getNodeRadius(d.similarity);

        // Update outer ring (always dashed, unless selected then solid)
        nodeGroup.select('.outer-ring')
          .transition()
          .duration(200)
          .attr('r', radius + OUTER_RING_GAP)
          .attr('fill', 'none')
          .attr('stroke', isSelected ? (themeColors.primary || '#3b82f6') : tagColor.outerRing)
          .attr('stroke-width', isSelected ? 4 : 2)
          .attr('stroke-dasharray', isSelected ? 'none' : '4,3')
          .attr('opacity', isSelected ? 1.0 : 0.9)
          .attr('filter', isSelected ? 'drop-shadow(0 0 8px rgba(59, 130, 246, 0.6))' : 'none');

        // Update inner ring (always solid, color changes when selected)
        nodeGroup.select('.inner-ring')
          .transition()
          .duration(200)
          .attr('r', radius)
          .attr('fill', '#ffffff')
          .attr('stroke', isSelected ? (themeColors.primary || '#3b82f6') : tagColor.innerRing)
          .attr('stroke-width', 2.5)
          .attr('opacity', 1);
      });
  }, [selectedNodeId, results]);

  if (results.length === 0) {
    return null;
  }

  return <svg ref={svgRef} className="w-full h-full" />;
}
