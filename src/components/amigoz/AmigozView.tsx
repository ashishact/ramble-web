import { useState, useEffect, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { NodeCard } from './NodeCard';
import { SearchBar } from './SearchBar';
import { RelatedNodesList } from './RelatedNodesList';
import { GraphView } from './GraphView';
import { SemanticView } from './SemanticView';
import { ViewToggle } from './ViewToggle';
import { RightSidebar } from '../RightSidebar';
import type { KnowledgeNode } from './types';
import { selectNode, fetchCurrentNode } from '../../utils/knowledgeApi';

type ViewMode = 'graph' | 'semantic';

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
  const [activeView, setActiveView] = useState<ViewMode>(() => {
    // Load saved preference from localStorage
    const saved = localStorage.getItem('amigoz-view-mode');
    return (saved as ViewMode) || 'graph';
  });

  // Save view mode preference
  const handleViewChange = useCallback((view: ViewMode) => {
    setActiveView(view);
    localStorage.setItem('amigoz-view-mode', view);
  }, []);

  // Fetch current node on mount
  useEffect(() => {
    const loadCurrentNode = async () => {
      try {
        const node = await fetchCurrentNode();
        if (node) {
          console.log('Loaded current node:', node);
          setCurrentNode(node);
        } else {
          console.log('No current node set yet');
        }
      } catch (err) {
        console.error('Error fetching current node:', err);
      }
    };

    loadCurrentNode();
  }, []);

  // Track when relationships change to trigger refetch
  const [relationshipVersion, setRelationshipVersion] = useState(0);

  // Listen for node and relationship updates from backend
  useEffect(() => {
    if (!customEvents) return;

    console.log('AmigozView received customEvent:', customEvents.event, customEvents.data);

    if (customEvents.event === 'current-node-update') {
      console.log('Received current-node-update:', customEvents.data);
      setCurrentNode(customEvents.data);
    } else if (customEvents.event === 'relationship-created' || customEvents.event === 'relationship-deleted') {
      console.log('Received relationship change:', customEvents.event);
      // Trigger a refresh by incrementing version
      setRelationshipVersion(v => v + 1);
    }
  }, [customEvents]);

  // Load a node by ID when selected from search or related nodes
  const loadNodeById = useCallback(async (nodeId: number) => {
    try {
      // This sets the current node in the backend and returns the node data
      const node = await selectNode(nodeId);
      // Immediately update the state (don't wait for WebSocket event)
      if (node) {
        setCurrentNode(node);
      }
    } catch (err) {
      console.error('Error loading node:', err);
    }
  }, []);

  return (
    <PanelGroup direction="horizontal">
      {/* D3 Graph Canvas or Semantic Search - 60% (3/5) */}
      <Panel defaultSize={60} minSize={30}>
        <div className="h-full w-full relative">
          {/* View Toggle */}
          <ViewToggle activeView={activeView} onViewChange={handleViewChange} />

          {/* Conditional View Rendering */}
          {activeView === 'graph' ? (
            <GraphView
              currentNode={currentNode}
              onNodeClick={loadNodeById}
              relationshipChangeKey={relationshipVersion}
            />
          ) : (
            <SemanticView onNodeSelect={loadNodeById} />
          )}
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
                <RelatedNodesList
                  key={`${currentNode.id}-${relationshipVersion}`}
                  nodeId={currentNode.id}
                  onNodeClick={loadNodeById}
                />
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
