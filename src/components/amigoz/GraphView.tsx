/**
 * GraphView Component - Interactive knowledge graph visualization with D3.js
 *
 * VIRTUAL VIEW PATTERN:
 * This component maintains a "virtual view" of all accumulated nodes/edges using Maps:
 * - allNodesMapRef: Complete map of all nodes encountered during navigation
 * - allEdgesMapRef: Complete map of all edges between nodes
 *
 * The graph uses D3 force simulation with smooth transitions:
 * 1. Initial render: Shows currentNode only
 * 2. Click node: Fetches relationships, adds with grow animation
 * 3. Auto-prunes: Removes nodes >2 hops away when total count >= 16 with shrink animation
 *
 * D3.js provides:
 * - Force-directed layout with automatic positioning
 * - Smooth transitions for all state changes
 * - Natural clustering and separation
 */
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { KnowledgeNode } from './types';
import type { GraphNode, GraphLink } from './graph/types';
import {
  OUTER_RING_GAP,
  LABEL_GAP,
  getThemeColors,
  getNodeRadius,
  getStrokeWidths,
  getEdgeLength,
  getNodeOpacity,
  calculateInitialPosition,
  getNodeColors,
  calculateDistances,
} from './graph';

interface GraphViewProps {
  currentNode: KnowledgeNode | null;
  onNodeClick: (nodeId: number) => void;
  relationshipChangeKey?: number;
}

export function GraphView({ currentNode, onNodeClick, relationshipChangeKey }: GraphViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  // Virtual view: Complete map of all nodes/edges accumulated during navigation
  const allNodesMapRef = useRef<Map<number, GraphNode>>(new Map());
  const allEdgesMapRef = useRef<Map<string, GraphLink>>(new Map());

  // D3 selections
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const linkRef = useRef<d3.Selection<SVGLineElement, GraphLink, SVGGElement, unknown> | null>(null);
  const nodeRef = useRef<d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown> | null>(null);

  const [themeVersion, setThemeVersion] = useState(0);

  // Track current selected node for centering
  const currentSelectedNodeRef = useRef<number | null>(null);

  // Track if initialized to prevent re-initialization
  const isInitializedRef = useRef(false);
  const initialNodeIdRef = useRef<number | null>(null);

  // Refs to functions defined in initialization useEffect
  const handleNodeClickRef = useRef<((nodeId: number) => Promise<void>) | null>(null);

  // Listen for theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setThemeVersion(v => v + 1);
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  /**
   * Trigger initialization when currentNode first becomes available
   * This useEffect watches for when currentNode is loaded for the first time
   */
  const [shouldInitialize, setShouldInitialize] = useState(false);

  useEffect(() => {
    if (currentNode && !isInitializedRef.current) {
      setShouldInitialize(true);
    }
  }, [currentNode]);

  /**
   * Initialize D3 graph once on mount or theme change
   * CRITICAL: Only depends on themeVersion and shouldInitialize, NOT currentNode directly
   * - If currentNode was in dependencies, it would re-initialize on every selection
   * - This would clear the virtual view and lose accumulated nodes
   */
  useEffect(() => {
    if (!currentNode || !svgRef.current || !shouldInitialize) return;

    // Skip if already initialized (unless theme changed)
    if (isInitializedRef.current && simulationRef.current) {
      return;
    }

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const themeColors = getThemeColors();

    // Clear previous content
    svg.selectAll('*').remove();
    allNodesMapRef.current.clear();
    allEdgesMapRef.current.clear();

    // Create zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Main group for zoom/pan
    const g = svg.append('g');
    gRef.current = g;

    // Create arrow marker for directed edges
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '-0 -3 6 6')
      .attr('refX', 12)
      .attr('refY', 0)
      .attr('orient', 'auto')
      .attr('markerWidth', 4)
      .attr('markerHeight', 4)
      .append('svg:path')
      .attr('d', 'M 0,-3 L 6,0 L 0,3')
      .attr('fill', themeColors.baseContent)
      .style('opacity', 0.4);

    // Initialize with current node
    const initialNode: GraphNode = {
      id: currentNode.id,
      label: currentNode.title,
      x: width / 2,
      y: height / 2,
      distance: 0,
      childCount: 0, // Will be updated when relationships are fetched
    };
    allNodesMapRef.current.set(currentNode.id, initialNode);
    currentSelectedNodeRef.current = currentNode.id;
    isInitializedRef.current = true;
    initialNodeIdRef.current = currentNode.id;

    // Create force simulation with distance-based forces
    const simulation = d3.forceSimulation<GraphNode>()
      .force('link', d3.forceLink<GraphNode, GraphLink>()
        .id(d => d.id)
        .distance(d => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          const maxDist = Math.max(source.distance || 0, target.distance || 0);
          return getEdgeLength(maxDist);
        })
        .strength(0.7))  // Stronger link force for stable layout
      .force('charge', d3.forceManyBody().strength(-500))
      .force('radial', d3.forceRadial<GraphNode>(
        (d) => {
          // Push nodes outward from center based on distance
          const dist = d.distance || 0;
          return dist * getEdgeLength(0); // Each hop uses base edge length
        },
        width / 2,
        height / 2
      ).strength(0.3))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => {
        const dist = d.distance || 0;
        return getNodeRadius(dist) + OUTER_RING_GAP + 5; // Add padding
      }))
      .alphaDecay(0.02)  // Moderate decay
      .velocityDecay(0.4);  // Moderate friction

    simulationRef.current = simulation;

    // Create link and node groups
    const linkGroup = g.append('g').attr('class', 'links');
    const nodeGroup = g.append('g').attr('class', 'nodes');

    linkRef.current = linkGroup.selectAll<SVGLineElement, GraphLink>('line');
    nodeRef.current = nodeGroup.selectAll<SVGGElement, GraphNode>('g');

    // Drag behavior - define before updateGraph
    function dragstarted(event: any, d: GraphNode) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: GraphNode) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: any, d: GraphNode) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Set the position attributes of links and nodes each time the simulation ticks
    simulation.on('tick', () => {
      linkRef.current
        ?.attr('x1', d => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          const dx = target.x! - source.x!;
          const dy = target.y! - source.y!;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 1) return source.x!;
          const sourceRadius = getNodeRadius(source.distance || 0) + OUTER_RING_GAP;
          return source.x! + (dx / distance) * sourceRadius;
        })
        .attr('y1', d => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          const dx = target.x! - source.x!;
          const dy = target.y! - source.y!;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 1) return source.y!;
          const sourceRadius = getNodeRadius(source.distance || 0) + OUTER_RING_GAP;
          return source.y! + (dy / distance) * sourceRadius;
        })
        .attr('x2', d => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          const dx = target.x! - source.x!;
          const dy = target.y! - source.y!;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 1) return target.x!;
          const targetRadius = getNodeRadius(target.distance || 0) + OUTER_RING_GAP;
          return target.x! - (dx / distance) * targetRadius;
        })
        .attr('y2', d => {
          const source = d.source as GraphNode;
          const target = d.target as GraphNode;
          const dx = target.x! - source.x!;
          const dy = target.y! - source.y!;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance < 1) return target.y!;
          const targetRadius = getNodeRadius(target.distance || 0) + OUTER_RING_GAP;
          return target.y! - (dy / distance) * targetRadius;
        });

      nodeRef.current?.attr('transform', d => `translate(${d.x},${d.y})`);
    });

    function updateGraph() {
      if (!linkRef.current || !nodeRef.current || !simulationRef.current) return;

      console.log('[D3 updateGraph] CALLED - Current alpha:', simulationRef.current.alpha());

      const themeColors = getThemeColors();
      const nodes = Array.from(allNodesMapRef.current.values());
      const links = Array.from(allEdgesMapRef.current.values());

      console.log('[D3 updateGraph] Nodes:', nodes.length, 'Links:', links.length);
      if (links.length > 0) {
        console.log('[D3 updateGraph] Sample link:', links[0]);
      }

      // Update distances and set initial positions for new nodes
      if (currentSelectedNodeRef.current !== null) {
        const distances = calculateDistances(currentSelectedNodeRef.current, allEdgesMapRef.current);
        nodes.forEach(node => {
          node.distance = distances.get(node.id) ?? 999;

          // For new nodes without position, start at a connected node's position
          if (node.x === undefined || node.y === undefined) {
            // Find a connected node to start from
            const connectedLink = links.find(l => {
              const sourceId = typeof l.source === 'number' ? l.source : l.source.id;
              const targetId = typeof l.target === 'number' ? l.target : l.target.id;
              return sourceId === node.id || targetId === node.id;
            });

            if (connectedLink) {
              const connectedNodeId = typeof connectedLink.source === 'number' ? connectedLink.source : connectedLink.source.id;
              const otherId = connectedNodeId === node.id ?
                (typeof connectedLink.target === 'number' ? connectedLink.target : connectedLink.target.id) :
                connectedNodeId;
              const connectedNode = nodes.find(n => n.id === otherId);

              if (connectedNode && connectedNode.x !== undefined && connectedNode.y !== undefined) {
                node.x = connectedNode.x;
                node.y = connectedNode.y;
              }
            }

            // Fallback to center if no connected node found
            if (node.x === undefined || node.y === undefined) {
              node.x = width / 2;
              node.y = height / 2;
            }
          }
        });
      }

      // Update links
      const link = linkRef.current.data(links, d => d.id);

      console.log('[D3] Link selection:', link.size(), 'Exit:', link.exit().size(), 'Enter:', link.enter().size());

      link.exit()
        .transition()
        .duration(400)
        .attr('stroke-opacity', 0)
        .remove();

      const linkEnter = link.enter()
        .append('line')
        .attr('stroke', themeColors.baseContent)
        .attr('stroke-opacity', 0)
        .attr('stroke-width', 1)
        .attr('marker-end', 'url(#arrowhead)');

      linkEnter.transition()
        .duration(600)
        .attr('stroke-opacity', 0.4);

      linkRef.current = linkEnter.merge(link);

      console.log('[D3] After merge, total lines in DOM:', linkRef.current.size());

      // Debug: Check if lines are actually in the DOM
      const allLines = d3.select(svgRef.current).selectAll('line');
      console.log('[D3] All lines in entire SVG:', allLines.size());
      allLines.each(function(_d, i) {
        const line = d3.select(this);
        console.log(`[D3] Line ${i}:`, {
          x1: line.attr('x1'),
          y1: line.attr('y1'),
          x2: line.attr('x2'),
          y2: line.attr('y2'),
          stroke: line.attr('stroke'),
          opacity: line.attr('stroke-opacity'),
        });
      });

      // Update nodes
      const node = nodeRef.current.data(nodes, d => d.id);

      node.exit()
        .each(function() {
          const nodeSelection = d3.select<SVGGElement, GraphNode>(this);
          nodeSelection.select('circle')
            .transition()
            .duration(400)
            .attr('r', 0)
            .attr('fill-opacity', 0);
          nodeSelection.select('text')
            .transition()
            .duration(400)
            .attr('opacity', 0);
        })
        .transition()
        .delay(400)
        .remove();

      const nodeEnter = node.enter()
        .append('g')
        .style('cursor', 'grab')
        .attr('opacity', d => getNodeOpacity(d.distance || 0));

      // Add outer ring (larger, colored)
      nodeEnter.append('circle')
        .attr('class', 'outer-ring')
        .attr('r', 0)
        .attr('fill', 'none')
        .attr('stroke', d => getNodeColors(d, themeColors).outerRing)
        .attr('stroke-width', d => getStrokeWidths(d.distance || 0).outerRing)
        .attr('stroke-dasharray', d => d.distance === 0 ? 'none' : '4,3') // Dashed for non-selected
        .transition()
        .duration(600)
        .attr('r', d => getNodeRadius(d.distance || 0) + OUTER_RING_GAP);

      // Add inner ring (filled white with colored stroke)
      nodeEnter.append('circle')
        .attr('class', 'inner-ring')
        .attr('r', 0)
        .attr('fill', '#ffffff')
        .attr('stroke', d => getNodeColors(d, themeColors).innerRing)
        .attr('stroke-width', d => getStrokeWidths(d.distance || 0).innerRing)
        .transition()
        .duration(600)
        .attr('r', d => getNodeRadius(d.distance || 0));

      // Add child count text (centered in node) - shows only hidden children
      nodeEnter.append('text')
        .attr('class', 'child-count-number')
        .attr('text-anchor', 'middle')
        .attr('dy', 4)
        .attr('fill', themeColors.baseContent)
        .attr('font-size', d => d.distance === 0 ? '14px' : '11px')
        .attr('font-weight', 'bold')
        .text(d => {
          if (!d.childCount || d.childCount === 0) return '';

          // Count how many of this node's children are already visible
          const visibleChildren = Array.from(allEdgesMapRef.current.values()).filter(edge => {
            const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
            return sourceId === d.id || targetId === d.id;
          }).length;

          // Show only hidden children count
          const hiddenCount = d.childCount - visibleChildren;
          return hiddenCount > 0 ? hiddenCount : '';
        });

      // Add labels below node (calculated from outer ring edge + small gap)
      nodeEnter.append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('dy', d => {
          const dist = d.distance || 0;
          const outerRingRadius = getNodeRadius(dist) + OUTER_RING_GAP;
          const strokeWidth = getStrokeWidths(dist).outerRing;
          const fontSize = dist === 0 ? 14 : 11;
          // Position = outer ring radius + half stroke + gap + half font size
          // (dy positions the baseline, text extends ~50% above baseline)
          return outerRingRadius + strokeWidth / 2 + LABEL_GAP + fontSize * 0.5;
        })
        .attr('fill', themeColors.baseContent)
        .attr('font-size', d => d.distance === 0 ? '14px' : '11px')
        .attr('font-weight', '500')
        .text(d => d.label.length > 15 ? d.label.substring(0, 15) + '...' : d.label);

      nodeRef.current = nodeEnter.merge(node);

      // Apply drag and click to all nodes (new and existing)
      nodeRef.current
        .call(d3.drag<SVGGElement, GraphNode>()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended)
        )
        .on('click', async (event, d) => {
          // D3 drag sets defaultPrevented if it was a drag, not a click
          if (event.defaultPrevented) return;
          event.stopPropagation();
          await handleNodeClick(d.id);
        });

      // Update node group opacity for existing nodes
      nodeRef.current
        .transition()
        .duration(600)
        .attr('opacity', d => getNodeOpacity(d.distance || 0));

      // Update outer ring for existing nodes
      nodeRef.current.select<SVGCircleElement>('.outer-ring')
        .transition()
        .duration(600)
        .attr('stroke', d => getNodeColors(d, themeColors).outerRing)
        .attr('stroke-width', d => getStrokeWidths(d.distance || 0).outerRing)
        .attr('stroke-dasharray', d => d.distance === 0 ? 'none' : '4,3') // Dashed for non-selected
        .attr('r', d => getNodeRadius(d.distance || 0) + OUTER_RING_GAP);

      // Update inner ring for existing nodes
      nodeRef.current.select<SVGCircleElement>('.inner-ring')
        .transition()
        .duration(600)
        .attr('stroke', d => getNodeColors(d, themeColors).innerRing)
        .attr('stroke-width', d => getStrokeWidths(d.distance || 0).innerRing)
        .attr('r', d => getNodeRadius(d.distance || 0));

      // Update child count number for existing nodes - shows only hidden children
      nodeRef.current.select<SVGTextElement>('.child-count-number')
        .text(d => {
          if (!d.childCount || d.childCount === 0) return '';

          // Count how many of this node's children are already visible
          const visibleChildren = Array.from(allEdgesMapRef.current.values()).filter(edge => {
            const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
            const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
            return sourceId === d.id || targetId === d.id;
          }).length;

          // Show only hidden children count
          const hiddenCount = d.childCount - visibleChildren;
          return hiddenCount > 0 ? hiddenCount : '';
        })
        .attr('font-size', d => d.distance === 0 ? '14px' : '11px');

      // Update label position and font size for existing nodes when distance changes
      nodeRef.current.select<SVGTextElement>('.node-label')
        .transition()
        .duration(600)
        .attr('dy', d => {
          const dist = d.distance || 0;
          const outerRingRadius = getNodeRadius(dist) + OUTER_RING_GAP;
          const strokeWidth = getStrokeWidths(dist).outerRing;
          const fontSize = dist === 0 ? 14 : 11;
          // Position = outer ring radius + half stroke + gap + half font size
          // (dy positions the baseline, text extends ~50% above baseline)
          return outerRingRadius + strokeWidth / 2 + LABEL_GAP + fontSize * 0.5;
        })
        .attr('font-size', d => d.distance === 0 ? '14px' : '11px');

      // Update simulation
      simulationRef.current
        .nodes(nodes)
        .force<d3.ForceLink<GraphNode, GraphLink>>('link')
        ?.links(links);

      // Gently reheat if needed, but don't force restart
      const currentAlpha = simulationRef.current.alpha();
      if (currentAlpha < 0.1) {
        simulationRef.current.alpha(Math.max(0.3, currentAlpha)).restart();
      }
    }

    async function handleNodeClick(nodeId: number) {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

      // Update backend's current node
      try {
        await fetch(`${apiUrl}/knowledge/current-node`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ nodeId }),
        });
      } catch (err) {
        console.error('Error updating current node:', err);
      }

      // Fetch and add relationships
      try {
        const response = await fetch(`${apiUrl}/knowledge/nodes/${nodeId}/relationships`);
        if (response.ok) {
          const relationships = await response.json();

          if (relationships.length > 0) {
            const clickedNode = allNodesMapRef.current.get(nodeId);
            const existingConnectedNodes = Array.from(allNodesMapRef.current.values())
              .filter(n => n.x !== undefined && n.y !== undefined);

            // Collect new nodes to add
            const newNodes: Array<{ id: number; title: string; childCount: number }> = [];

            relationships.forEach((rel: any) => {
              if (!allNodesMapRef.current.has(rel.sourceNodeId)) {
                newNodes.push({
                  id: rel.sourceNodeId,
                  title: rel.source_title || `Node ${rel.sourceNodeId}`,
                  childCount: rel.source_child_count || 0,
                });
              } else {
                const existingNode = allNodesMapRef.current.get(rel.sourceNodeId);
                if (existingNode) {
                  existingNode.childCount = rel.source_child_count || 0;
                }
              }

              if (!allNodesMapRef.current.has(rel.targetNodeId)) {
                newNodes.push({
                  id: rel.targetNodeId,
                  title: rel.target_title || `Node ${rel.targetNodeId}`,
                  childCount: rel.target_child_count || 0,
                });
              } else {
                const existingNode = allNodesMapRef.current.get(rel.targetNodeId);
                if (existingNode) {
                  existingNode.childCount = rel.target_child_count || 0;
                }
              }
            });

            // Add new nodes with smart angular distribution
            newNodes.forEach((newNode, index) => {
              const position = calculateInitialPosition(
                clickedNode,
                existingConnectedNodes,
                index,
                newNodes.length
              );

              allNodesMapRef.current.set(newNode.id, {
                id: newNode.id,
                label: newNode.title,
                childCount: newNode.childCount,
                x: position.x,
                y: position.y,
              });
            });

            // Add edges
            relationships.forEach((rel: any) => {
              const edgeId = `${rel.sourceNodeId}-${rel.targetNodeId}`;
              if (!allEdgesMapRef.current.has(edgeId)) {
                allEdgesMapRef.current.set(edgeId, {
                  id: edgeId,
                  source: rel.sourceNodeId,
                  target: rel.targetNodeId,
                });
              }
            });
          }
        }
      } catch (err) {
        console.error('Error fetching relationships:', err);
      }

      // Update current selected node
      currentSelectedNodeRef.current = nodeId;

      // Prune nodes if needed
      const totalNodes = allNodesMapRef.current.size;
      if (totalNodes >= 16) {
        const distances = calculateDistances(nodeId, allEdgesMapRef.current);
        const nodesToRemove: number[] = [];

        allNodesMapRef.current.forEach((_node, nId) => {
          const distance = distances.get(nId);
          if (distance === undefined || distance > 2) {
            nodesToRemove.push(nId);
          }
        });

        // Remove nodes and their edges
        nodesToRemove.forEach(nId => {
          allNodesMapRef.current.delete(nId);
        });

        const edgesToRemove: string[] = [];
        allEdgesMapRef.current.forEach((edge, edgeId) => {
          const sourceId = typeof edge.source === 'number' ? edge.source : edge.source.id;
          const targetId = typeof edge.target === 'number' ? edge.target : edge.target.id;
          if (nodesToRemove.includes(sourceId) || nodesToRemove.includes(targetId)) {
            edgesToRemove.push(edgeId);
          }
        });

        edgesToRemove.forEach(edgeId => {
          allEdgesMapRef.current.delete(edgeId);
        });
      }

      // Update graph
      updateGraph();

      // Update parent if different node
      if (currentNode && nodeId !== currentNode.id) {
        onNodeClick(nodeId);
      }
    }

    // Store handleNodeClick in ref so it can be called from other useEffects
    handleNodeClickRef.current = handleNodeClick;

    // Fetch initial relationships
    const fetchInitialRelationships = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/knowledge/nodes/${currentNode.id}/relationships`);

        if (!response.ok) {
          console.log('[GraphView] Failed to fetch relationships:', response.status);
          return;
        }

        const relationships = await response.json();
        console.log('[GraphView] Initial relationships fetched:', relationships.length);

        if (relationships.length === 0) {
          return;
        }

        const currentNodeData = allNodesMapRef.current.get(currentNode.id);
        const existingConnectedNodes = Array.from(allNodesMapRef.current.values())
          .filter(n => n.x !== undefined && n.y !== undefined);

        // Collect new nodes to add
        const newNodes: Array<{ id: number; title: string; childCount: number }> = [];

        relationships.forEach((rel: any) => {
          if (!allNodesMapRef.current.has(rel.sourceNodeId)) {
            newNodes.push({
              id: rel.sourceNodeId,
              title: rel.source_title || `Node ${rel.sourceNodeId}`,
              childCount: rel.source_child_count || 0,
            });
          } else {
            const existingNode = allNodesMapRef.current.get(rel.sourceNodeId);
            if (existingNode) {
              existingNode.childCount = rel.source_child_count || 0;
            }
          }

          if (!allNodesMapRef.current.has(rel.targetNodeId)) {
            newNodes.push({
              id: rel.targetNodeId,
              title: rel.target_title || `Node ${rel.targetNodeId}`,
              childCount: rel.target_child_count || 0,
            });
          } else {
            const existingNode = allNodesMapRef.current.get(rel.targetNodeId);
            if (existingNode) {
              existingNode.childCount = rel.target_child_count || 0;
            }
          }
        });

        // Add new nodes with smart angular distribution
        newNodes.forEach((newNode, index) => {
          const position = calculateInitialPosition(
            currentNodeData,
            existingConnectedNodes,
            index,
            newNodes.length
          );

          allNodesMapRef.current.set(newNode.id, {
            id: newNode.id,
            label: newNode.title,
            childCount: newNode.childCount,
            x: position.x,
            y: position.y,
          });
        });

        // Add edges
        relationships.forEach((rel: any) => {
          const edgeId = `${rel.sourceNodeId}-${rel.targetNodeId}`;
          if (!allEdgesMapRef.current.has(edgeId)) {
            allEdgesMapRef.current.set(edgeId, {
              id: edgeId,
              source: rel.sourceNodeId,
              target: rel.targetNodeId,
            });
          }
        });

        updateGraph();
      } catch (err) {
        console.error('Error loading relationships:', err);
      }
    };

    // Update graph with initial node
    updateGraph();

    fetchInitialRelationships();

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
      isInitializedRef.current = false;
    };
  }, [themeVersion, shouldInitialize]); // Re-initialize on theme change or when initialization is triggered

  /**
   * Handle external currentNode changes (e.g., from backend AI creating new nodes)
   * This ensures the graph updates when nodes are created/changed outside of user clicks
   */
  useEffect(() => {
    if (!currentNode || !isInitializedRef.current || !handleNodeClickRef.current) return;

    // Skip if this is the initial node we just loaded
    if (currentNode.id === initialNodeIdRef.current) return;

    // Check if this node already has the correct selection state
    if (currentSelectedNodeRef.current === currentNode.id) return;

    // Check if this is a brand new node that doesn't exist in the graph yet
    const nodeExists = allNodesMapRef.current.has(currentNode.id);

    if (!nodeExists) {
      // Add the new node to the center of the graph
      const width = svgRef.current?.clientWidth || 800;
      const height = svgRef.current?.clientHeight || 600;

      allNodesMapRef.current.set(currentNode.id, {
        id: currentNode.id,
        label: currentNode.title,
        x: width / 2,
        y: height / 2,
        distance: 0,
      });

      // Update current selected node BEFORE calling handleNodeClick to prevent loop
      currentSelectedNodeRef.current = currentNode.id;
    }

    // Now use handleNodeClick to fetch relationships and update the graph
    handleNodeClickRef.current(currentNode.id);
  }, [currentNode?.id]); // Only depend on the ID changing

  /**
   * Handle relationship changes from backend
   * Refetch relationships for the current node when they change
   */
  useEffect(() => {
    if (!relationshipChangeKey || !currentSelectedNodeRef.current || !handleNodeClickRef.current) return;

    // Refetch relationships for the currently selected node
    handleNodeClickRef.current(currentSelectedNodeRef.current);
  }, [relationshipChangeKey]);

  /**
   * Handle canvas resize (when panels are resized)
   * Updates the SVG viewBox and re-centers the simulation
   */
  useEffect(() => {
    if (!svgRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;

        if (width > 0 && height > 0) {
          console.log('[GraphView] Canvas resized:', width, 'x', height);

          // Update SVG dimensions
          if (svgRef.current) {
            const svg = d3.select(svgRef.current);
            svg.attr('width', width).attr('height', height);
          }

          // Update radial force center only if simulation is initialized
          const simulation = simulationRef.current;
          if (simulation) {
            const radialForce = simulation.force<d3.ForceRadial<GraphNode>>('radial');
            if (radialForce) {
              radialForce.x(width / 2).y(height / 2);
            }

            // Gently reheat simulation to adjust to new dimensions
            simulation.alpha(0.3).restart();
          }
        }
      }
    });

    resizeObserver.observe(svgRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  if (!currentNode) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-base-content/60 text-lg mb-2">No node selected</p>
          <p className="text-base-content/40 text-sm">
            Select a node to view its relationship graph
          </p>
        </div>
      </div>
    );
  }

  return (
    <svg
      ref={svgRef}
      className="w-full h-full bg-base-100"
      style={{
        width: '100%',
        height: '100%',
      }}
    />
  );
}
