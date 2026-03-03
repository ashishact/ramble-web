/**
 * WorkspaceHUD — OS-style workspace switcher overlay.
 *
 * Appears at center-screen when switching workspaces via keyboard shortcuts
 * (Ctrl+[ / Ctrl+] / Ctrl+1–9). Shows all workspaces as a horizontal strip
 * with the active one highlighted. Auto-fades after the last keypress.
 *
 * Handles large workspace counts by capping width to 90vw and auto-scrolling
 * the active item into view.
 */

import React, { useRef, useEffect } from 'react';
import { Icon } from '@iconify/react';
import type { Workspace } from '../stores/workspaceStore';

interface WorkspaceHUDProps {
  workspaces: Workspace[];   // sorted by order
  activeId: string;
  visible: boolean;
  onSwitch: (id: string) => void;
}

export const WorkspaceHUD: React.FC<WorkspaceHUDProps> = ({ workspaces, activeId, visible, onSwitch }) => {
  const activeRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll the active item into view when it changes
  useEffect(() => {
    if (visible && activeRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const item = activeRef.current;
      // Center the active item within the scrollable container
      const scrollLeft = item.offsetLeft - container.clientWidth / 2 + item.offsetWidth / 2;
      container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
    }
  }, [activeId, visible]);

  return (
    <div
      className={`fixed inset-0 z-40 flex items-center justify-center ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: 'opacity 200ms ease-out',
      }}
      onContextMenu={e => e.preventDefault()}
    >
      <div
        ref={scrollRef}
        className="bg-base-300/90 backdrop-blur-md rounded-3xl shadow-2xl px-6 py-5 flex items-center gap-2 max-w-[90vw] overflow-x-auto"
        style={{ scrollbarWidth: 'none' }}
      >
        {workspaces.map((ws, i) => {
          const isActive = ws.id === activeId;
          return (
            <div
              key={ws.id}
              ref={isActive ? activeRef : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                // On Mac, Ctrl+Click = right-click so `onClick` never fires.
                // We use mouseDown instead. The subsequent contextmenu event
                // would leak through because hideHUD() sets pointer-events-none
                // before it fires. Suppress it once at capture phase — safe
                // because contextmenu fires synchronously in the same gesture.
                const suppress = (ev: Event) => ev.preventDefault();
                window.addEventListener('contextmenu', suppress, { once: true, capture: true });
                // Safety: remove if contextmenu never fires (e.g. non-Mac)
                setTimeout(() => window.removeEventListener('contextmenu', suppress, { capture: true }), 100);
                onSwitch(ws.id);
              }}
              className={`flex flex-col items-center gap-1.5 px-4 py-3 rounded-2xl transition-all duration-200 flex-shrink-0 cursor-pointer ${
                isActive
                  ? 'bg-primary/20 text-primary scale-110'
                  : 'text-base-content/50 hover:text-base-content/80 hover:bg-base-content/5 hover:scale-105'
              }`}
              style={{ minWidth: 88, maxWidth: 120 }}
            >
              <div className="w-10 h-10 flex items-center justify-center">
                {ws.icon ? (
                  <Icon icon={ws.icon} width={32} height={32} />
                ) : (
                  <span className="text-2xl font-bold leading-none">{i + 1}</span>
                )}
              </div>
              <span
                className={`text-xs leading-tight truncate max-w-[80px] ${
                  isActive ? 'font-semibold' : 'font-normal'
                }`}
              >
                {ws.name}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
