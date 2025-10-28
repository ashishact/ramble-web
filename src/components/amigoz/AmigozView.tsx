import { useState, useEffect, useCallback } from 'react';
import { NodeCard } from './NodeCard';
import { SearchBar } from './SearchBar';
import { RelatedNodesList } from './RelatedNodesList';
import type { KnowledgeNode } from './types';

interface AmigozViewProps {
  isConnected: boolean;
  customEvents: { event: string; data: any } | null;
}

export function AmigozView({ isConnected, customEvents }: AmigozViewProps) {
  const [currentNode, setCurrentNode] = useState<KnowledgeNode | null>(null);

  // Listen for node updates from backend
  useEffect(() => {
    if (customEvents && customEvents.event === 'current-node-update') {
      console.log('Received current-node-update:', customEvents.data);
      setCurrentNode(customEvents.data);
    }
  }, [customEvents]);

  // Load a node by ID when selected from search or related nodes
  const loadNodeById = useCallback(async (nodeId: number) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
      const response = await fetch(`${apiUrl}/knowledge/nodes/${nodeId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch node');
      }
      const node = await response.json();
      setCurrentNode(node);
    } catch (err) {
      console.error('Error loading node:', err);
    }
  }, []);

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-white mb-2">Knowledge Graph</h1>
          <p className="text-gray-400 text-sm">
            {isConnected ? 'Connected - Speak your thoughts' : 'Connecting...'}
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-6">
          <SearchBar onNodeSelect={loadNodeById} />
        </div>

        {/* Current Node */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-gray-300 mb-3">Current Node</h2>
          <NodeCard node={currentNode} onNodeClick={loadNodeById} />
        </div>

        {/* Related Nodes */}
        {currentNode && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-300 mb-3">Related Nodes</h2>
            <RelatedNodesList nodeId={currentNode.id} onNodeClick={loadNodeById} />
          </div>
        )}
      </div>
    </div>
  );
}
