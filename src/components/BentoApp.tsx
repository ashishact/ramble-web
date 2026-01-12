import React, { useState, useEffect, useCallback } from 'react';
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
import { RotateCcw } from 'lucide-react';

export const BentoApp: React.FC = () => {
  const [tree, setTree] = useState<BentoTree>(() => {
    const savedTree = loadTreeFromStorage();
    return savedTree ?? createInitialTree();
  });

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
      default:
        return <PlaceholderWidget nodeId={node.id} widgetType={node.widgetType} />;
    }
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-100">
      {/* Header */}
      <header className="h-12 bg-white border-b border-slate-200 flex items-center justify-between px-4 flex-shrink-0">
        <h1 className="text-sm font-bold text-slate-700">Bento Journal</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
            title="Reset layout to default"
          >
            <RotateCcw size={14} />
            Reset
          </button>
        </div>
      </header>

      {/* Bento Grid */}
      <main className="flex-1 overflow-hidden p-2">
        <BentoNodeComponent
          tree={tree}
          nodeId={tree.rootId}
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
    </div>
  );
};
