/**
 * GraphView Component - Interactive knowledge graph visualization
 *
 * VIRTUAL VIEW PATTERN:
 * This component maintains a "virtual view" of all accumulated nodes/edges using Maps:
 * - allNodesMapRef: Complete map of all nodes encountered during navigation
 * - allEdgesMapRef: Complete map of all edges between nodes
 *
 * The graph accumulates nodes as you navigate, NOT recreates on each click:
 * 1. Initial render: Shows currentNode only
 * 2. Click node: Fetches its relationships, adds to virtual view, then prunes
 * 3. Pruning: Only removes nodes >2 hops away when total count >= 16
 *
 * CRITICAL: useEffect depends ONLY on themeVersion, NOT currentNode
 * - If currentNode was in deps, the effect would re-run on every node selection
 * - This would trigger cleanup, destroying the network and clearing virtual view
 * - Navigation happens via vis.js selectNode event, NOT by recreating the graph
 */
import { useEffect, useRef, useState } from 'react';
import { Network } from 'vis-network';
import { DataSet } from 'vis-data';
import type { KnowledgeNode } from './types';

interface GraphViewProps {
  currentNode: KnowledgeNode | null;
  onNodeClick: (nodeId: number) => void;
}

interface GraphNode {
  id: number;
  label: string;
  title: string;
  size?: number;
  color?: {
    background: string;
    border: string;
  };
  font?: {
    color?: string;
    size?: number;
  };
}

interface GraphEdge {
  id?: string;
  from: number;
  to: number;
  label?: string;
  arrows: string;
}

// Utility function to get computed color from a temporary element with DaisyUI class
const getThemeColor = (className: string): string => {
  // Create a temporary element to get the computed color
  const tempEl = document.createElement('div');
  tempEl.className = className;
  tempEl.style.display = 'none';
  document.body.appendChild(tempEl);

  const computed = getComputedStyle(tempEl);
  const color = computed.backgroundColor || computed.color;

  document.body.removeChild(tempEl);
  return color || '#666666';
};

// Get theme colors for vis.js by reading from DaisyUI utility classes
const getThemeColors = () => ({
  primary: getThemeColor('bg-primary'),
  primaryContent: getThemeColor('text-primary-content'),
  secondary: getThemeColor('bg-secondary'),
  secondaryContent: getThemeColor('text-secondary-content'),
  baseContent: getThemeColor('text-base-content'),
  base100: getThemeColor('bg-base-100'),
  base200: getThemeColor('bg-base-200'),
  accent: getThemeColor('bg-accent'),
});

export function GraphView({ currentNode, onNodeClick }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDataSetRef = useRef<DataSet<GraphNode> | null>(null);
  const edgesDataSetRef = useRef<DataSet<GraphEdge> | null>(null);

  // Virtual view: Complete map of all nodes/edges accumulated during navigation
  // These persist across node selections and are only cleared on component unmount
  const allNodesMapRef = useRef<Map<number, GraphNode>>(new Map());
  const allEdgesMapRef = useRef<Map<string, GraphEdge>>(new Map());

  const [themeVersion, setThemeVersion] = useState(0);
  const [selectedNodeDetails, setSelectedNodeDetails] = useState<KnowledgeNode | null>(null);

  // Calculate distance from a node using BFS
  const calculateDistances = (fromNodeId: number): Map<number, number> => {
    const distances = new Map<number, number>();
    const queue: number[] = [fromNodeId];
    distances.set(fromNodeId, 0);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const currentDistance = distances.get(nodeId)!;

      // Find all connected edges
      allEdgesMapRef.current.forEach((edge) => {
        let neighborId: number | null = null;
        if (edge.from === nodeId) {
          neighborId = edge.to;
        } else if (edge.to === nodeId) {
          neighborId = edge.from;
        }

        if (neighborId !== null && !distances.has(neighborId)) {
          distances.set(neighborId, currentDistance + 1);
          queue.push(neighborId);
        }
      });
    }

    return distances;
  };

  /**
   * Update visual hierarchy with radial/galaxy layout
   * - Selected node (distance 0): Center sun
   * - Distance 1: Planets orbiting the sun (each forms its own solar system)
   * - Distance 2: Moons orbiting their planets
   * Creates a radial hierarchy flowing outward from center
   */
  const updateVisualHierarchy = (selectedNodeId: number) => {
    if (!nodesDataSetRef.current || !edgesDataSetRef.current || !networkRef.current) return;

    const distances = calculateDistances(selectedNodeId);

    // Build parent-child relationships for hierarchical positioning
    const childrenMap = new Map<number, number[]>(); // parent -> [children]
    allEdgesMapRef.current.forEach((edge) => {
      const fromDist = distances.get(edge.from) ?? 999;
      const toDist = distances.get(edge.to) ?? 999;

      // Parent is the node closer to selected node
      let parent: number, child: number;
      if (fromDist < toDist) {
        parent = edge.from;
        child = edge.to;
      } else if (toDist < fromDist) {
        parent = edge.to;
        child = edge.from;
      } else {
        // Same distance - treat as siblings, no parent-child
        return;
      }

      if (!childrenMap.has(parent)) {
        childrenMap.set(parent, []);
      }
      childrenMap.get(parent)!.push(child);
    });

    // Update node sizes and positions
    const updates: Array<{ id: number; size: number; level?: number; x?: number; y?: number; fixed?: { x: boolean; y: boolean } }> = [];

    // Position selected node at center - allow smooth animation
    updates.push({
      id: selectedNodeId,
      size: 50,
      level: 0,
      x: 0,
      y: 0,
      fixed: { x: false, y: false }, // Allow physics for smooth animation
    });

    // Position level 1 nodes (planets) in a circle around selected node
    const level1Nodes = Array.from(allNodesMapRef.current.keys()).filter(id => distances.get(id) === 1);
    const level1Radius = 250;
    level1Nodes.forEach((nodeId, index) => {
      const angle = (2 * Math.PI * index) / level1Nodes.length;
      updates.push({
        id: nodeId,
        size: 35,
        level: 1,
        x: Math.cos(angle) * level1Radius,
        y: Math.sin(angle) * level1Radius,
        fixed: { x: false, y: false }, // Allow smooth animation
      });
    });

    // Position level 2 nodes (moons) around their parent planets
    const level2Nodes = Array.from(allNodesMapRef.current.keys()).filter(id => distances.get(id) === 2);
    level2Nodes.forEach((nodeId) => {
      // Find parent (level 1 node connected to this node)
      let parent: number | null = null;
      allEdgesMapRef.current.forEach((edge) => {
        if (edge.from === nodeId && distances.get(edge.to) === 1) {
          parent = edge.to;
        } else if (edge.to === nodeId && distances.get(edge.from) === 1) {
          parent = edge.from;
        }
      });

      if (parent !== null) {
        const parentChildren = childrenMap.get(parent) || [];
        const childIndex = parentChildren.indexOf(nodeId);
        const totalChildren = parentChildren.length;

        // Position around parent in a smaller circle
        const parentUpdate = updates.find(u => u.id === parent);
        if (parentUpdate && parentUpdate.x !== undefined && parentUpdate.y !== undefined) {
          const moonRadius = 100;
          const angle = (2 * Math.PI * childIndex) / totalChildren;
          updates.push({
            id: nodeId,
            size: 25,
            level: 2,
            x: parentUpdate.x + Math.cos(angle) * moonRadius,
            y: parentUpdate.y + Math.sin(angle) * moonRadius,
            fixed: { x: false, y: false }, // Allow smooth animation
          });
        }
      }
    });

    nodesDataSetRef.current.update(updates);

    // Update edge styling based on hierarchy - straight lines only
    const edgeUpdates: Array<{ id: string; width: number; smooth?: boolean }> = [];
    allEdgesMapRef.current.forEach((edge, edgeId) => {
      const fromDistance = distances.get(edge.from) ?? 3;
      const toDistance = distances.get(edge.to) ?? 3;
      const maxDistance = Math.max(fromDistance, toDistance);
      const minDistance = Math.min(fromDistance, toDistance);

      let width: number;

      // Edges connecting different levels
      if (minDistance === 0 && maxDistance === 1) {
        width = 3; // Center to planets
      } else if (minDistance === 1 && maxDistance === 2) {
        width = 2; // Planets to moons
      } else if (minDistance === maxDistance) {
        // Same level connections (siblings)
        width = 1.5;
      } else {
        width = 1;
      }

      edgeUpdates.push({
        id: edgeId,
        width,
        smooth: false, // Straight lines like reference image
      });
    });

    edgesDataSetRef.current.update(edgeUpdates);

    // Let physics settle naturally with gentle animation
    if (networkRef.current) {
      // Don't force stabilization - let it animate naturally
      // networkRef.current.stabilize() would cause jumps
    }
  };

  /**
   * Prune graph to keep only nodes within distance 2 of selected node
   * Smoothly shrinks nodes to size 0 before removing them
   */
  const pruneGraph = (selectedNodeId: number) => {
    if (!nodesDataSetRef.current || !edgesDataSetRef.current) return;

    const totalNodes = allNodesMapRef.current.size;

    // If less than 16 nodes, keep everything
    if (totalNodes < 16) {
      return;
    }

    // Calculate distances from selected node using BFS
    const distances = calculateDistances(selectedNodeId);

    // Find nodes to remove (distance > 2 or unreachable)
    const nodesToRemove: number[] = [];
    allNodesMapRef.current.forEach((node, nodeId) => {
      const distance = distances.get(nodeId);
      if (distance === undefined || distance > 2) {
        nodesToRemove.push(nodeId);
      }
    });

    if (nodesToRemove.length === 0) {
      return;
    }

    // Animate nodes shrinking to 0 before removal
    const shrinkUpdates = nodesToRemove.map(nodeId => ({
      id: nodeId,
      size: 0,
    }));
    nodesDataSetRef.current.update(shrinkUpdates);

    // After animation completes, remove nodes
    setTimeout(() => {
      if (!nodesDataSetRef.current || !edgesDataSetRef.current) return;

      // Remove nodes from DataSet and tracking map
      nodesToRemove.forEach(nodeId => {
        allNodesMapRef.current.delete(nodeId);
      });
      nodesDataSetRef.current.remove(nodesToRemove);

      // Remove edges connected to removed nodes
      const edgesToRemove: string[] = [];
      allEdgesMapRef.current.forEach((edge, edgeId) => {
        if (nodesToRemove.includes(edge.from) || nodesToRemove.includes(edge.to)) {
          edgesToRemove.push(edgeId);
        }
      });

      if (edgesToRemove.length > 0) {
        edgesToRemove.forEach(edgeId => {
          allEdgesMapRef.current.delete(edgeId);
        });
        edgesDataSetRef.current.remove(edgesToRemove);
      }
    }, 500); // Wait for shrink animation
  };

  // Listen for theme changes
  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          setThemeVersion(v => v + 1); // Trigger re-render
        }
      });
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  // Track if graph has been initialized
  const isInitializedRef = useRef(false);
  // Track the initial node ID for reference
  const initialNodeIdRef = useRef<number | null>(null);

  /**
   * Initialize graph once on mount or when theme changes
   *
   * IMPORTANT: This effect depends ONLY on themeVersion, NOT on currentNode
   * - If currentNode was in dependencies, the effect would re-run every time a node is selected
   * - This would trigger cleanup (destroying the network) and recreate the graph from scratch
   * - That would clear the virtual view (allNodesMapRef/allEdgesMapRef) losing accumulated nodes
   *
   * The graph accumulates nodes as you navigate:
   * - Initial render: Creates graph with currentNode
   * - Clicking nodes: Uses selectNode event handler to fetch/add relationships
   * - The virtual view (Maps) preserves all nodes across navigation
   * - Pruning only removes distant nodes when total > 16
   */
  useEffect(() => {
    if (!currentNode || !containerRef.current) {
      return;
    }

    // Skip if graph already initialized (unless theme changed, which resets isInitializedRef)
    if (isInitializedRef.current && networkRef.current) {
      return;
    }

    // Initialize graph with just the current node immediately
    const initializeGraph = () => {
      const themeColors = getThemeColors();

      const initialNode: GraphNode = {
        id: currentNode.id,
        label: currentNode.title, // Show full title as label
        title: currentNode.title, // Also on hover
        color: {
          background: themeColors.primary,
          border: themeColors.primary,
        },
        font: {
          color: themeColors.baseContent,
          size: 12,
        },
      };

      const nodes = new DataSet<GraphNode>([initialNode]);
      const edges = new DataSet<GraphEdge>([]);

      // Track initial node
      allNodesMapRef.current.clear();
      allEdgesMapRef.current.clear();
      allNodesMapRef.current.set(currentNode.id, initialNode);

      nodesDataSetRef.current = nodes;
      edgesDataSetRef.current = edges;

      const data = { nodes, edges };
      const options = {
        nodes: {
          shape: 'circle',
          size: 35,
          font: {
            size: 10,
            color: themeColors.baseContent,
            face: 'Arial',
            multi: 'html',
            bold: {
              color: themeColors.baseContent,
            },
          },
          borderWidth: 2,
          color: {
            background: themeColors.secondary,
            border: themeColors.secondary,
            highlight: {
              background: themeColors.accent,
              border: themeColors.accent,
            },
          },
          widthConstraint: {
            maximum: 120,
          },
        },
        edges: {
          width: 2,
          color: {
            color: themeColors.baseContent + '40', // Add opacity
            highlight: themeColors.accent,
          },
          font: {
            size: 10,
            color: themeColors.baseContent + '80',
            strokeWidth: 0,
            align: 'middle',
          },
          smooth: {
            enabled: false, // Straight lines like the reference image
          },
          arrows: {
            to: {
              enabled: true,
              scaleFactor: 0.8,
            },
          },
        },
        physics: {
          enabled: true,
          stabilization: {
            enabled: false, // Disable auto-stabilization for smoother manual control
          },
          barnesHut: {
            gravitationalConstant: -3000,
            centralGravity: 0.1,
            springLength: 200,
            springConstant: 0.01, // Very gentle springs
            avoidOverlap: 0.5,
            damping: 0.5, // More damping for smoother motion
          },
          solver: 'barnesHut',
          timestep: 0.5, // Slower timestep for smoother animation
          adaptiveTimestep: true,
          minVelocity: 0.1,
        },
        interaction: {
          hover: true,
          tooltipDelay: 100,
          dragNodes: true,
          dragView: true,
          zoomView: true,
        },
      };

      if (networkRef.current) {
        networkRef.current.destroy();
      }

      const network = new Network(containerRef.current!, data, options);
      networkRef.current = network;

      // Track last selected node to avoid re-processing
      let lastSelectedNodeId: number | null = null;

      /**
       * Handle node selection - This is where navigation happens!
       * Flow: Fetch relationships -> Add to virtual view -> Prune distant nodes -> Update parent
       * IMPORTANT: This does NOT recreate the graph, it only adds/removes nodes from existing network
       */
      network.on('selectNode', async (params) => {
        if (params.nodes.length > 0) {
          const selectedNodeId = params.nodes[0] as number;

          // Prevent re-processing the same node
          if (selectedNodeId === lastSelectedNodeId) {
            return;
          }

          lastSelectedNodeId = selectedNodeId;

          const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

          // Fetch node details for the card
          try {
            const response = await fetch(`${apiUrl}/knowledge/nodes/${selectedNodeId}`);
            if (response.ok) {
              const nodeDetails = await response.json();
              setSelectedNodeDetails(nodeDetails);
            }
          } catch (err) {
            console.error('Error fetching node details:', err);
          }

          // Fetch and add relationships for the selected node FIRST, then prune
          try {
            const response = await fetch(`${apiUrl}/knowledge/nodes/${selectedNodeId}/relationships`);
            if (response.ok) {
              const relationships = await response.json();

              if (relationships.length > 0 && nodesDataSetRef.current && edgesDataSetRef.current) {
                const existingNodeIds = new Set(nodesDataSetRef.current.getIds());
                const newNodes: GraphNode[] = [];
                const newEdges: GraphEdge[] = [];

                for (const rel of relationships) {
                  // Add source node if not already added - start at size 0
                  if (!existingNodeIds.has(rel.sourceNodeId) && !allNodesMapRef.current.has(rel.sourceNodeId)) {
                    const sourceTitle = rel.source_title || `Node ${rel.sourceNodeId}`;
                    const sourceNode: GraphNode = {
                      id: rel.sourceNodeId,
                      label: sourceTitle,
                      title: sourceTitle,
                      size: 0, // Start at size 0 for smooth grow-in animation
                    };
                    newNodes.push(sourceNode);
                    allNodesMapRef.current.set(rel.sourceNodeId, sourceNode);
                    existingNodeIds.add(rel.sourceNodeId);
                  }

                  // Add target node if not already added - start at size 0
                  if (!existingNodeIds.has(rel.targetNodeId) && !allNodesMapRef.current.has(rel.targetNodeId)) {
                    const targetTitle = rel.target_title || `Node ${rel.targetNodeId}`;
                    const targetNode: GraphNode = {
                      id: rel.targetNodeId,
                      label: targetTitle,
                      title: targetTitle,
                      size: 0, // Start at size 0 for smooth grow-in animation
                    };
                    newNodes.push(targetNode);
                    allNodesMapRef.current.set(rel.targetNodeId, targetNode);
                    existingNodeIds.add(rel.targetNodeId);
                  }

                  // Add edge
                  const edgeId = `${rel.sourceNodeId}-${rel.targetNodeId}`;
                  if (!allEdgesMapRef.current.has(edgeId)) {
                    const edge: GraphEdge = {
                      id: edgeId,
                      from: rel.sourceNodeId,
                      to: rel.targetNodeId,
                      title: rel.description || '',
                      arrows: 'to',
                    };
                    newEdges.push(edge);
                    allEdgesMapRef.current.set(edgeId, edge);
                  }
                }

                // Add new nodes and edges to the graph
                if (newNodes.length > 0) {
                  nodesDataSetRef.current.add(newNodes);

                  // Store new node IDs for grow animation
                  const newNodeIds = newNodes.map(n => n.id);

                  // After a brief delay, grow new nodes to full size
                  setTimeout(() => {
                    if (!nodesDataSetRef.current) return;
                    // Visual hierarchy will set proper sizes based on distance
                    newNodeIds.forEach(id => {
                      // updateVisualHierarchy will set the correct size
                    });
                  }, 50);
                }
                if (newEdges.length > 0) {
                  edgesDataSetRef.current.add(newEdges);
                }
              }
            }
          } catch (err) {
            console.error('Error fetching relationships:', err);
          }

          // First update visual hierarchy (which will grow new nodes from 0 to target size)
          updateVisualHierarchy(selectedNodeId);

          // Then prune graph after updating hierarchy
          pruneGraph(selectedNodeId);

          // Only call onNodeClick if it's a different node than the current one
          if (selectedNodeId !== currentNode.id) {
            onNodeClick(selectedNodeId);
          }
        }
      });

      // Handle deselection
      network.on('deselectNode', () => {
        lastSelectedNodeId = null;
        setSelectedNodeDetails(null);
      });

      return network;
    };

    initializeGraph();
    isInitializedRef.current = true;
    initialNodeIdRef.current = currentNode.id;

    // Fetch and add relationships progressively
    const fetchAndAddRelationships = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/knowledge/nodes/${currentNode.id}/relationships`);

        if (!response.ok) {
          console.error('Failed to fetch relationships:', response.status);
          return;
        }

        const relationships = await response.json();

        if (relationships.length === 0 || !nodesDataSetRef.current || !edgesDataSetRef.current) {
          return;
        }

        const existingNodeIds = new Set(nodesDataSetRef.current.getIds());

        // Add new nodes and edges
        const newNodes: GraphNode[] = [];
        const newEdges: GraphEdge[] = [];

        for (const rel of relationships) {
          // Add source node if not already added - start at size 0
          if (!existingNodeIds.has(rel.sourceNodeId) && !allNodesMapRef.current.has(rel.sourceNodeId)) {
            const sourceTitle = rel.source_title || `Node ${rel.sourceNodeId}`;
            const sourceNode: GraphNode = {
              id: rel.sourceNodeId,
              label: sourceTitle,
              title: sourceTitle,
              size: 0, // Start at size 0 for smooth grow-in animation
            };
            newNodes.push(sourceNode);
            allNodesMapRef.current.set(rel.sourceNodeId, sourceNode);
            existingNodeIds.add(rel.sourceNodeId);
          }

          // Add target node if not already added - start at size 0
          if (!existingNodeIds.has(rel.targetNodeId) && !allNodesMapRef.current.has(rel.targetNodeId)) {
            const targetTitle = rel.target_title || `Node ${rel.targetNodeId}`;
            const targetNode: GraphNode = {
              id: rel.targetNodeId,
              label: targetTitle,
              title: targetTitle,
              size: 0, // Start at size 0 for smooth grow-in animation
            };
            newNodes.push(targetNode);
            allNodesMapRef.current.set(rel.targetNodeId, targetNode);
            existingNodeIds.add(rel.targetNodeId);
          }

          // Add edge
          const edgeId = `${rel.sourceNodeId}-${rel.targetNodeId}`;
          if (!allEdgesMapRef.current.has(edgeId)) {
            const edge: GraphEdge = {
              id: edgeId,
              from: rel.sourceNodeId,
              to: rel.targetNodeId,
              title: rel.description || '', // Show description on hover only
              arrows: 'to',
            };
            newEdges.push(edge);
            allEdgesMapRef.current.set(edgeId, edge);
          }
        }

        // Update network with new data
        if (newNodes.length > 0) {
          nodesDataSetRef.current.add(newNodes);
        }
        if (newEdges.length > 0) {
          edgesDataSetRef.current.add(newEdges);
        }

        // Apply visual hierarchy after initial relationships are loaded
        updateVisualHierarchy(currentNode.id);
      } catch (err) {
        console.error('Error loading relationships:', err);
      }
    };

    fetchAndAddRelationships();

    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
      nodesDataSetRef.current = null;
      edgesDataSetRef.current = null;
      isInitializedRef.current = false;
    };
  }, [themeVersion]); // Only depend on themeVersion, not currentNode!

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
    <div className="flex flex-col w-full h-full gap-4">
      {/* Node Details Card - Fixed Height Container */}
      <div className="w-full h-24 flex-shrink-0">
        {selectedNodeDetails ? (
          <div className="card bg-base-200 shadow-lg border border-base-300 h-full">
            <div className="card-body p-3">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-base line-clamp-1">{selectedNodeDetails.title}</h3>
                <button
                  onClick={() => setSelectedNodeDetails(null)}
                  className="btn btn-ghost btn-xs btn-circle flex-shrink-0"
                >
                  ✕
                </button>
              </div>
              {selectedNodeDetails.content && (
                <p className="text-xs text-base-content/80 line-clamp-2">
                  {selectedNodeDetails.content}
                </p>
              )}
              {selectedNodeDetails.tags && selectedNodeDetails.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1 overflow-hidden">
                  {selectedNodeDetails.tags.slice(0, 5).map((tag, idx) => (
                    <span key={idx} className="badge badge-xs badge-outline">
                      {tag}
                    </span>
                  ))}
                  {selectedNodeDetails.tags.length > 5 && (
                    <span className="badge badge-xs badge-ghost">+{selectedNodeDetails.tags.length - 5}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-base-content/50">
            Select a node to view details
          </div>
        )}
      </div>

      {/* Graph Canvas */}
      <div
        ref={containerRef}
        className="flex-1 w-full bg-base-100 rounded-box"
        style={{ minHeight: '500px' }}
      />
    </div>
  );
}
