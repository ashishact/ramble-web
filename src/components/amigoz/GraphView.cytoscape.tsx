/**
 * GraphView Component - Interactive knowledge graph visualization with Cytoscape.js
 *
 * VIRTUAL VIEW PATTERN:
 * This component maintains a "virtual view" of all accumulated nodes/edges using Maps:
 * - allNodesMapRef: Complete map of all nodes encountered during navigation
 * - allEdgesMapRef: Complete map of all edges between nodes
 *
 * The graph accumulates nodes as you navigate, with smooth animations:
 * 1. Initial render: Shows currentNode only
 * 2. Click node: Fetches relationships, adds with grow animation, prunes with shrink
 * 3. Pruning: Smoothly shrinks and removes nodes >2 hops away when total count >= 16
 *
 * Cytoscape.js provides:
 * - Smooth CSS-based animations for all transitions
 * - Manual layout control for radial/galaxy structure
 * - Better performance with large graphs
 */
import { useEffect, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import type { KnowledgeNode } from './types';

type Core = cytoscape.Core;
type ElementDefinition = cytoscape.ElementDefinition;

interface GraphViewProps {
  currentNode: KnowledgeNode | null;
  onNodeClick: (nodeId: number) => void;
}

// Utility function to get computed color from a temporary element with DaisyUI class
const getThemeColor = (className: string): string => {
  const tempEl = document.createElement('div');
  tempEl.className = className;
  tempEl.style.display = 'none';
  document.body.appendChild(tempEl);

  const computed = getComputedStyle(tempEl);
  const color = computed.backgroundColor || computed.color;

  document.body.removeChild(tempEl);
  return color || '#666666';
};

// Get theme colors for graph by reading from DaisyUI utility classes
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
  const cyRef = useRef<Core | null>(null);

  // Virtual view: Complete map of all nodes/edges accumulated during navigation
  const allNodesMapRef = useRef<Map<number, any>>(new Map());
  const allEdgesMapRef = useRef<Map<string, any>>(new Map());

  const [selectedNodeDetails, setSelectedNodeDetails] = useState<KnowledgeNode | null>(null);
  const [themeVersion, setThemeVersion] = useState(0);

  // Track if graph has been initialized
  const isInitializedRef = useRef(false);
  const initialNodeIdRef = useRef<number | null>(null);

  // Calculate distance from a node using BFS
  const calculateDistances = (fromNodeId: number): Map<number, number> => {
    const distances = new Map<number, number>();
    const queue: number[] = [fromNodeId];
    distances.set(fromNodeId, 0);

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      const currentDistance = distances.get(nodeId)!;

      allEdgesMapRef.current.forEach((edge) => {
        let neighborId: number | null = null;
        if (edge.source === nodeId) {
          neighborId = edge.target;
        } else if (edge.target === nodeId) {
          neighborId = edge.source;
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
   * Update visual hierarchy with radial/galaxy layout and smooth animations
   *
   * Does 4 things in one coordinated animation:
   * 1. Grow new nodes (size 0 -> full, opacity 0 -> 1)
   * 2. Shrink nodes to remove (size full -> 0, opacity 1 -> 0)
   * 3. Translate all nodes so selected node is at center
   * 4. Form radial clusters with outward force from center
   */
  const updateVisualHierarchy = (selectedNodeId: number) => {
    if (!cyRef.current) return;

    const cy = cyRef.current;
    const distances = calculateDistances(selectedNodeId);

    // Get all nodes currently in the graph
    const currentGraphNodeIds = new Set<number>();
    cy.nodes().forEach(node => {
      currentGraphNodeIds.add(Number(node.id()));
    });

    // Determine which nodes should be visible (distance <= 2)
    const visibleNodeIds = new Set<number>();
    allNodesMapRef.current.forEach((_nodeData, nodeId) => {
      const distance = distances.get(nodeId);
      if (distance !== undefined && distance <= 2) {
        visibleNodeIds.add(nodeId);
      }
    });

    // Categorize nodes
    const nodesToGrow: number[] = [];      // New nodes (in virtual view but not in graph yet)
    const nodesToKeep: number[] = [];       // Existing nodes that stay
    const nodesToShrink: number[] = [];     // Nodes to remove

    visibleNodeIds.forEach(nodeId => {
      if (!currentGraphNodeIds.has(nodeId)) {
        nodesToGrow.push(nodeId);
      } else {
        nodesToKeep.push(nodeId);
      }
    });

    currentGraphNodeIds.forEach(nodeId => {
      if (!visibleNodeIds.has(nodeId)) {
        nodesToShrink.push(nodeId);
      }
    });

    // Calculate target positions for all visible nodes (radial layout)
    const targetPositions = new Map<number, { x: number; y: number; size: number }>();

    // Selected node at center
    targetPositions.set(selectedNodeId, { x: 0, y: 0, size: 50 });

    // Level 1 nodes in circle
    const level1Nodes = Array.from(visibleNodeIds).filter(id => distances.get(id) === 1);
    const level1Radius = 250;
    level1Nodes.forEach((nodeId, index) => {
      const angle = (2 * Math.PI * index) / level1Nodes.length;
      const x = Math.cos(angle) * level1Radius;
      const y = Math.sin(angle) * level1Radius;
      targetPositions.set(nodeId, { x, y, size: 35 });
    });

    // Level 2 nodes around their parents
    const level2Nodes = Array.from(visibleNodeIds).filter(id => distances.get(id) === 2);
    const moonRadius = 100;

    // Build parent-child map for level 2
    const childrenMap = new Map<number, number[]>();
    level2Nodes.forEach(nodeId => {
      let parent: number | null = null;
      allEdgesMapRef.current.forEach((edge) => {
        if (edge.source === nodeId && distances.get(edge.target) === 1) {
          parent = edge.target;
        } else if (edge.target === nodeId && distances.get(edge.source) === 1) {
          parent = edge.source;
        }
      });

      if (parent !== null) {
        if (!childrenMap.has(parent)) {
          childrenMap.set(parent, []);
        }
        childrenMap.get(parent)!.push(nodeId);
      }
    });

    level2Nodes.forEach((nodeId) => {
      let parent: number | null = null;
      allEdgesMapRef.current.forEach((edge) => {
        if (edge.source === nodeId && distances.get(edge.target) === 1) {
          parent = edge.target;
        } else if (edge.target === nodeId && distances.get(edge.source) === 1) {
          parent = edge.source;
        }
      });

      if (parent !== null) {
        const parentChildren = childrenMap.get(parent) || [];
        const childIndex = parentChildren.indexOf(nodeId);
        const totalChildren = parentChildren.length;
        const parentPos = targetPositions.get(parent) || { x: 0, y: 0, size: 35 };

        const angle = (2 * Math.PI * childIndex) / totalChildren;
        const x = parentPos.x + Math.cos(angle) * moonRadius;
        const y = parentPos.y + Math.sin(angle) * moonRadius;
        targetPositions.set(nodeId, { x, y, size: 25 });
      }
    });

    // ONE COORDINATED ANIMATION:
    // 1. Shrink nodes to remove (full -> 0)
    nodesToShrink.forEach(nodeId => {
      cy.$id(String(nodeId)).animate({
        style: { width: 0, height: 0, opacity: 0 }
      }, {
        duration: 600,
        easing: 'ease-in-out-cubic'
      });
    });

    // 2. Move existing nodes to new positions
    nodesToKeep.forEach(nodeId => {
      const target = targetPositions.get(nodeId);
      if (target) {
        cy.$id(String(nodeId)).animate({
          position: { x: target.x, y: target.y },
          style: { width: target.size, height: target.size, opacity: 1 }
        }, {
          duration: 600,
          easing: 'ease-in-out-cubic'
        });
      }
    });

    // 3. Grow new nodes (0 -> full)
    nodesToGrow.forEach(nodeId => {
      const target = targetPositions.get(nodeId);
      if (target) {
        cy.$id(String(nodeId)).animate({
          position: { x: target.x, y: target.y },
          style: { width: target.size, height: target.size, opacity: 1 }
        }, {
          duration: 600,
          easing: 'ease-in-out-cubic'
        });
      }
    });

    // 4. Remove shrunk nodes after animation completes
    if (nodesToShrink.length > 0) {
      setTimeout(() => {
        if (!cyRef.current) return;
        nodesToShrink.forEach(nodeId => {
          cy.$id(String(nodeId)).remove();
          allNodesMapRef.current.delete(nodeId);
        });

        // Remove edges connected to removed nodes
        const edgesToRemove: string[] = [];
        allEdgesMapRef.current.forEach((edge, edgeId) => {
          if (nodesToShrink.includes(edge.source) || nodesToShrink.includes(edge.target)) {
            edgesToRemove.push(edgeId);
          }
        });
        edgesToRemove.forEach(edgeId => {
          cy.$id(edgeId).remove();
          allEdgesMapRef.current.delete(edgeId);
        });
      }, 650);
    }

    // Update edge styles
    allEdgesMapRef.current.forEach((edge, edgeId) => {
      const fromDistance = distances.get(edge.source) ?? 3;
      const toDistance = distances.get(edge.target) ?? 3;
      const maxDistance = Math.max(fromDistance, toDistance);
      const minDistance = Math.min(fromDistance, toDistance);

      let width: number;
      if (minDistance === 0 && maxDistance === 1) {
        width = 3;
      } else if (minDistance === 1 && maxDistance === 2) {
        width = 2;
      } else {
        width = 1.5;
      }

      const edgeEle = cy.$id(edgeId);
      if (edgeEle.length > 0) {
        edgeEle.style('width', width);
      }
    });
  };

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
   * Initialize graph once on mount or theme change
   */
  useEffect(() => {
    if (!currentNode || !containerRef.current) return;

    // Skip if already initialized (unless theme changed)
    if (isInitializedRef.current && cyRef.current) {
      return;
    }

    const initializeGraph = () => {
      const themeColors = getThemeColors();

      const elements: ElementDefinition[] = [
        {
          data: {
            id: String(currentNode.id),
            label: currentNode.title,
          },
          position: { x: 0, y: 0 }, // Start at center
        },
      ];

      allNodesMapRef.current.clear();
      allEdgesMapRef.current.clear();
      allNodesMapRef.current.set(currentNode.id, { id: currentNode.id, label: currentNode.title });

      if (cyRef.current) {
        cyRef.current.destroy();
      }

      const cy = cytoscape({
        container: containerRef.current!,
        elements,
        style: [
          {
            selector: 'node',
            style: {
              'background-color': themeColors.secondary,
              'border-width': 2,
              'border-color': themeColors.secondary,
              'label': 'data(label)',
              'color': themeColors.baseContent,
              'font-size': '10px',
              'text-valign': 'center',
              'text-halign': 'center',
              'text-wrap': 'wrap',
              'text-max-width': '100px',
              'width': 35,
              'height': 35,
            },
          },
          {
            selector: 'node:selected',
            style: {
              'background-color': themeColors.accent,
              'border-color': themeColors.accent,
            },
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': themeColors.baseContent + '66',
              'target-arrow-color': themeColors.baseContent + '66',
              'target-arrow-shape': 'triangle',
              'curve-style': 'straight',
              'arrow-scale': 0.8,
            },
          },
        ],
        layout: {
          name: 'preset',
          positions: (_node: any) => {
            // All nodes start at center, will be animated to their positions
            return { x: 0, y: 0 };
          },
          fit: false, // Don't auto-fit to viewport
          padding: 50,
        },
        autoungrabify: false,
        autounselectify: false,
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false,
        autolock: false,
      });

      cyRef.current = cy;

      // Set initial viewport to show the center
      cy.zoom(1);
      cy.center();

      // Handle node selection
      let lastSelectedNodeId: number | null = null;

      cy.on('tap', 'node', async (event) => {
        const node = event.target;
        const selectedNodeId = Number(node.id());

        if (selectedNodeId === lastSelectedNodeId) return;
        lastSelectedNodeId = selectedNodeId;

        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';

        // Fetch node details
        try {
          const response = await fetch(`${apiUrl}/knowledge/nodes/${selectedNodeId}`);
          if (response.ok) {
            const nodeDetails = await response.json();
            setSelectedNodeDetails(nodeDetails);
          }
        } catch (err) {
          console.error('Error fetching node details:', err);
        }

        // Update backend's current node
        try {
          await fetch(`${apiUrl}/knowledge/current-node`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ nodeId: selectedNodeId }),
          });
        } catch (err) {
          console.error('Error updating current node:', err);
        }

        // Fetch and add relationships
        try {
          const response = await fetch(`${apiUrl}/knowledge/nodes/${selectedNodeId}/relationships`);
          if (response.ok) {
            const relationships = await response.json();

            if (relationships.length > 0) {
              const elementsToAdd: ElementDefinition[] = [];

              for (const rel of relationships) {
                // Add source node
                if (!allNodesMapRef.current.has(rel.sourceNodeId)) {
                  const sourceTitle = rel.source_title || `Node ${rel.sourceNodeId}`;
                  elementsToAdd.push({
                    data: {
                      id: String(rel.sourceNodeId),
                      label: sourceTitle,
                    },
                    position: { x: 0, y: 0 }, // Start at center
                    style: {
                      width: 0,
                      height: 0,
                      opacity: 0,
                    },
                  });
                  allNodesMapRef.current.set(rel.sourceNodeId, { id: rel.sourceNodeId, label: sourceTitle });
                }

                // Add target node
                if (!allNodesMapRef.current.has(rel.targetNodeId)) {
                  const targetTitle = rel.target_title || `Node ${rel.targetNodeId}`;
                  elementsToAdd.push({
                    data: {
                      id: String(rel.targetNodeId),
                      label: targetTitle,
                    },
                    position: { x: 0, y: 0 }, // Start at center
                    style: {
                      width: 0,
                      height: 0,
                      opacity: 0,
                    },
                  });
                  allNodesMapRef.current.set(rel.targetNodeId, { id: rel.targetNodeId, label: targetTitle });
                }

                // Add edge
                const edgeId = `${rel.sourceNodeId}-${rel.targetNodeId}`;
                if (!allEdgesMapRef.current.has(edgeId)) {
                  elementsToAdd.push({
                    data: {
                      id: edgeId,
                      source: String(rel.sourceNodeId),
                      target: String(rel.targetNodeId),
                    },
                  });
                  allEdgesMapRef.current.set(edgeId, {
                    id: edgeId,
                    source: rel.sourceNodeId,
                    target: rel.targetNodeId,
                  });
                }
              }

              if (elementsToAdd.length > 0) {
                // Use batch to add all elements atomically
                cy.batch(() => {
                  cy.add(elementsToAdd);
                });
              }
            }
          }
        } catch (err) {
          console.error('Error fetching relationships:', err);
        }

        // Update hierarchy (will grow new nodes and prune distant ones) - use requestAnimationFrame for smooth rendering
        requestAnimationFrame(() => {
          updateVisualHierarchy(selectedNodeId);
        });

        // Update parent if different node
        if (selectedNodeId !== currentNode.id) {
          onNodeClick(selectedNodeId);
        }
      });

      return cy;
    };

    initializeGraph();
    isInitializedRef.current = true;
    initialNodeIdRef.current = currentNode.id;

    // Fetch initial relationships
    const fetchInitialRelationships = async () => {
      if (!cyRef.current) return;

      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/knowledge/nodes/${currentNode.id}/relationships`);

        if (!response.ok) {
          console.log('[GraphView] Failed to fetch relationships:', response.status);
          return;
        }

        const relationships = await response.json();
        console.log('[GraphView] Initial relationships fetched:', relationships.length, relationships);

        if (relationships.length === 0) {
          console.log('[GraphView] No relationships found');
          return;
        }

        const cy = cyRef.current;
        const elementsToAdd: ElementDefinition[] = [];

        for (const rel of relationships) {
          // Add source node if not already in graph
          if (!allNodesMapRef.current.has(rel.sourceNodeId)) {
            const sourceTitle = rel.source_title || `Node ${rel.sourceNodeId}`;
            const sourceNode = {
              data: {
                id: String(rel.sourceNodeId),
                label: sourceTitle,
              },
              position: { x: 0, y: 0 }, // Start at center
              style: {
                width: 0,
                height: 0,
                opacity: 0,
              },
            };
            elementsToAdd.push(sourceNode);
            allNodesMapRef.current.set(rel.sourceNodeId, { id: rel.sourceNodeId, label: sourceTitle });
            console.log('[GraphView] Adding source node:', rel.sourceNodeId, sourceTitle);
          }

          // Add target node if not already in graph
          if (!allNodesMapRef.current.has(rel.targetNodeId)) {
            const targetTitle = rel.target_title || `Node ${rel.targetNodeId}`;
            const targetNode = {
              data: {
                id: String(rel.targetNodeId),
                label: targetTitle,
              },
              position: { x: 0, y: 0 }, // Start at center
              style: {
                width: 0,
                height: 0,
                opacity: 0,
              },
            };
            elementsToAdd.push(targetNode);
            allNodesMapRef.current.set(rel.targetNodeId, { id: rel.targetNodeId, label: targetTitle });
            console.log('[GraphView] Adding target node:', rel.targetNodeId, targetTitle);
          }

          // Add edge
          const edgeId = `${rel.sourceNodeId}-${rel.targetNodeId}`;
          if (!allEdgesMapRef.current.has(edgeId)) {
            const edge = {
              data: {
                id: edgeId,
                source: String(rel.sourceNodeId),
                target: String(rel.targetNodeId),
              },
            };
            elementsToAdd.push(edge);
            allEdgesMapRef.current.set(edgeId, {
              id: edgeId,
              source: rel.sourceNodeId,
              target: rel.targetNodeId,
            });
            console.log('[GraphView] Adding edge:', edgeId);
          }
        }

        if (elementsToAdd.length > 0) {
          console.log('[GraphView] Adding elements:', elementsToAdd.length);

          // Use batch to add all elements atomically
          cy.batch(() => {
            cy.add(elementsToAdd);
          });

          console.log('[GraphView] Total nodes after add:', cy.nodes().length);
          console.log('[GraphView] Total edges after add:', cy.edges().length);

          // Trigger layout immediately in next tick
          requestAnimationFrame(() => {
            console.log('[GraphView] Animating hierarchy for node:', currentNode.id);
            updateVisualHierarchy(currentNode.id);
          });
        }
      } catch (err) {
        console.error('Error loading relationships:', err);
      }
    };

    fetchInitialRelationships();

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
        cyRef.current = null;
      }
      isInitializedRef.current = false;
    };
  }, [themeVersion]);

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
        style={{
          minHeight: '500px',
          position: 'relative',
        }}
      />
    </div>
  );
}
