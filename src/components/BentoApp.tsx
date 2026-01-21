import React, { useState, useEffect, useCallback, useRef } from 'react';
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
} from '../widgets';
import { SuggestionWidget } from '../widgets/on-demand';
import { RotateCcw, PencilRuler } from 'lucide-react';
import { TranscriptReview, registerTranscriptReview } from './TranscriptReview';
import { PipelineBreadcrumb } from './PipelineBreadcrumb';

export const BentoApp: React.FC = () => {
  const [tree, setTree] = useState<BentoTree>(() => {
    const savedTree = loadTreeFromStorage();
    return savedTree ?? createInitialTree();
  });
  const [editMode, setEditMode] = useState(false);

  // Transcript review state
  const [reviewText, setReviewText] = useState<string | null>(null);
  const reviewCallbackRef = useRef<((text: string) => void) | null>(null);

  // Register the transcript review handler
  useEffect(() => {
    registerTranscriptReview((text, onSubmit) => {
      setReviewText(text);
      reviewCallbackRef.current = onSubmit;
    });
  }, []);

  const handleReviewSubmit = useCallback((text: string) => {
    if (reviewCallbackRef.current) {
      reviewCallbackRef.current(text);
    }
    setReviewText(null);
    reviewCallbackRef.current = null;
  }, []);

  const handleReviewCancel = useCallback(() => {
    setReviewText(null);
    reviewCallbackRef.current = null;
  }, []);

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
      case 'suggestions':
        return <SuggestionWidget />;
      default:
        return <PlaceholderWidget nodeId={node.id} widgetType={node.widgetType} />;
    }
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-100">
      {/* Header */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold text-slate-700">Bento Journal</h1>
          <PipelineBreadcrumb />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode((prev) => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              editMode
                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title={editMode ? 'Exit edit mode' : 'Enter edit mode to split, drag, and configure panels'}
          >
            <PencilRuler size={14} />
            {editMode ? 'Done' : 'Edit Layout'}
          </button>
          {editMode && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
              title="Reset layout to default"
            >
              <RotateCcw size={14} />
              Reset
            </button>
          )}
        </div>
      </header>

      {/* Bento Grid */}
      <main className="flex-1 overflow-hidden p-2">
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

      {/* Transcript Review Overlay */}
      {reviewText !== null && (
        <TranscriptReview
          initialText={reviewText}
          onSubmit={handleReviewSubmit}
          onCancel={handleReviewCancel}
        />
      )}
    </div>
  );
};
