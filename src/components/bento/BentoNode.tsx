import React, { useRef } from 'react';
import type { BentoTree, LeafNode, SplitNode, WidgetType } from './types';
import { BentoLeaf } from './BentoLeaf';
import { Resizer } from './Resizer';

interface BentoNodeProps {
  tree: BentoTree;
  nodeId: string;
  editMode: boolean;
  onSplit: (id: string, direction: 'horizontal' | 'vertical', ratio?: number) => void;
  onRemove: (id: string) => void;
  onResize: (id: string, ratio: number) => void;
  onSwap: (id1: string, id2: string) => void;
  onColorChange: (id: string, color: string) => void;
  onContentChange: (id: string, content: string) => void;
  onWidgetChange: (id: string, widgetType: WidgetType) => void;
  renderWidget?: (node: LeafNode) => React.ReactNode;
}

export const BentoNodeComponent: React.FC<BentoNodeProps> = ({
  tree,
  nodeId,
  editMode,
  onSplit,
  onRemove,
  onResize,
  onSwap,
  onColorChange,
  onContentChange,
  onWidgetChange,
  renderWidget,
}) => {
  const node = tree.nodes[nodeId];
  const containerRef = useRef<HTMLDivElement>(null);
  
  if (!node) return null;

  // Leaf Node Rendering
  if (node.type === 'leaf') {
    return (
      <BentoLeaf
        node={node as LeafNode}
        editMode={editMode}
        onSplit={onSplit}
        onRemove={onRemove}
        onSwap={onSwap}
        onColorChange={onColorChange}
        onContentChange={onContentChange}
        onWidgetChange={onWidgetChange}
        renderWidget={renderWidget}
        isRoot={node.parent === null}
      />
    );
  }

  // Split Node Rendering
  const splitNode = node as SplitNode;
  const { direction, ratio, first, second } = splitNode;
  
  const handleResize = (delta: number) => {
    if (!containerRef.current) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    const size = direction === 'horizontal' ? rect.width : rect.height;
    
    // Calculate new ratio
    // Delta adds pixels to the first child's size
    const currentPixels = size * ratio;
    const newPixels = currentPixels + delta;
    const newRatio = newPixels / size;

    onResize(nodeId, newRatio);
  };

  const isHorizontal = direction === 'horizontal';

  return (
    <div 
      ref={containerRef}
      className={`w-full h-full flex ${isHorizontal ? 'flex-row' : 'flex-col'} overflow-hidden`}
    >
      {/* First Child */}
      <div style={{ flex: `${ratio} ${ratio} 0px` }} className="overflow-hidden min-w-0 min-h-0 relative">
        <BentoNodeComponent
          tree={tree}
          nodeId={first}
          editMode={editMode}
          onSplit={onSplit}
          onRemove={onRemove}
          onResize={onResize}
          onSwap={onSwap}
          onColorChange={onColorChange}
          onContentChange={onContentChange}
          onWidgetChange={onWidgetChange}
          renderWidget={renderWidget}
        />
      </div>

      {/* Resizer Handle */}
      <Resizer
        direction={direction}
        onResize={handleResize}
        onResizeEnd={() => { /* Optional: Snap to grid logic could go here */ }}
      />

      {/* Second Child */}
      <div style={{ flex: `${1 - ratio} ${1 - ratio} 0px` }} className="overflow-hidden min-w-0 min-h-0 relative">
        <BentoNodeComponent
          tree={tree}
          nodeId={second}
          editMode={editMode}
          onSplit={onSplit}
          onRemove={onRemove}
          onResize={onResize}
          onSwap={onSwap}
          onColorChange={onColorChange}
          onContentChange={onContentChange}
          onWidgetChange={onWidgetChange}
          renderWidget={renderWidget}
        />
      </div>
    </div>
  );
};