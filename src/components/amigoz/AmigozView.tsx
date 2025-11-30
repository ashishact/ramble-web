import { useState, useCallback } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { GraphView } from './GraphView';
import { SemanticView } from './SemanticView';
import { ViewToggle } from './ViewToggle';
import { NodeInfoPanel } from './NodeInfoPanel';
import { RightSidebar } from '../RightSidebar';
import { useCurrentNode } from './hooks/useCurrentNode';
import type { ObserverMessage } from '../../services/observerAgentAI';

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
  observerMessages?: ObserverMessage[];
  observerStatus?: { status: string; description: string };
  isRecording: boolean;
  onSendText: (text: string) => void;
  onToggleRecording: () => void;
  vadStatus?: {
    userSpeaking: boolean;
    lastSpeechTime: number;
    lastGeminiTime: number;
  };
  onOpenSettings?: () => void;
}

export function AmigozView({
  customEvents,
  transcripts,
  observerMessages,
  observerStatus,
  isConnected,
  isRecording,
  onSendText,
  onToggleRecording,
  vadStatus,
  onOpenSettings
}: AmigozViewProps) {
  // Manage current node state
  const { currentNode, relationshipVersion, loadNodeById } = useCurrentNode({ customEvents });

  // Manage view mode state
  const [activeView, setActiveView] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('amigoz-view-mode');
    return (saved as ViewMode) || 'graph';
  });

  const handleViewChange = useCallback((view: ViewMode) => {
    setActiveView(view);
    localStorage.setItem('amigoz-view-mode', view);
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
            <SemanticView onNodeSelect={loadNodeById} customEvents={customEvents} />
          )}
        </div>
      </Panel>

      {/* Resize handle */}
      <PanelResizeHandle className="w-1 bg-base-300 hover:bg-primary transition-colors cursor-col-resize" />

      {/* Node Info Panel - 20% (1/5) */}
      <Panel defaultSize={20} minSize={15}>
        <NodeInfoPanel
          currentNode={currentNode}
          relationshipVersion={relationshipVersion}
          onNodeSelect={loadNodeById}
        />
      </Panel>

      {/* Resize handle */}
      <PanelResizeHandle className="w-1 bg-base-300 hover:bg-primary transition-colors cursor-col-resize" />

      {/* Chat UI - 20% (1/5) */}
      <Panel defaultSize={20} minSize={15}>
        <RightSidebar
          transcripts={transcripts}
          observerMessages={observerMessages}
          observerStatus={observerStatus}
          isConnected={isConnected}
          isRecording={isRecording}
          onSendText={onSendText}
          onToggleRecording={onToggleRecording}
          vadStatus={vadStatus}
          onOpenSettings={onOpenSettings}
        />
      </Panel>
    </PanelGroup>
  );
}
