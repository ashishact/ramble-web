import React, { useState, useEffect, useRef } from 'react';
import type { LeafNode, WidgetType } from './types';
import {
  MoreVertical, Trash2, Columns, Rows, GripHorizontal, AlertTriangle, X, Check, Palette, Type,
  Mic, MessageSquare, Users, Hash, Brain, Target, BarChart3, Settings, Eye, PenTool, Lightbulb
} from 'lucide-react';

interface BentoLeafProps {
  node: LeafNode;
  editMode: boolean;
  onSplit: (id: string, direction: 'horizontal' | 'vertical', ratio?: number) => void;
  onRemove: (id: string) => void;
  onSwap: (id1: string, id2: string) => void;
  onColorChange: (id: string, color: string) => void;
  onContentChange: (id: string, content: string) => void;
  onWidgetChange: (id: string, widgetType: WidgetType) => void;
  renderWidget?: (node: LeafNode) => React.ReactNode;
  isRoot: boolean;
}

const COLORS = [
  'bg-white', 'bg-slate-50', 'bg-zinc-50', 'bg-stone-50', 'bg-neutral-50',
  'bg-red-50', 'bg-orange-50', 'bg-amber-50', 'bg-yellow-50', 'bg-lime-50',
  'bg-green-50', 'bg-emerald-50', 'bg-teal-50', 'bg-cyan-50', 'bg-sky-50',
  'bg-blue-50', 'bg-indigo-50', 'bg-violet-50', 'bg-purple-50', 'bg-fuchsia-50', 
  'bg-pink-50', 'bg-rose-50', 'bg-slate-100', 'bg-blue-100', 'bg-emerald-100'
];

const WIDGET_OPTIONS: { type: WidgetType; label: string; icon: React.ReactNode }[] = [
    { type: 'voice-recorder', label: 'Voice', icon: <Mic size={18} /> },
    { type: 'text-input', label: 'Text Input', icon: <PenTool size={18} /> },
    { type: 'conversation', label: 'Conversation', icon: <MessageSquare size={18} /> },
    { type: 'entities', label: 'Entities', icon: <Users size={18} /> },
    { type: 'topics', label: 'Topics', icon: <Hash size={18} /> },
    { type: 'memories', label: 'Memories', icon: <Brain size={18} /> },
    { type: 'goals', label: 'Goals', icon: <Target size={18} /> },
    { type: 'stats', label: 'Stats', icon: <BarChart3 size={18} /> },
    { type: 'suggestions', label: 'Suggestions', icon: <Lightbulb size={18} /> },
    { type: 'settings', label: 'Settings', icon: <Settings size={18} /> },
    { type: 'working-memory', label: 'Context', icon: <Eye size={18} /> },
];

export const BentoLeaf: React.FC<BentoLeafProps> = ({ node, editMode, onSplit, onRemove, onSwap, onColorChange, onContentChange, onWidgetChange, renderWidget, isRoot }) => {
  const [showControls, setShowControls] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [pendingSplit, setPendingSplit] = useState<'horizontal' | 'vertical' | null>(null);
  
  const splitRatioRef = useRef(0.5);
  const dividerRef = useRef<HTMLDivElement>(null);
  const badgeTextRef = useRef<HTMLDivElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const [isDragOver, setIsDragOver] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isSetupMode = node.widgetType === 'empty';

  // Robust click outside handler
  useEffect(() => {
    if (!showControls) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setShowControls(false);
      }
    };

    // Use capture phase or wait a tick to prevent the opening click from triggering this
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showControls]);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
        renameInputRef.current.focus();
        renameInputRef.current.select();
    }
  }, [isRenaming]);

  useEffect(() => {
    if (!pendingSplit) {
        splitRatioRef.current = 0.5;
    }
  }, [pendingSplit]);

  useEffect(() => {
    // Only enable keyboard shortcuts in edit mode
    if (!editMode) return;
    if (!isHovered && !pendingSplit) return;

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        if (e.key === 'Escape') {
            setPendingSplit(null);
            setShowControls(false);
            setShowDeleteConfirm(false);
            setIsRenaming(false);
            return;
        }

        if (showControls || showDeleteConfirm || isRenaming || isSetupMode) return;
        if (pendingSplit) return;

        if (e.key.toLowerCase() === 'h') {
            setPendingSplit('horizontal');
            splitRatioRef.current = 0.5;
        } else if (e.key.toLowerCase() === 'v') {
            setPendingSplit('vertical');
            splitRatioRef.current = 0.5;
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editMode, isHovered, pendingSplit, showControls, showDeleteConfirm, isRenaming, isSetupMode]);

  const handleMouseMoveSplit = (e: React.MouseEvent) => {
      if (!pendingSplit) return;
      const rect = e.currentTarget.getBoundingClientRect();
      let ratio = 0.5;
      
      if (pendingSplit === 'horizontal') {
          const x = e.clientX - rect.left;
          ratio = x / rect.width;
      } else {
          const y = e.clientY - rect.top;
          ratio = y / rect.height;
      }

      if (e.altKey) ratio = Math.round(ratio * 20) / 20;
      const clamped = Math.max(0.05, Math.min(0.95, ratio));
      splitRatioRef.current = clamped;

      if (dividerRef.current) {
        if (pendingSplit === 'horizontal') {
            dividerRef.current.style.left = `${clamped * 100}%`;
        } else {
            dividerRef.current.style.top = `${clamped * 100}%`;
        }
      }

      if (badgeTextRef.current) {
          badgeTextRef.current.textContent = `${(clamped * 100).toFixed(0)}%`;
      }
  };

  const handleConfirmSplit = (e: React.MouseEvent) => {
      if (pendingSplit) {
          e.stopPropagation();
          onSplit(node.id, pendingSplit, splitRatioRef.current);
          setPendingSplit(null);
      }
  };

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/bento-node-id', node.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); 
    e.dataTransfer.dropEffect = 'move';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const draggedId = e.dataTransfer.getData('application/bento-node-id');
    if (draggedId && draggedId !== node.id) {
        onSwap(draggedId, node.id);
    }
  };

  const handleRenameSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (renameInputRef.current) {
          onContentChange(node.id, renameInputRef.current.value || 'New Section');
          setIsRenaming(false);
      }
  }

  return (
    <div
      className={`relative w-full h-full flex flex-col overflow-hidden ${node.color} text-slate-800 border border-slate-200/50 group transition-all duration-200
      ${editMode && isHovered && !isDragOver ? 'ring-1 ring-inset ring-blue-500/20 shadow-inner' : ''}
      `}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDragOver={editMode ? handleDragOver : undefined}
      onDragLeave={editMode ? handleDragLeave : undefined}
      onDrop={editMode ? handleDrop : undefined}
    >
      {/* Drop Zone Visual Overlay (edit mode only) */}
      {editMode && isDragOver && (
          <div className="absolute inset-1.5 z-40 border-2 border-dashed border-blue-500 bg-blue-500/5 rounded-lg pointer-events-none animate-in fade-in duration-150" />
      )}

      {/* Delete Confirmation Overlay */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/95 backdrop-blur-sm animate-in fade-in zoom-in duration-200 p-4 text-center cursor-default shadow-lg" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 bg-red-100 rounded-full mb-3">
                <AlertTriangle size={24} className="text-red-500" />
            </div>
            <h4 className="text-slate-900 font-bold mb-1">Close this section?</h4>
            <p className="text-xs text-slate-500 mb-4 max-w-[200px]">Space will be merged with neighbor.</p>
            <div className="flex gap-2">
                <button 
                    onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(false); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded text-xs transition-colors text-slate-700 font-medium"
                >
                    <X size={14} /> Cancel
                </button>
                <button 
                    onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors shadow-sm font-bold"
                >
                    <Check size={14} /> Confirm
                </button>
            </div>
        </div>
      )}

      {/* Visualization Overlay for Pending Split (edit mode only) */}
      {editMode && pendingSplit && !showDeleteConfirm && (
          <div 
             className="absolute inset-0 z-20 bg-blue-500/5 cursor-crosshair animate-in fade-in duration-150 select-none"
             onMouseMove={handleMouseMoveSplit}
             onClick={handleConfirmSplit}
          >
             <div 
                ref={dividerRef}
                className={`absolute bg-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.3)] pointer-events-none
                    ${pendingSplit === 'horizontal' ? 'w-0.5 top-0 bottom-0 border-x border-dashed border-blue-300' : 'h-0.5 left-0 right-0 border-y border-dashed border-blue-300'}
                `}
                style={{
                    left: pendingSplit === 'horizontal' ? '50%' : undefined,
                    top: pendingSplit === 'vertical' ? '50%' : undefined
                }}
             />
             
             <div className="absolute top-4 right-4 z-30 pointer-events-none flex flex-col items-end gap-1">
                 <div ref={badgeTextRef} className="bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full font-bold shadow-md border border-blue-400 text-center min-w-[3rem]">
                    50%
                 </div>
                 <div className="text-[10px] text-blue-700 font-bold bg-white/90 px-2 py-1 rounded text-right backdrop-blur-sm border border-blue-100 shadow-sm">
                    Click to Confirm<br/>
                    <span className="opacity-75 font-medium">Alt to Snap</span>
                 </div>
             </div>
          </div>
      )}

      {/* --- PANEL HEADER (edit mode only) --- */}
      {editMode && (
      <div
        className="h-8 min-h-[32px] w-full bg-slate-100/60 border-b border-black/5 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing select-none group/header hover:bg-slate-200/40 transition-colors"
        draggable={!isRenaming}
        onDragStart={handleDragStart}
        onDoubleClick={() => !isSetupMode && setIsRenaming(true)}
      >
        <div className="flex items-center gap-2 overflow-hidden">
            <GripHorizontal size={14} className="text-slate-400 group-hover/header:text-slate-600 transition-colors" />
            {isRenaming ? (
                 <form onSubmit={handleRenameSubmit} className="inline-block flex-1 min-w-0">
                    <input 
                        ref={renameInputRef}
                        defaultValue={node.content} 
                        className="bg-white border border-blue-500 text-xs text-slate-900 focus:outline-none w-full min-w-[50px] font-bold px-1 rounded shadow-sm"
                        onBlur={() => setIsRenaming(false)}
                        onKeyDown={(e) => { e.stopPropagation(); }}
                    />
                 </form>
            ) : (
                <span className="text-xs font-bold text-slate-600 truncate group-hover/header:text-slate-900 transition-colors">
                    {node.content}
                </span>
            )}
        </div>

        <div className="flex items-center" ref={menuContainerRef}>
             {!showDeleteConfirm && !isSetupMode && !pendingSplit && (
                <button 
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowControls((prev) => !prev);
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    className={`p-1 rounded hover:bg-black/5 text-slate-400 hover:text-slate-700 transition-colors ${showControls ? 'text-slate-900 bg-black/10 shadow-inner' : ''}`}
                >
                    <MoreVertical size={14} />
                </button>
             )}

            {/* Controls Dropdown - Nested inside the container for ref check */}
            {showControls && !showDeleteConfirm && (
                <div 
                    className="absolute top-9 right-2 z-[60] flex flex-col gap-1 p-1 bg-white border border-slate-200 rounded-lg shadow-xl animate-in fade-in zoom-in duration-200 min-w-[150px]"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button 
                        onClick={() => { onSplit(node.id, 'horizontal', 0.5); setShowControls(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 rounded text-left whitespace-nowrap text-slate-700 font-medium"
                    >
                    <Columns size={14} className="text-blue-500" /> Split Horz <span className="text-[10px] bg-slate-100 px-1 rounded ml-auto text-slate-400 font-mono">H</span>
                    </button>
                    <button 
                        onClick={() => { onSplit(node.id, 'vertical', 0.5); setShowControls(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 rounded text-left whitespace-nowrap text-slate-700 font-medium"
                    >
                    <Rows size={14} className="text-blue-500" /> Split Vert <span className="text-[10px] bg-slate-100 px-1 rounded ml-auto text-slate-400 font-mono">V</span>
                    </button>
                    
                    <button 
                        onClick={() => { setIsRenaming(true); setShowControls(false); }}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 rounded text-left whitespace-nowrap border-t border-slate-100 mt-1 pt-2 text-slate-700 font-medium"
                    >
                    <Type size={14} className="text-slate-400" /> Rename Pane
                    </button>

                    <div className="pt-2 mt-1 border-t border-slate-100">
                    <div className="text-[10px] text-slate-400 font-bold px-2.5 mb-1.5 uppercase tracking-wider flex items-center gap-1">
                        <Palette size={10} /> Background
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 px-2.5 pb-2">
                        {COLORS.map(c => (
                        <button
                            key={c}
                            className={`w-4 h-4 rounded-full ${c} border border-slate-200 hover:scale-125 transition-all ${node.color === c ? 'ring-2 ring-blue-500 ring-offset-1 border-transparent' : ''}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onColorChange(node.id, c);
                            }}
                            title={c.replace('bg-', '')}
                        />
                        ))}
                    </div>
                    </div>

                    {!isRoot && (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowControls(false);
                            setShowDeleteConfirm(true);
                        }}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-red-50 text-red-600 rounded text-left whitespace-nowrap border-t border-slate-100 mt-1 pt-2 font-bold"
                        >
                        <Trash2 size={14} /> Close Pane
                    </button>
                    )}
                </div>
            )}
        </div>
      </div>
      )}

      {/* --- PANEL BODY --- */}
      <div className="@container flex-1 w-full relative overflow-auto">
        {isSetupMode ? (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-white/40 overflow-auto">
                <div className="mb-5 text-center">
                    <h3 className="text-sm font-bold text-slate-700 mb-1">Select Widget</h3>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-widest">Choose what to display</p>
                </div>

                <div className="grid grid-cols-3 @sm:grid-cols-5 gap-2.5 mb-5 w-full max-w-[400px]">
                    {WIDGET_OPTIONS.map((widget) => (
                        <button
                            key={widget.type}
                            onClick={() => {
                                onWidgetChange(node.id, widget.type);
                                onContentChange(node.id, widget.label);
                            }}
                            className="flex flex-col items-center justify-center gap-2 p-3 rounded-xl bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 transition-all group/btn shadow-sm hover:shadow-md"
                        >
                            <div className="text-slate-400 group-hover/btn:text-blue-600 transition-colors">{widget.icon}</div>
                            <span className="text-[10px] text-slate-600 font-bold group-hover/btn:text-blue-700">{widget.label}</span>
                        </button>
                    ))}
                </div>

                {!isRoot && (
                    <button
                        onClick={() => onRemove(node.id)}
                        className="text-[10px] text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1 font-bold"
                    >
                        <X size={10} /> Close empty pane
                    </button>
                )}
            </div>
        ) : renderWidget ? (
            <div className="w-full h-full">
                {renderWidget(node)}
            </div>
        ) : (
            <div className="w-full h-full p-3 relative">
                 <div className="w-full h-full rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 flex items-center justify-center">
                    <div className="text-center opacity-30 group-hover:opacity-50 transition-opacity select-none">
                        <GripHorizontal size={40} className="mx-auto mb-2 text-slate-400" />
                        <span className="text-xs font-mono font-bold uppercase tracking-widest text-slate-600">{node.content}</span>
                    </div>
                 </div>
                 <p className="absolute bottom-4 right-5 text-[10px] text-slate-300 font-mono font-bold">NODE_REF: {node.id.substring(0,4).toUpperCase()}</p>
            </div>
        )}
      </div>
      
      {editMode && isRoot && !pendingSplit && !showDeleteConfirm && !isSetupMode && (
        <div className="absolute bottom-6 left-0 right-0 text-center text-slate-400 text-xs pointer-events-none opacity-60 z-20 font-medium">
           Press <span className="text-slate-900 font-bold bg-white shadow-sm border border-slate-200 px-1.5 rounded mx-0.5">H</span> or <span className="text-slate-900 font-bold bg-white shadow-sm border border-slate-200 px-1.5 rounded mx-0.5">V</span> to start splitting
        </div>
      )}
    </div>
  );
};