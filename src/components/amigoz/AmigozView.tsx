import { useState, useEffect, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { NodeCard } from './NodeCard';
import { SearchBar } from './SearchBar';
import { RelatedNodesList } from './RelatedNodesList';
import { GraphView } from './GraphView';
import { RightSidebar } from '../RightSidebar';
import type { KnowledgeNode } from './types';

interface TranscriptMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

interface AmigozViewProps {
  isConnected: boolean;
  customEvents: { event: string; data: any } | null;
  transcripts: TranscriptMessage[];
  isRecording: boolean;
  onSendText: (text: string) => void;
  onToggleRecording: () => void;
  vadStatus?: {
    userSpeaking: boolean;
    lastSpeechTime: number;
    lastGeminiTime: number;
  };
}

export function AmigozView({
  customEvents,
  transcripts,
  isConnected,
  isRecording,
  onSendText,
  onToggleRecording,
  vadStatus
}: AmigozViewProps) {
  const [currentNode, setCurrentNode] = useState<KnowledgeNode | null>(null);

  // Fetch current node on mount
  useEffect(() => {
    const fetchCurrentNode = async () => {
      try {
        const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3000';
        const response = await fetch(`${apiUrl}/knowledge/current-node`);
        if (response.ok) {
          const text = await response.text();
          if (text) {
            const node = JSON.parse(text);
            if (node) {
              console.log('Loaded current node:', node);
              setCurrentNode(node);
            }
          } else {
            console.log('No current node set yet');
          }
        }
      } catch (err) {
        console.error('Error fetching current node:', err);
      }
    };

    fetchCurrentNode();
  }, []);

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
    <PanelGroup direction="horizontal">
      {/* D3 Graph Canvas - 60% (3/5) */}
      <Panel defaultSize={60} minSize={30}>
        <div className="h-full w-full">
          <GraphView currentNode={currentNode} onNodeClick={loadNodeById} />
        </div>
      </Panel>

      {/* Resize handle */}
      <PanelResizeHandle className="w-1 bg-base-300 hover:bg-primary transition-colors cursor-col-resize" />

      {/* Nodes View - 20% (1/5) */}
      <Panel defaultSize={20} minSize={15}>
        <div className="h-full overflow-auto bg-base-200 border-l border-base-300">
          <div className="p-4">
            {/* Search Bar */}
            <div className="mb-4">
              <SearchBar onNodeSelect={loadNodeById} />
            </div>

            {/* Current Node */}
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-base-content/80 mb-2">Current Node</h2>
              <NodeCard node={currentNode} onNodeClick={loadNodeById} />
            </div>

            {/* Related Nodes */}
            {currentNode && (
              <div>
                <h2 className="text-sm font-semibold text-base-content/80 mb-2">Related Nodes</h2>
                <RelatedNodesList nodeId={currentNode.id} onNodeClick={loadNodeById} />
              </div>
            )}
          </div>
        </div>
      </Panel>

      {/* Resize handle */}
      <PanelResizeHandle className="w-1 bg-base-300 hover:bg-primary transition-colors cursor-col-resize" />

      {/* Chat UI - 20% (1/5) */}
      <Panel defaultSize={20} minSize={15}>
        <RightSidebar
          transcripts={transcripts}
          isConnected={isConnected}
          isRecording={isRecording}
          onSendText={onSendText}
          onToggleRecording={onToggleRecording}
          vadStatus={vadStatus}
        />
      </Panel>
    </PanelGroup>
  );
}
