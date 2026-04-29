import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore, Suspense, lazy } from 'react';
import { getGraphService, getEmbeddingListener } from '../graph';
import {
  BentoNodeComponent,
  createInitialTree,
  splitNode,
  removeNode,
  updateNodeRatio,
  swapNodes,
  updateNodeColor,
  updateNodeContent,
  updateNodeWidgetType,
  updateNodeWidgetConfig,
} from './bento';
import type { BentoTree, LeafNode, WidgetType } from './bento/types';
import { workspaceStore } from '../stores/workspaceStore';
import {
  VoiceRecorderWidget,
  ConversationWidget,
  GoalsWidget,
  EntitiesWidget,
  TextInputWidget,
  SettingsWidget,
  PlaceholderWidget,
  EmbeddingTestWidget,
  CanonicalViewWidget,
  DomainTreeWidget,
} from '../widgets';
import { SpeakBetterWidget, MeetingTranscriptionWidget } from '../widgets/on-demand';
import { RotateCcw, PencilRuler, Loader2, Settings, Pause } from 'lucide-react';
import { systemPause } from '../lib/systemPause';
import { ProfileMenu } from './auth/ProfileMenu';
import { useShortcut } from '../hooks/useShortcut';
import { hoveredWidgetStore } from '../stores/hoveredWidgetStore';
import { toggleWidgetPauseExternal, removeWidgetState } from '../widgets/on-demand/useWidgetPause';
import { uploadFiles, isSupportedFileType } from '../services/fileUpload';
import { getCurrentProfile } from '../lib/profile';
import { useNavigate, useParams } from 'react-router-dom';
import { GlobalSTTController } from './GlobalSTTController';
import { RambleNativeStatus } from './RambleNativeStatus';
import { ExtensionStatus } from './ExtensionStatus';
import { CloudSTTStatus } from './CloudSTTStatus';
import { HelpStrip } from './HelpStrip';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { SpotlightBar } from '../modules/spotlight';

// Lazy-loaded TTS Widget
const TTSWidget = lazy(() =>
  import('../widgets/cards/TTSWidget').then(m => ({ default: m.TTSWidget }))
);

// Lazy-loaded Knowledge Tree Widget (echarts code-split)
const KnowledgeTreeWidget = lazy(() =>
  import('../widgets/cards/KnowledgeTreeWidget').then(m => ({ default: m.KnowledgeTreeWidget }))
);

// Lazy-loaded Knowledge Map Widget (echarts code-split)
const KnowledgeMapWidget = lazy(() =>
  import('../widgets/on-demand/knowledge-map').then(m => ({ default: m.KnowledgeMapWidget }))
);

export const BentoApp: React.FC = () => {
  // Navigation
  const navigate = useNavigate();
  const { profileName } = useParams();

  // System-wide pause — reactive via useSyncExternalStore
  const isSystemPaused = useSyncExternalStore(
    systemPause.subscribe,
    () => systemPause.isPaused,
  );

  // Workspace-aware tree state
  const wsState = useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getState);
  const [tree, setTree] = useState<BentoTree>(() => workspaceStore.getActiveTree());
  const setTreeRef = useRef(setTree);
  setTreeRef.current = setTree;
  const [editMode, setEditMode] = useState(false);

  // Space bar toggles pause on the currently-hovered widget (scoped to leaf node ID)
  useShortcut('widget-toggle-pause', { key: ' ' }, () => {
    const hovered = hoveredWidgetStore.getState();
    if (!hovered) return;
    toggleWidgetPauseExternal(hovered.nodeId);
  }, 'Toggle pause on hovered widget');

  // Sync tree when active workspace changes (e.g. from WorkspaceSwitcher)
  useEffect(() => {
    setTree(workspaceStore.getActiveTree());
  }, [wsState.activeId]);

  // Persist tree changes to the active workspace
  useEffect(() => {
    workspaceStore.saveTree(tree);
  }, [tree]);

  // Initialize DuckDB Knowledge Graph + Embedding Listener + SYS-I Engine (non-blocking)
  useEffect(() => {
    getGraphService()
      .then(async (g) => {
        console.log('[KG] DuckDB graph initialized', g);
        await getEmbeddingListener();
        // Start SYS-I engine after graph is ready (needs conversationStore)
        const { getSys1Engine } = await import('../modules/sys1');
        getSys1Engine();
        // Initialize ontology system (install defaults, start tracker, emit first suggestion)
        const { initOntology } = await import('../modules/ontology');
        initOntology().catch(err => console.warn('[Ontology] Init failed:', err));
        // Start auto-backup (triggers on tab hidden if > 24h since last backup)
        const { initAutoBackup } = await import('../graph/backup');
        initAutoBackup(getCurrentProfile());
      })
      .catch(err => {
        console.warn('[KG] DuckDB init failed:', err);
      });
  }, []);

  const handleSplit = useCallback((id: string, direction: 'horizontal' | 'vertical', ratio = 0.5) => {
    setTree((prev) => splitNode(prev, id, direction, ratio));
  }, []);

  const handleRemove = useCallback((id: string) => {
    removeWidgetState(id);
    setTree((prev) => removeNode(prev, id));
  }, []);

  const handleResize = useCallback((id: string, ratio: number) => {
    setTree((prev) => updateNodeRatio(prev, id, ratio));
  }, []);

  const handleSwap = useCallback((id1: string, id2: string) => {
    setTree((prev) => swapNodes(prev, id1, id2));
  }, []);

  const handleColorChange = useCallback((id: string, color: string) => {
    setTree((prev) => updateNodeColor(prev, id, color));
  }, []);

  const handleContentChange = useCallback((id: string, content: string) => {
    setTree((prev) => updateNodeContent(prev, id, content));
  }, []);

  const handleWidgetChange = useCallback((id: string, widgetType: WidgetType) => {
    setTree((prev) => updateNodeWidgetType(prev, id, widgetType));
  }, []);

  // Fallback file drop handler on the bento container.
  // Files that miss a BentoLeaf still get captured here.
  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  }, []);

  const handleContainerDrop = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      const supported = Array.from(e.dataTransfer.files).filter(f => isSupportedFileType(f.name));
      if (supported.length > 0) {
        uploadFiles(supported).catch(console.error);
      }
    }
  }, []);

  const handleReset = useCallback(() => {
    // Try workspace template reset first, fall back to generic initial tree
    const resetTree = workspaceStore.resetToDefault(wsState.activeId);
    setTree(resetTree ?? createInitialTree());
  }, [wsState.activeId]);

  const renderWidget = useCallback((node: LeafNode): React.ReactNode => {
    const onConfigChange = (config: Record<string, unknown>) => {
      setTreeRef.current(prev => updateNodeWidgetConfig(prev, node.id, config));
    };
    const props = { nodeId: node.id, config: node.widgetConfig, onConfigChange };

    switch (node.widgetType) {
      case 'empty':
        return null; // Widget picker is handled by BentoLeaf
      case 'voice-recorder':
        return <VoiceRecorderWidget {...props} />;
      case 'text-input':
        return <TextInputWidget {...props} />;
      case 'conversation':
        return <ConversationWidget {...props} />;
      case 'entities':
        return <EntitiesWidget {...props} />;
      case 'goals':
        return <GoalsWidget {...props} />;
      case 'settings':
        return <SettingsWidget {...props} />;
      case 'speak-better':
        return <SpeakBetterWidget nodeId={node.id} />;
      case 'tts':
        return (
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin opacity-60" />
              <span className="text-xs opacity-60">Loading TTS...</span>
            </div>
          }>
            <TTSWidget {...props} />
          </Suspense>
        );
      case 'meeting-transcription':
        return <MeetingTranscriptionWidget nodeId={node.id} />;
      // Knowledge tree widgets (v9) — lazy-loaded (echarts code-split)
      case 'knowledge-tree':
        return (
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin opacity-60" />
              <span className="text-xs opacity-60">Loading Knowledge Tree...</span>
            </div>
          }>
            <KnowledgeTreeWidget {...props} />
          </Suspense>
        );
      // Observability widgets
      case 'embedding-test':
        return <EmbeddingTestWidget {...props} />;
      case 'canonical-view':
        return <CanonicalViewWidget {...props} />;
      case 'domain-tree':
        return <DomainTreeWidget {...props} />;
      case 'knowledge-map':
        return (
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin opacity-60" />
              <span className="text-xs opacity-60">Loading Knowledge Map...</span>
            </div>
          }>
            <KnowledgeMapWidget nodeId={node.id} />
          </Suspense>
        );
      default:
        return <PlaceholderWidget nodeId={node.id} widgetType={node.widgetType} />;
    }
  }, []);

  return (
    <GlobalSTTController>
      <div className="w-screen h-screen flex flex-col bg-slate-100">
        {/* Header */}
        <header className="h-8 bg-white border-b border-slate-200 flex items-center gap-2 px-3 flex-shrink-0">
          <button
            onClick={() => systemPause.toggle()}
            className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded transition-all ${
              isSystemPaused
                ? 'ring-2 ring-warning/60 bg-warning/10'
                : ''
            }`}
            title={isSystemPaused ? 'System paused — click to resume' : 'Click to pause system'}
          >
            {isSystemPaused
              ? <Pause size={14} className="text-warning" />
              : <img src="/ramble-icon.png" alt="Ramble" className="w-5 h-5" />
            }
          </button>
          <RambleNativeStatus />
          <ExtensionStatus />
          <CloudSTTStatus />
          <WorkspaceSwitcher onTreeChange={setTree} />
          <SpotlightBar />
          <ProfileMenu />
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setEditMode((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded transition-colors ${
                editMode
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title={editMode ? 'Exit edit mode' : 'Enter edit mode to split, drag, and configure panels'}
              data-doc='{"icon":"mdi:pencil-ruler","title":"Edit Layout","desc":"Split, drag, resize and configure panels"}'
            >
              <PencilRuler size={12} />
              {editMode ? 'Done' : 'Edit Layout'}
            </button>
            {editMode && (
              <button
                onClick={handleReset}
                className="flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                title="Reset layout to default"
                data-doc='{"icon":"mdi:restore","title":"Reset","desc":"Reset the layout to default configuration"}'
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}
            <button
              onClick={() => navigate(profileName ? `/u/${profileName}/settings` : '/settings')}
              className="p-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              title="Settings"
            >
              <Settings size={14} />
            </button>
          </div>
        </header>

        {/* Bento Grid */}
        {/* ID used by lensController for lens mode visual feedback (dimming other widgets) */}
        <main id="bento-container" className="flex-1 overflow-hidden p-1"
          onDragOver={handleContainerDragOver}
          onDrop={handleContainerDrop}
        >
          <BentoNodeComponent
            tree={tree}
            nodeId={tree.rootId}
            editMode={editMode}
            onSplit={handleSplit}
            onRemove={handleRemove}
            onResize={handleResize}
            onSwap={handleSwap}
            onColorChange={handleColorChange}
            onContentChange={handleContentChange}
            onWidgetChange={handleWidgetChange}
            renderWidget={renderWidget}
          />
        </main>

        {/* Help Strip */}
        <HelpStrip />
      </div>
    </GlobalSTTController>
  );
};
