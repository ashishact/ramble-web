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
  const [activeTab, setActiveTab] = useState<'nodes' | 'graph'>('nodes');

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
    <div className="flex-1 p-8 overflow-auto bg-base-100">
      <div className="max-w-6xl mx-auto">
        {/* Tabs */}
        <div role="tablist" className="tabs tabs-boxed mb-6">
          <button
            role="tab"
            className={`tab ${activeTab === 'nodes' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('nodes')}
          >
            Nodes View
          </button>
          <button
            role="tab"
            className={`tab ${activeTab === 'graph' ? 'tab-active' : ''}`}
            onClick={() => setActiveTab('graph')}
          >
            Graph View
          </button>
        </div>

        {/* Nodes View Tab */}
        {activeTab === 'nodes' && (
          <div className="max-w-3xl mx-auto">
            {/* Search Bar */}
            <div className="mb-6">
              <SearchBar onNodeSelect={loadNodeById} />
            </div>

            {/* Current Node */}
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-base-content/80 mb-3">Current Node</h2>
              <NodeCard node={currentNode} onNodeClick={loadNodeById} />
            </div>

            {/* Related Nodes */}
            {currentNode && (
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-base-content/80 mb-3">Related Nodes</h2>
                <RelatedNodesList nodeId={currentNode.id} onNodeClick={loadNodeById} />
              </div>
            )}
          </div>
        )}

        {/* Graph View Tab */}
        {activeTab === 'graph' && (
          <div className="w-full h-[calc(100vh-16rem)]">
            <div className="card bg-base-200 w-full h-full">
              <div className="card-body items-center justify-center">
                <p className="text-base-content/60">Vis.js Graph will be implemented here</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
