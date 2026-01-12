import React, { useState, useEffect } from 'react';
import { BentoNodeComponent } from './components/BentoNode';
import { BentoTree, Direction } from './types';
import { createInitialTree, splitNode, removeNode, updateNodeRatio, saveTreeToStorage, loadTreeFromStorage, swapNodes, updateNodeColor, updateNodeContent } from './utils';
import { Layout, RotateCcw } from 'lucide-react';

export default function App() {
  // Initialize state from storage, or fallback to default tree
  const [tree, setTree] = useState<BentoTree>(() => {
    const saved = loadTreeFromStorage();
    return saved || createInitialTree();
  });

  // Auto-save whenever the tree changes
  useEffect(() => {
    saveTreeToStorage(tree);
  }, [tree]);

  const handleSplit = (id: string, direction: Direction, ratio: number = 0.5) => {
    setTree((prev) => splitNode(prev, id, direction, ratio));
  };

  const handleRemove = (id: string) => {
    setTree((prev) => removeNode(prev, id));
  };

  const handleResize = (id: string, ratio: number) => {
    setTree((prev) => updateNodeRatio(prev, id, ratio));
  };

  const handleSwap = (id1: string, id2: string) => {
      setTree((prev) => swapNodes(prev, id1, id2));
  };

  const handleColorChange = (id: string, color: string) => {
      setTree((prev) => updateNodeColor(prev, id, color));
  };

  const handleContentChange = (id: string, content: string) => {
      setTree((prev) => updateNodeContent(prev, id, content));
  };

  const handleReset = () => {
      if(confirm('Are you sure you want to reset the layout to default? This cannot be undone.')) {
          const newTree = createInitialTree();
          setTree(newTree);
      }
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-50 text-slate-800 font-sans">
      {/* Header Bar */}
      <header className="h-12 border-b border-slate-200 flex items-center px-4 justify-between bg-white select-none shadow-sm z-10">
        <div className="flex items-center gap-3 text-slate-900 font-bold tracking-tight">
            <Layout className="text-blue-600" size={20} />
            Bento Builder
        </div>
        
        <div className="text-xs text-slate-500 hidden sm:block font-medium">
            Hover pane & press <span className="font-bold text-slate-700 bg-slate-100 px-1 rounded">H</span> or <span className="font-bold text-slate-700 bg-slate-100 px-1 rounded">V</span> to split. Drag header to swap.
        </div>

        <div className="flex items-center gap-2">
            <div className="text-[10px] text-slate-400 mr-2 font-mono uppercase tracking-wider">
               Auto-Saving
            </div>
            <div className="h-4 w-px bg-slate-200 mx-1"></div>
            <button 
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 text-slate-600 hover:text-red-600 px-3 py-1.5 rounded transition-all border border-slate-200 shadow-sm font-medium"
                title="Reset Layout"
            >
                <RotateCcw size={14} />
                <span className="hidden sm:inline">Reset</span>
            </button>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 overflow-hidden relative bg-slate-50 p-2">
        <div className="w-full h-full rounded-lg border border-slate-200 overflow-hidden shadow-sm bg-slate-100">
            <BentoNodeComponent 
                tree={tree} 
                nodeId={tree.rootId} 
                onSplit={handleSplit}
                onRemove={handleRemove}
                onResize={handleResize}
                onSwap={handleSwap}
                onColorChange={handleColorChange}
                onContentChange={handleContentChange}
            />
        </div>
      </main>
    </div>
  );
}