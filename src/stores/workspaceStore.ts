/**
 * Workspace Store — Named workspace layouts with reactive state.
 *
 * Follows the same pattern as settingsStore: in-memory cache, localStorage
 * persistence, listener-based reactivity (useSyncExternalStore-compatible).
 *
 * localStorage key: `ramble:workspaces`
 */

import { z } from 'zod/v4';
import type { BentoTree } from '../components/bento/types';
import { BentoTreeSchema } from '../components/bento/types';
import { generateId } from '../components/bento/utils';
import { getTemplate, BUILT_IN_TEMPLATES } from './workspaceTemplates';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const WorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  tree: BentoTreeSchema,
  builtIn: z.boolean(),
  templateId: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
  theme: z.string().optional(),
  order: z.number(),
  createdAt: z.number(),
  modifiedAt: z.number(),
});

const WorkspaceStateSchema = z.object({
  activeId: z.string(),
  workspaces: z.array(WorkspaceSchema).min(1),
});

// ---------------------------------------------------------------------------
// Types (derived from schemas)
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  tree: BentoTree;
  builtIn: boolean;       // shipped template — can be "reset to default"
  templateId?: string;    // which template this was created from (for reset)
  description?: string;   // optional user-written description
  icon?: string;          // Iconify icon name, e.g. "mdi:briefcase"
  theme?: string;         // DaisyUI theme name, e.g. "dark", "nord"
  order: number;
  createdAt: number;
  modifiedAt: number;
}

export interface WorkspaceState {
  activeId: string;
  workspaces: Workspace[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ramble:workspaces';

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const saveState = (state: WorkspaceState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('[Workspaces] Failed to save:', e);
  }
};

/**
 * Load workspace state from localStorage with Zod validation.
 * Falls back to a fresh Default workspace if parsing fails.
 */
const loadState = (): WorkspaceState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const json = JSON.parse(raw);
      const result = WorkspaceStateSchema.safeParse(json);
      if (result.success) {
        // The Zod schema validates structure; cast tree back to BentoTree
        const parsed = result.data as unknown as WorkspaceState;
        // Validate activeId points to a real workspace
        const activeExists = parsed.workspaces.some(w => w.id === parsed.activeId);
        if (!activeExists) {
          parsed.activeId = parsed.workspaces[0].id;
          saveState(parsed);
        }
        return parsed;
      }
      console.warn('[Workspaces] Stored state failed validation');
      console.warn('[Workspaces] Zod issues:', JSON.stringify(result.error.issues, null, 2));
    }
  } catch (e) {
    console.warn('[Workspaces] Failed to parse stored state:', e);
  }

  // Seed all built-in templates as workspaces
  const now = Date.now();
  const workspaces: Workspace[] = BUILT_IN_TEMPLATES.map((t, i) => ({
    id: generateId(),
    name: t.name,
    tree: t.createTree(),
    builtIn: true,
    templateId: t.id,
    description: t.description,
    icon: t.icon,
    order: i,
    createdAt: now,
    modifiedAt: now,
  }));

  const state: WorkspaceState = {
    activeId: workspaces[0].id,
    workspaces,
  };

  saveState(state);
  return state;
};

// ---------------------------------------------------------------------------
// In-memory cache & listeners
// ---------------------------------------------------------------------------

type Listener = () => void;
let cached: WorkspaceState = loadState();
const listeners = new Set<Listener>();

const notify = () => {
  listeners.forEach(fn => fn());
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const findWorkspace = (id: string): Workspace | undefined =>
  cached.workspaces.find(w => w.id === id);

const nextOrder = (): number =>
  cached.workspaces.reduce((max, w) => Math.max(max, w.order), -1) + 1;

const persist = () => {
  saveState(cached);
  notify();
};

// ---------------------------------------------------------------------------
// Public API (module-level object, same shape as settingsHelpers)
// ---------------------------------------------------------------------------

export const workspaceStore = {
  /** useSyncExternalStore-compatible subscribe */
  subscribe: (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /** useSyncExternalStore-compatible getSnapshot */
  getState: (): WorkspaceState => cached,

  /** Get the currently active workspace */
  getActive: (): Workspace => {
    const ws = findWorkspace(cached.activeId);
    // Should never happen, but guard defensively
    return ws ?? cached.workspaces[0];
  },

  /** Get the BentoTree for the active workspace */
  getActiveTree: (): BentoTree => {
    return workspaceStore.getActive().tree;
  },

  /** Persist a tree update to the active workspace (called on every layout edit) */
  saveTree: (tree: BentoTree): void => {
    const idx = cached.workspaces.findIndex(w => w.id === cached.activeId);
    if (idx === -1) return;

    const updated = [...cached.workspaces];
    updated[idx] = { ...updated[idx], tree, modifiedAt: Date.now() };
    cached = { ...cached, workspaces: updated };
    persist();
  },

  /** Switch to a workspace by id. Returns the tree to render. */
  switchTo: (id: string): BentoTree => {
    const ws = findWorkspace(id);
    if (!ws) return workspaceStore.getActiveTree();

    cached = { ...cached, activeId: id };
    persist();
    return ws.tree;
  },

  /** Create a new workspace by cloning the current tree */
  create: (name: string): Workspace => {
    const now = Date.now();
    const currentTree = workspaceStore.getActiveTree();
    // Deep-clone the tree so mutations are independent
    const clonedTree = JSON.parse(JSON.stringify(currentTree)) as BentoTree;

    const ws: Workspace = {
      id: generateId(),
      name,
      tree: clonedTree,
      builtIn: false,
      order: nextOrder(),
      createdAt: now,
      modifiedAt: now,
    };

    cached = {
      activeId: ws.id,
      workspaces: [...cached.workspaces, ws],
    };
    persist();
    return ws;
  },

  /** Create a new workspace from a built-in template */
  createFromTemplate: (templateId: string, name?: string): Workspace => {
    const template = getTemplate(templateId);
    if (!template) {
      // Fallback to Default if unknown template
      return workspaceStore.createFromTemplate('default', name);
    }

    const now = Date.now();
    const ws: Workspace = {
      id: generateId(),
      name: name ?? template.name,
      tree: template.createTree(),
      builtIn: false,
      templateId,
      icon: template.icon,
      order: nextOrder(),
      createdAt: now,
      modifiedAt: now,
    };

    cached = {
      activeId: ws.id,
      workspaces: [...cached.workspaces, ws],
    };
    persist();
    return ws;
  },

  /** Update workspace fields (name, description, icon, theme) */
  update: (id: string, fields: { name?: string; description?: string; icon?: string; theme?: string }): void => {
    const idx = cached.workspaces.findIndex(w => w.id === id);
    if (idx === -1) return;

    const updated = [...cached.workspaces];
    updated[idx] = { ...updated[idx], ...fields, modifiedAt: Date.now() };
    cached = { ...cached, workspaces: updated };
    persist();
  },

  /** Rename a workspace */
  rename: (id: string, name: string): void => {
    workspaceStore.update(id, { name });
  },

  /** Delete a workspace. Returns false if it's the last one. */
  delete: (id: string): boolean => {
    if (cached.workspaces.length <= 1) return false;

    const remaining = cached.workspaces.filter(w => w.id !== id);
    const newActiveId = cached.activeId === id ? remaining[0].id : cached.activeId;

    cached = { activeId: newActiveId, workspaces: remaining };
    persist();
    return true;
  },

  /** Reset a built-in workspace to its original template layout. Returns new tree or null if not applicable. */
  resetToDefault: (id: string): BentoTree | null => {
    const idx = cached.workspaces.findIndex(w => w.id === id);
    if (idx === -1) return null;

    const ws = cached.workspaces[idx];
    const templateId = ws.templateId;
    if (!templateId) return null;

    const template = getTemplate(templateId);
    if (!template) return null;

    const newTree = template.createTree();
    const updated = [...cached.workspaces];
    updated[idx] = { ...updated[idx], tree: newTree, modifiedAt: Date.now() };
    cached = { ...cached, workspaces: updated };
    persist();
    return newTree;
  },

  /** Reorder workspaces */
  reorder: (orderedIds: string[]): void => {
    const byId = new Map(cached.workspaces.map(w => [w.id, w]));
    const reordered = orderedIds
      .map((id, i) => {
        const ws = byId.get(id);
        return ws ? { ...ws, order: i } : null;
      })
      .filter(Boolean) as Workspace[];

    // Include any workspaces not in orderedIds (shouldn't happen, but guard)
    const included = new Set(orderedIds);
    for (const ws of cached.workspaces) {
      if (!included.has(ws.id)) {
        reordered.push({ ...ws, order: reordered.length });
      }
    }

    cached = { ...cached, workspaces: reordered };
    persist();
  },
};
