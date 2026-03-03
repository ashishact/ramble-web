/**
 * WorkspaceSwitcher — Header dropdown for managing workspace layouts.
 *
 * Compact button in the header showing current workspace name with a
 * dropdown for switching, creating, and editing workspaces.
 * Editing opens a fixed-position modal (avoids dropdown overflow clipping).
 */

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import {
  LayoutGrid,
  ChevronDown,
  Check,
  Plus,
  Pencil,
  Trash2,
  RotateCcw,
  Copy,
  Search,
  X,
} from 'lucide-react';
import { Icon } from '@iconify/react';
import { useShortcut } from '../hooks/useShortcut';
import { workspaceStore } from '../stores/workspaceStore';
import { BUILT_IN_TEMPLATES } from '../stores/workspaceTemplates';
import { DAISYUI_THEMES, ThemeSwatch } from './v2/ThemeSelector';
import { WorkspaceHUD } from './WorkspaceHUD';
import type { Workspace } from '../stores/workspaceStore';

/** Apply a workspace's theme, or fall back to the global setting. */
const applyWorkspaceTheme = (ws: Workspace) => {
  if (ws.theme) {
    document.documentElement.setAttribute('data-theme', ws.theme);
  } else {
    const globalTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', globalTheme);
  }
};

// ---------------------------------------------------------------------------
// Sub-views
// ---------------------------------------------------------------------------

type View = 'list' | 'create';

interface CreateViewProps {
  onCreated: (ws: Workspace) => void;
  onCancel: () => void;
}

const CreateView: React.FC<CreateViewProps> = ({ onCreated, onCancel }) => {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = (templateId: string | null) => {
    const trimmed = name.trim() || (templateId ? BUILT_IN_TEMPLATES.find(t => t.id === templateId)?.name ?? 'Workspace' : 'Workspace');
    const ws = templateId
      ? workspaceStore.createFromTemplate(templateId, trimmed)
      : workspaceStore.create(trimmed);
    onCreated(ws);
  };

  return (
    <div className="p-2 space-y-2">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Workspace name..."
          className="flex-1 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          onKeyDown={e => {
            if (e.key === 'Escape') onCancel();
          }}
        />
        <button
          onClick={onCancel}
          className="p-1 text-slate-400 hover:text-slate-600 rounded"
        >
          <X size={12} />
        </button>
      </div>

      <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide px-1">
        From template
      </div>
      <div className="grid grid-cols-2 gap-1">
        {BUILT_IN_TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => handleCreate(t.id)}
            className="px-2 py-1.5 text-xs text-left rounded border border-slate-150 hover:bg-blue-50 hover:border-blue-200 transition-colors"
          >
            <div className="font-medium text-slate-700">{t.name}</div>
            <div className="text-[10px] text-slate-400 leading-tight">{t.description}</div>
          </button>
        ))}
      </div>

      <button
        onClick={() => handleCreate(null)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded transition-colors"
      >
        <Copy size={11} />
        Clone current layout
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Edit modal
// ---------------------------------------------------------------------------

interface EditModalProps {
  ws: Workspace;
  isLast: boolean;
  onSave: (id: string, fields: { name: string; description?: string; icon?: string; theme?: string }) => void;
  onReset: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const EditModal: React.FC<EditModalProps> = ({ ws, isLast, onSave, onReset, onDelete, onClose }) => {
  const [name, setName] = useState(ws.name);
  const [description, setDescription] = useState(ws.description ?? '');
  const [icon, setIcon] = useState(ws.icon ?? '');
  const [theme, setTheme] = useState(ws.theme ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => {
      nameRef.current?.focus();
      nameRef.current?.select();
    }, 0);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(ws.id, {
      name: trimmed,
      description: description.trim() || undefined,
      icon: icon.trim() || undefined,
      theme: theme || undefined,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl border border-slate-200 w-80 p-4 space-y-3">
        <div className="text-sm font-medium text-slate-700">Edit workspace</div>

        {/* Icon */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Icon</label>
            <a
              href="https://icon-sets.iconify.design"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-600 transition-colors"
            >
              Browse
            </a>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={icon}
              onChange={e => setIcon(e.target.value)}
              placeholder="e.g. mdi:home"
              className="flex-1 px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
              onKeyDown={handleKeyDown}
            />
            <div className="w-7 h-7 flex items-center justify-center rounded border border-slate-200 bg-slate-50">
              {icon.trim() ? (
                <Icon icon={icon.trim()} width={16} height={16} className="text-slate-600" />
              ) : (
                <LayoutGrid size={14} className="text-slate-300" />
              )}
            </div>
          </div>
        </div>

        {/* Name */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Name</label>
          <input
            ref={nameRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Description</label>
          <input
            type="text"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Optional description..."
            className="w-full px-2 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
            onKeyDown={handleKeyDown}
          />
        </div>

        {/* Theme */}
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-400 uppercase tracking-wide">Theme</label>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-base-300 bg-base-200/50 p-1">
            {/* None option */}
            <button
              onClick={() => setTheme('')}
              className={`w-full flex items-center gap-2 px-2 py-1 text-xs text-left transition-colors rounded ${
                theme === '' ? 'bg-primary/15 font-medium text-primary outline outline-1 outline-primary/30' : 'hover:bg-base-200 text-base-content/70'
              }`}
            >
              <span className="text-slate-400 italic flex-1">None (use global)</span>
              {theme === '' && <Check size={11} className="flex-shrink-0 text-primary" />}
            </button>
            {DAISYUI_THEMES.map(t => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`w-full flex items-center gap-2 px-2 py-1 text-xs text-left transition-colors rounded ${
                  theme === t ? 'bg-primary/15 font-medium text-primary outline outline-1 outline-primary/30' : 'hover:bg-base-200 text-base-content/70'
                }`}
              >
                <ThemeSwatch theme={t} />
                <span className="capitalize flex-1">{t}</span>
                {theme === t && <Check size={11} className="flex-shrink-0 text-primary" />}
              </button>
            ))}
          </div>
        </div>

        {/* Actions footer */}
        <div className="flex items-center justify-between pt-1 border-t border-slate-100">
          <div className="flex items-center gap-1">
            {ws.templateId && (
              <button
                onClick={() => { onReset(ws.id); onClose(); }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 rounded transition-colors"
              >
                <RotateCcw size={11} /> Reset
              </button>
            )}
            {!isLast && (
              <button
                onClick={() => { onDelete(ws.id); onClose(); }}
                className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-500 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className="px-2 py-1 text-[11px] text-slate-500 hover:bg-slate-50 rounded transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="px-3 py-1 text-[11px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Workspace list item
// ---------------------------------------------------------------------------

interface WorkspaceItemProps {
  ws: Workspace;
  isActive: boolean;
  onSwitch: (id: string) => void;
  onEdit: (ws: Workspace) => void;
}

const WorkspaceItem: React.FC<WorkspaceItemProps> = ({ ws, isActive, onSwitch, onEdit }) => {
  return (
    <div className="group relative flex items-center">
      <button
        onClick={() => onSwitch(ws.id)}
        className={`flex-1 flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors text-left ${
          isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-slate-700 hover:bg-slate-50'
        }`}
      >
        {ws.icon ? (
          <Icon icon={ws.icon} width={13} height={13} className="flex-shrink-0" />
        ) : isActive ? (
          <Check size={11} className="flex-shrink-0" />
        ) : (
          <span className="w-[13px] flex-shrink-0" />
        )}
        <span className="truncate">{ws.name}</span>
      </button>

      {/* Edit button — opens modal */}
      <button
        onClick={e => { e.stopPropagation(); onEdit(ws); }}
        className="absolute right-1 p-1 rounded text-slate-300 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <Pencil size={10} />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface WorkspaceSwitcherProps {
  onTreeChange: (tree: import('../components/bento/types').BentoTree) => void;
}

export const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({ onTreeChange }) => {
  const state = useSyncExternalStore(workspaceStore.subscribe, workspaceStore.getState);
  const active = workspaceStore.getActive();

  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState<View>('list');
  const [search, setSearch] = useState('');
  const [editingWs, setEditingWs] = useState<Workspace | null>(null);
  const [hudVisible, setHudVisible] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Apply active workspace theme on mount (and when active workspace changes)
  useEffect(() => {
    applyWorkspaceTheme(active);
  }, [active.id, active.theme]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Focus search on open
  useEffect(() => {
    if (isOpen && view === 'list') {
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen, view]);

  // Keyboard handler
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  const close = useCallback(() => {
    setIsOpen(false);
    setView('list');
    setSearch('');
  }, []);

  /** Core switch logic — single source of truth for workspace transitions. */
  const performSwitch = useCallback((id: string) => {
    if (id === state.activeId) return;
    const tree = workspaceStore.switchTo(id);
    onTreeChange(tree);
    applyWorkspaceTheme(workspaceStore.getActive());
  }, [state.activeId, onTreeChange]);

  const handleSwitch = useCallback((id: string) => {
    performSwitch(id);
    close();
  }, [performSwitch, close]);

  const handleDelete = useCallback((id: string) => {
    const wasActive = id === state.activeId;
    const deleted = workspaceStore.delete(id);
    if (deleted && wasActive) {
      onTreeChange(workspaceStore.getActiveTree());
    }
  }, [state.activeId, onTreeChange]);

  const handleReset = useCallback((id: string) => {
    const tree = workspaceStore.resetToDefault(id);
    if (tree && id === state.activeId) {
      onTreeChange(tree);
    }
  }, [state.activeId, onTreeChange]);

  const handleEditSave = useCallback((id: string, fields: { name: string; description?: string; icon?: string; theme?: string }) => {
    workspaceStore.update(id, fields);
    // If editing the active workspace, apply the theme change immediately
    if (id === state.activeId) {
      const ws = workspaceStore.getActive();
      applyWorkspaceTheme(ws);
    }
    setEditingWs(null);
  }, [state.activeId]);

  const handleCreated = useCallback((ws: Workspace) => {
    onTreeChange(workspaceStore.getActiveTree());
    close();
    // Open edit modal so the user can set icon / description right away
    setEditingWs(ws);
  }, [onTreeChange, close]);

  // Sort workspaces by order
  const sorted = [...state.workspaces].sort((a, b) => a.order - b.order);
  const filtered = search
    ? sorted.filter(w => w.name.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts — Ctrl+[ / Ctrl+] to cycle, Ctrl+1–9 to jump
  // ---------------------------------------------------------------------------

  const ctrlHeldRef = useRef(false);

  const hideHUD = useCallback(() => {
    setHudVisible(false);
    ctrlHeldRef.current = false;
  }, []);

  const handleHUDSwitch = useCallback((id: string) => {
    performSwitch(id);
    hideHUD();
  }, [performSwitch, hideHUD]);

  const showHUD = useCallback(() => {
    setHudVisible(true);
    ctrlHeldRef.current = true;
  }, []);

  // Listen for Ctrl release to dismiss the HUD
  useEffect(() => {
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && ctrlHeldRef.current) {
        hideHUD();
      }
    };
    // Fallback: if the window loses focus while Ctrl is held (e.g. Alt+Tab away)
    const onBlur = () => {
      if (ctrlHeldRef.current) hideHUD();
    };
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [hideHUD]);

  const switchByOffset = useCallback((offset: number) => {
    const idx = sorted.findIndex(w => w.id === state.activeId);
    const next = (idx + offset + sorted.length) % sorted.length;
    if (sorted[next]) performSwitch(sorted[next].id);
    showHUD();
  }, [sorted, state.activeId, performSwitch, showHUD]);

  const switchToIndex = useCallback((index: number) => {
    if (sorted[index]) performSwitch(sorted[index].id);
    showHUD();
  }, [sorted, performSwitch, showHUD]);

  useShortcut('workspace-prev', { key: '[', ctrl: true }, () => switchByOffset(-1), 'Previous workspace');
  useShortcut('workspace-next', { key: ']', ctrl: true }, () => switchByOffset(1), 'Next workspace');
  useShortcut('workspace-1', { key: '1', ctrl: true }, () => switchToIndex(0), 'Switch to workspace 1');
  useShortcut('workspace-2', { key: '2', ctrl: true }, () => switchToIndex(1), 'Switch to workspace 2');
  useShortcut('workspace-3', { key: '3', ctrl: true }, () => switchToIndex(2), 'Switch to workspace 3');
  useShortcut('workspace-4', { key: '4', ctrl: true }, () => switchToIndex(3), 'Switch to workspace 4');
  useShortcut('workspace-5', { key: '5', ctrl: true }, () => switchToIndex(4), 'Switch to workspace 5');
  useShortcut('workspace-6', { key: '6', ctrl: true }, () => switchToIndex(5), 'Switch to workspace 6');
  useShortcut('workspace-7', { key: '7', ctrl: true }, () => switchToIndex(6), 'Switch to workspace 7');
  useShortcut('workspace-8', { key: '8', ctrl: true }, () => switchToIndex(7), 'Switch to workspace 8');
  useShortcut('workspace-9', { key: '9', ctrl: true }, () => switchToIndex(8), 'Switch to workspace 9');

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className={`flex items-center gap-1 px-1.5 py-0.5 text-xs rounded transition-colors max-w-[140px] ${
          isOpen
            ? 'bg-blue-100 text-blue-700'
            : 'bg-slate-200/70 text-slate-500 hover:text-slate-700 hover:bg-slate-200'
        }`}
        title={`Workspace: ${active.name}`}
      >
        {active.icon ? (
          <Icon icon={active.icon} width={11} height={11} className="flex-shrink-0" />
        ) : (
          <LayoutGrid size={11} className="flex-shrink-0" />
        )}
        <span className="truncate">{active.name}</span>
        <ChevronDown size={10} className={`flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 mt-1 z-[9999] w-64 bg-white border border-slate-200 rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-150">
          {view === 'list' && (
            <>
              {/* Search */}
              <div className="p-1.5 border-b border-slate-100">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-slate-50 rounded border border-slate-150">
                  <Search size={11} className="text-slate-400 flex-shrink-0" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search workspaces..."
                    className="flex-1 text-xs bg-transparent outline-none placeholder:text-slate-300"
                  />
                </div>
              </div>

              {/* Workspace list */}
              <div className="max-h-64 overflow-y-auto p-1">
                {filtered.length === 0 && (
                  <div className="px-2 py-3 text-xs text-slate-400 text-center">
                    No workspaces found
                  </div>
                )}
                {filtered.map(ws => (
                  <WorkspaceItem
                    key={ws.id}
                    ws={ws}
                    isActive={ws.id === state.activeId}
                    onSwitch={handleSwitch}
                    onEdit={setEditingWs}
                  />
                ))}
              </div>

              {/* Create button */}
              <div className="border-t border-slate-100 p-1">
                <button
                  onClick={() => setView('create')}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded transition-colors"
                >
                  <Plus size={11} />
                  New workspace...
                </button>
              </div>

              {/* Keyboard shortcut hints */}
              <div className="border-t border-slate-100 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Previous / Next</span>
                  <div className="flex items-center gap-0.5">
                    <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">[</kbd>
                    <span className="mx-0.5">/</span>
                    <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">]</kbd>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>Jump to workspace</span>
                  <div className="flex items-center gap-0.5">
                    <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">Ctrl</kbd>
                    <span>+</span>
                    <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">1</kbd>
                    <span>–</span>
                    <kbd className="px-1 py-0.5 bg-slate-100 rounded text-[9px] font-mono">9</kbd>
                  </div>
                </div>
              </div>
            </>
          )}

          {view === 'create' && (
            <CreateView
              onCreated={handleCreated}
              onCancel={() => setView('list')}
            />
          )}
        </div>
      )}

      {/* Edit modal — rendered outside the dropdown to avoid overflow clipping */}
      {editingWs && (
        <EditModal
          ws={editingWs}
          isLast={state.workspaces.length <= 1}
          onSave={handleEditSave}
          onReset={handleReset}
          onDelete={handleDelete}
          onClose={() => setEditingWs(null)}
        />
      )}

      {/* HUD overlay — keyboard-triggered workspace switching feedback */}
      <WorkspaceHUD workspaces={sorted} activeId={state.activeId} visible={hudVisible} onSwitch={handleHUDSwitch} />
    </div>
  );
};
