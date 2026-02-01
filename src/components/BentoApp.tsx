import React, { useState, useEffect, useCallback, Suspense, lazy } from 'react';
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
  saveTreeToStorage,
  loadTreeFromStorage,
} from './bento';
import type { BentoTree, LeafNode, WidgetType } from './bento/types';
import {
  VoiceRecorderWidget,
  ConversationWidget,
  GoalsWidget,
  MemoriesWidget,
  EntitiesWidget,
  TopicsWidget,
  StatsWidget,
  TextInputWidget,
  WorkingMemoryWidget,
  SettingsWidget,
  PlaceholderWidget,
  LearnedCorrectionsWidget,
} from '../widgets';
import { QuestionWidget, SuggestionWidget, SpeakBetterWidget } from '../widgets/on-demand';
import { MetaQueryLensWidget } from '../widgets/lens';
import { RotateCcw, PencilRuler, Loader2, Settings } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { GlobalSTTController } from './GlobalSTTController';
import { PipelineBreadcrumb } from './PipelineBreadcrumb';
import { RambleNativeStatus } from './RambleNativeStatus';
import { HelpStrip } from './HelpStrip';
import { OnboardingFlow, useOnboarding } from '../modules/onboarding';

// Lazy-loaded TTS Widget
const TTSWidget = lazy(() =>
  import('../widgets/cards/TTSWidget').then(m => ({ default: m.TTSWidget }))
);

export const BentoApp: React.FC = () => {
  // Onboarding check
  const { isComplete: isOnboardingComplete, isLoading: isOnboardingLoading } = useOnboarding();
  const [showOnboarding, setShowOnboarding] = useState(true);

  // Navigation
  const navigate = useNavigate();
  const { profileName } = useParams();

  const [tree, setTree] = useState<BentoTree>(() => {
    const savedTree = loadTreeFromStorage();
    return savedTree ?? createInitialTree();
  });
  const [editMode, setEditMode] = useState(false);

  // Update showOnboarding when onboarding status changes
  useEffect(() => {
    if (!isOnboardingLoading) {
      setShowOnboarding(!isOnboardingComplete);
    }
  }, [isOnboardingComplete, isOnboardingLoading]);


  // Persist tree to localStorage on changes
  useEffect(() => {
    saveTreeToStorage(tree);
  }, [tree]);

  const handleSplit = useCallback((id: string, direction: 'horizontal' | 'vertical', ratio = 0.5) => {
    setTree((prev) => splitNode(prev, id, direction, ratio));
  }, []);

  const handleRemove = useCallback((id: string) => {
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

  const handleReset = useCallback(() => {
    const newTree = createInitialTree();
    setTree(newTree);
    saveTreeToStorage(newTree);
  }, []);

  const renderWidget = useCallback((node: LeafNode): React.ReactNode => {
    const props = { nodeId: node.id, config: node.widgetConfig };

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
      case 'topics':
        return <TopicsWidget {...props} />;
      case 'memories':
        return <MemoriesWidget {...props} />;
      case 'goals':
        return <GoalsWidget {...props} />;
      case 'stats':
        return <StatsWidget {...props} />;
      case 'settings':
        return <SettingsWidget {...props} />;
      case 'working-memory':
        return <WorkingMemoryWidget {...props} />;
      case 'questions':
        return <QuestionWidget />;
      case 'suggestions':
        return <SuggestionWidget />;
      case 'speak-better':
        return <SpeakBetterWidget />;
      case 'learned-corrections':
        return <LearnedCorrectionsWidget />;
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
      // Lens Widgets - intercept input on hover, bypass core pipeline
      case 'meta-query':
        return <MetaQueryLensWidget />;
      default:
        return <PlaceholderWidget nodeId={node.id} widgetType={node.widgetType} />;
    }
  }, []);

  // Show onboarding if not complete
  if (showOnboarding && !isOnboardingLoading) {
    return (
      <OnboardingFlow
        onComplete={() => setShowOnboarding(false)}
      />
    );
  }

  // Show loading while checking onboarding status
  if (isOnboardingLoading) {
    return (
      <div className="w-screen h-screen flex items-center justify-center bg-slate-100">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <GlobalSTTController>
      <div className="w-screen h-screen flex flex-col bg-slate-100">
        {/* Header */}
        <header className="h-9 bg-white border-b border-slate-200 flex items-center justify-between px-3 flex-shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-xs font-bold text-slate-700">Ramble</h1>
            <PipelineBreadcrumb />
            <RambleNativeStatus />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditMode((prev) => !prev)}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors ${
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
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                title="Reset layout to default"
                data-doc='{"icon":"mdi:restore","title":"Reset","desc":"Reset the layout to default configuration"}'
              >
                <RotateCcw size={12} />
                Reset
              </button>
            )}
            <button
              onClick={() => navigate(profileName ? `/u/${profileName}/settings` : '/settings')}
              className="p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              title="Settings"
            >
              <Settings size={14} />
            </button>
          </div>
        </header>

        {/* Bento Grid */}
        {/* ID used by lensController for lens mode visual feedback (dimming other widgets) */}
        <main id="bento-container" className="flex-1 overflow-hidden p-1">
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
