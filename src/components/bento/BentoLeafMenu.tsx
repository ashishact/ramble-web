import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { MoreVertical, Columns, Rows, Type, Palette, Trash2 } from 'lucide-react';

const COLORS = [
  'bg-white', 'bg-slate-50', 'bg-zinc-50', 'bg-stone-50', 'bg-neutral-50',
  'bg-red-50', 'bg-orange-50', 'bg-amber-50', 'bg-yellow-50', 'bg-lime-50',
  'bg-green-50', 'bg-emerald-50', 'bg-teal-50', 'bg-cyan-50', 'bg-sky-50',
  'bg-blue-50', 'bg-indigo-50', 'bg-violet-50', 'bg-purple-50', 'bg-fuchsia-50',
  'bg-pink-50', 'bg-rose-50', 'bg-slate-100', 'bg-blue-100', 'bg-emerald-100'
];

interface BentoLeafMenuProps {
  nodeId: string;
  nodeColor: string;
  isRoot: boolean;
  disabled: boolean;
  onSplit: (id: string, direction: 'horizontal' | 'vertical', ratio: number) => void;
  onColorChange: (id: string, color: string) => void;
  onRename: () => void;
  onDelete: () => void;
}

export const BentoLeafMenu: React.FC<BentoLeafMenuProps> = ({
  nodeId,
  nodeColor,
  isRoot,
  disabled,
  onSplit,
  onColorChange,
  onRename,
  onDelete,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Click outside handler
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Calculate dropdown position after it renders
  useLayoutEffect(() => {
    if (!isOpen || !dropdownRef.current || !buttonRef.current) {
      if (!isOpen) setMenuPosition(null);
      return;
    }

    const buttonRect = buttonRef.current.getBoundingClientRect();
    const dropdownRect = dropdownRef.current.getBoundingClientRect();
    const menuHeight = dropdownRect.height;
    const menuWidth = dropdownRect.width;

    const spaceBelow = window.innerHeight - buttonRect.bottom;
    const spaceRight = window.innerWidth - buttonRect.right;

    // Position above if not enough space below
    const top = spaceBelow < menuHeight + 10
      ? buttonRect.top - menuHeight - 4
      : buttonRect.bottom + 4;

    // Position to the left if not enough space on right
    const left = spaceRight < menuWidth
      ? buttonRect.left - menuWidth + buttonRect.width
      : buttonRect.right - menuWidth;

    setMenuPosition({ top, left });
  }, [isOpen]);

  if (disabled) return null;

  const handleAction = (action: () => void) => {
    action();
    setIsOpen(false);
  };

  return (
    <div className="flex items-center" ref={containerRef}>
      <button
        ref={buttonRef}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        className={`p-1 rounded hover:bg-black/5 text-slate-400 hover:text-slate-700 transition-colors ${
          isOpen ? 'text-slate-900 bg-black/10 shadow-inner' : ''
        }`}
      >
        <MoreVertical size={14} />
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          className="fixed z-[9999] flex flex-col gap-1 p-1 bg-white border border-slate-200 rounded-lg shadow-xl animate-in fade-in zoom-in duration-200 min-w-[150px]"
          style={menuPosition ? { top: menuPosition.top, left: menuPosition.left } : { visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleAction(() => onSplit(nodeId, 'horizontal', 0.5))}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 rounded text-left whitespace-nowrap text-slate-700 font-medium"
          >
            <Columns size={14} className="text-blue-500" /> Split Horz{' '}
            <span className="text-[10px] bg-slate-100 px-1 rounded ml-auto text-slate-400 font-mono">H</span>
          </button>
          <button
            onClick={() => handleAction(() => onSplit(nodeId, 'vertical', 0.5))}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 rounded text-left whitespace-nowrap text-slate-700 font-medium"
          >
            <Rows size={14} className="text-blue-500" /> Split Vert{' '}
            <span className="text-[10px] bg-slate-100 px-1 rounded ml-auto text-slate-400 font-mono">V</span>
          </button>

          <button
            onClick={() => handleAction(onRename)}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-slate-50 rounded text-left whitespace-nowrap border-t border-slate-100 mt-1 pt-2 text-slate-700 font-medium"
          >
            <Type size={14} className="text-slate-400" /> Rename Pane
          </button>

          <div className="pt-2 mt-1 border-t border-slate-100">
            <div className="text-[10px] text-slate-400 font-bold px-2.5 mb-1.5 uppercase tracking-wider flex items-center gap-1">
              <Palette size={10} /> Background
            </div>
            <div className="grid grid-cols-5 gap-1.5 px-2.5 pb-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-4 h-4 rounded-full ${c} border border-slate-200 hover:scale-125 transition-all ${
                    nodeColor === c ? 'ring-2 ring-blue-500 ring-offset-1 border-transparent' : ''
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onColorChange(nodeId, c);
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
                handleAction(onDelete);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-red-50 text-red-600 rounded text-left whitespace-nowrap border-t border-slate-100 mt-1 pt-2 font-bold"
            >
              <Trash2 size={14} /> Close Pane
            </button>
          )}
        </div>
      )}
    </div>
  );
};
