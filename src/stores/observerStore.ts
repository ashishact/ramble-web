/**
 * Observer Store - All collections for the Observer System
 *
 * Uses TinyBase with IndexedDB persistence for:
 * - Sessions
 * - Messages
 * - KnowledgeItems
 * - Tags
 * - Categories
 * - Privacy
 * - Entities
 * - Suggestions
 * - Documents
 */

import { createStore, type Store } from 'tinybase';

// ============================================================================
// Global Color Palette - Soft, desaturated colors
// ============================================================================

export const PALETTE = {
  // Pinks & Peaches
  softPeach: '#F7DAD9',
  rosewater: '#F4C8C8',
  blushCoral: '#F9C9B9',
  lightApricot: '#FFE0D6',
  pinkMist: '#FDE2E4',
  dustyRose: '#E7BFBF',
  candyPink: '#FCE7F3',
  bubblegumTint: '#F8E0EB',
  blushPetal: '#FFE5F0',

  // Purples & Lilacs
  paleLilac: '#F7E8FF',
  lavenderFog: '#D8C7FF',
  softViolet: '#E3D9FF',
  lilacGrey: '#D6D2E0',
  cloudPurple: '#F0E6F6',

  // Greens & Mints
  mintMist: '#CFF7E3',
  pastelMint: '#D8F8EB',
  pastelSage: '#D8E8D0',
  gentleGreen: '#E4F2DF',
  springMist: '#E9F7E5',
  seafoamGrey: '#EDF5E1',

  // Blues
  powderBlue: '#CDE7F0',
  iceBlue: '#D5F1FF',
  babySky: '#E0F4FF',
  fogBlue: '#C7E6F8',
  frostAqua: '#E3F3F8',
  cloudBlue: '#EEF7FA',

  // Yellows & Creams
  butterCream: '#FFF2C7',
  paleDune: '#FFF6D9',
  softVanilla: '#FFF8E1',
  lemonWhip: '#FAF3C2',
} as const;

export type PaletteColor = keyof typeof PALETTE;
import { createIndexedDbPersister, type IndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';

// ============================================================================
// Type Definitions
// ============================================================================

export interface SystemThinking {
  summary: string;
  goals: string[];
  errors: string[];
  plan: string[];
}

export interface Session {
  id: string;
  name: string;
  description: string;
  tags: string[];
  privacy: string[];
  createdAt: string;
  updatedAt: string;
  systemThinking: SystemThinking;
  state: Record<string, unknown>;
}

export type MessageRole = 'user' | 'ai' | 'observer' | 'system';

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  raw: string;
  processed: string | null;
  timestamp: string;
}

export interface KnowledgeContent {
  text: string;
  tags: string[];
  category: string;
  privacy: string[];
}

export interface KnowledgeItem {
  id: string;
  sessionId: string;
  contents: KnowledgeContent[];
  entities: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CommitInfo {
  by: 'user' | 'ai';
  timestamp: string;
}

export interface SuggestedInfo {
  by: 'user' | 'ai';
  timestamp: string;
  reason: string;
}

export interface Tag {
  name: string;
  description: string;
  color: string;
  icon: string;
  commit?: CommitInfo;
  suggested?: SuggestedInfo;
}

export interface Category {
  name: string;
  description: string;
  color: string;
  icon: string;
  commit?: CommitInfo;
  suggested?: SuggestedInfo;
}

export interface Privacy {
  name: string;
  description: string;
  color: string;
  icon: string;
  commit?: CommitInfo;
  suggested?: SuggestedInfo;
}

export interface Entity {
  name: string;
  type: string;
  count: number;
  sessions: string[];
  firstSeen: string;
  lastSeen: string;
}

export interface SuggestionContent {
  type: 'question' | 'improvement' | 'nudge' | 'essential';
  text: string;
  priority: number;
}

export interface Suggestion {
  id: string;
  sessionId: string;
  contents: SuggestionContent[];
  category: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  hash: string;
  name: string;
  content: string;
  type: string;
  size: number;
  createdAt: string;
}

export type ObserverPhase = 'knowledge' | 'suggestion' | 'system2' | 'meta';

export interface ObserverError {
  id: string;
  sessionId: string;
  phase: ObserverPhase;
  error: string;
  // Data needed to retry the operation
  retryData: {
    messageIds?: string[];      // For knowledge observer
    knowledgeCount?: number;    // For system2 thinker
  };
  resolved: boolean;
  createdAt: string;
  resolvedAt?: string;
}

// ============================================================================
// Store Initialization
// ============================================================================

let store: Store;
let persister: IndexedDbPersister;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Listeners
type SessionListener = (sessions: Session[]) => void;
type MessageListener = (messages: Message[]) => void;
type KnowledgeListener = (items: KnowledgeItem[]) => void;
type SuggestionListener = (suggestions: Suggestion[]) => void;
type TagListener = (tags: Tag[]) => void;
type CategoryListener = (categories: Category[]) => void;
type EntityListener = (entities: Entity[]) => void;
type ObserverErrorListener = (errors: ObserverError[]) => void;

const sessionListeners = new Set<SessionListener>();
const messageListeners = new Map<string, Set<MessageListener>>(); // sessionId -> listeners
const knowledgeListeners = new Map<string, Set<KnowledgeListener>>();
const suggestionListeners = new Map<string, Set<SuggestionListener>>();
const tagListeners = new Set<TagListener>();
const categoryListeners = new Set<CategoryListener>();
const entityListeners = new Set<EntityListener>();
const observerErrorListeners = new Map<string, Set<ObserverErrorListener>>(); // sessionId -> listeners

// Notify functions
const notifySessionListeners = () => {
  const sessions = observerHelpers.getAllSessions();
  sessionListeners.forEach(listener => listener(sessions));
};

const notifyMessageListeners = (sessionId: string) => {
  const listeners = messageListeners.get(sessionId);
  if (listeners) {
    const messages = observerHelpers.getMessages(sessionId);
    listeners.forEach(listener => listener(messages));
  }
};

const notifyKnowledgeListeners = (sessionId: string) => {
  const listeners = knowledgeListeners.get(sessionId);
  if (listeners) {
    const items = observerHelpers.getKnowledgeItems(sessionId);
    listeners.forEach(listener => listener(items));
  }
};

const notifySuggestionListeners = (sessionId: string) => {
  console.log('[ObserverStore] notifySuggestionListeners called for session:', sessionId);
  console.log('[ObserverStore] Registered listener sessionIds:', Array.from(suggestionListeners.keys()));
  const listeners = suggestionListeners.get(sessionId);
  if (listeners) {
    const suggestions = observerHelpers.getSuggestions(sessionId);
    console.log('[ObserverStore] Found', listeners.size, 'listeners, sending', suggestions.length, 'suggestions');
    listeners.forEach(listener => listener(suggestions));
  } else {
    console.log('[ObserverStore] No listeners found for session:', sessionId);
  }
};

const notifyTagListeners = () => {
  const tags = observerHelpers.getAllTags();
  tagListeners.forEach(listener => listener(tags));
};

const notifyCategoryListeners = () => {
  const categories = observerHelpers.getAllCategories();
  categoryListeners.forEach(listener => listener(categories));
};

const notifyEntityListeners = () => {
  const entities = observerHelpers.getEntities();
  entityListeners.forEach(listener => listener(entities));
};

const notifyObserverErrorListeners = (sessionId: string) => {
  const listeners = observerErrorListeners.get(sessionId);
  if (listeners) {
    const errors = observerHelpers.getObserverErrors(sessionId);
    listeners.forEach(listener => listener(errors));
  }
};

// UUID generator
const generateId = () => crypto.randomUUID();

// Default initial data - using soft palette colors
const DEFAULT_PRIVACY: Privacy[] = [
  { name: 'public', description: 'Visible to everyone', color: PALETTE.mintMist, icon: 'globe', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'private', description: 'Only visible to you', color: PALETTE.rosewater, icon: 'lock', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'friends', description: 'Visible to friends', color: PALETTE.powderBlue, icon: 'users', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'family', description: 'Visible to family', color: PALETTE.lavenderFog, icon: 'home', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'work', description: 'Work-related content', color: PALETTE.butterCream, icon: 'briefcase', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'school', description: 'School-related content', color: PALETTE.iceBlue, icon: 'book', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'personal', description: 'Personal content', color: PALETTE.candyPink, icon: 'heart', commit: { by: 'user', timestamp: new Date().toISOString() } },
];

const DEFAULT_CATEGORIES: Category[] = [
  { name: 'general', description: 'General thoughts and ideas', color: PALETTE.lilacGrey, icon: 'folder', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'ideas', description: 'New ideas and concepts', color: PALETTE.lemonWhip, icon: 'lightbulb', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'tasks', description: 'Tasks and to-dos', color: PALETTE.pastelMint, icon: 'check-circle', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'notes', description: 'Notes and observations', color: PALETTE.fogBlue, icon: 'file-text', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'questions', description: 'Questions to explore', color: PALETTE.paleLilac, icon: 'help-circle', commit: { by: 'user', timestamp: new Date().toISOString() } },
];

const DEFAULT_TAGS: Tag[] = [
  { name: 'important', description: 'High priority item', color: PALETTE.dustyRose, icon: 'alert-circle', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'urgent', description: 'Time-sensitive item', color: PALETTE.blushCoral, icon: 'clock', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'follow-up', description: 'Needs follow-up action', color: PALETTE.butterCream, icon: 'arrow-right', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'reference', description: 'Reference material', color: PALETTE.powderBlue, icon: 'bookmark', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'learning', description: 'Learning or study related', color: PALETTE.softViolet, icon: 'book-open', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'project', description: 'Project related', color: PALETTE.gentleGreen, icon: 'folder', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'meeting', description: 'Meeting notes or info', color: PALETTE.frostAqua, icon: 'users', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'decision', description: 'Decision point or outcome', color: PALETTE.bubblegumTint, icon: 'check-square', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'blocker', description: 'Blocking issue', color: PALETTE.softPeach, icon: 'x-circle', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'insight', description: 'Key insight or realization', color: PALETTE.cloudPurple, icon: 'zap', commit: { by: 'user', timestamp: new Date().toISOString() } },
];

// Initialize store
const initStore = async (): Promise<void> => {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    store = createStore();
    persister = createIndexedDbPersister(store, 'observer-db');

    // Load existing data
    await persister.load();

    // Start auto-saving
    await persister.startAutoSave();

    // Set up table listeners
    store.addTableListener('sessions', () => notifySessionListeners());
    store.addTableListener('messages', () => {
      // Notify all session message listeners
      messageListeners.forEach((_, sessionId) => notifyMessageListeners(sessionId));
    });
    store.addTableListener('knowledge', () => {
      knowledgeListeners.forEach((_, sessionId) => notifyKnowledgeListeners(sessionId));
    });
    store.addTableListener('suggestions', () => {
      suggestionListeners.forEach((_, sessionId) => notifySuggestionListeners(sessionId));
    });
    store.addTableListener('tags', () => notifyTagListeners());
    store.addTableListener('categories', () => notifyCategoryListeners());
    store.addTableListener('entities', () => notifyEntityListeners());
    store.addTableListener('observerErrors', () => {
      observerErrorListeners.forEach((_, sessionId) => notifyObserverErrorListeners(sessionId));
    });

    isInitialized = true;
    console.log('[ObserverStore] Initialized with IndexedDB');

    // Seed default data if empty
    seedDefaultData();
  })();

  return initPromise;
};

const seedDefaultData = () => {
  // Seed privacy if empty
  const privacyTable = store.getTable('privacy');
  if (!privacyTable || Object.keys(privacyTable).length === 0) {
    DEFAULT_PRIVACY.forEach(p => {
      store.setRow('privacy', p.name, {
        description: p.description,
        color: p.color,
        icon: p.icon,
        commit: JSON.stringify(p.commit),
      });
    });
    console.log('[ObserverStore] Seeded default privacy values');
  }

  // Seed categories if empty
  const categoryTable = store.getTable('categories');
  if (!categoryTable || Object.keys(categoryTable).length === 0) {
    DEFAULT_CATEGORIES.forEach(c => {
      store.setRow('categories', c.name, {
        description: c.description,
        color: c.color,
        icon: c.icon,
        commit: JSON.stringify(c.commit),
      });
    });
    console.log('[ObserverStore] Seeded default categories');
  }

  // Seed tags if empty
  const tagTable = store.getTable('tags');
  if (!tagTable || Object.keys(tagTable).length === 0) {
    DEFAULT_TAGS.forEach(t => {
      store.setRow('tags', t.name, {
        description: t.description,
        color: t.color,
        icon: t.icon,
        commit: JSON.stringify(t.commit),
      });
    });
    console.log('[ObserverStore] Seeded default tags');
  }
};

// Initialize immediately
initStore();

// ============================================================================
// Row Converters
// ============================================================================

const rowToSession = (id: string, row: Record<string, unknown>): Session => ({
  id,
  name: (row.name as string) || '',
  description: (row.description as string) || '',
  tags: JSON.parse((row.tags as string) || '[]'),
  privacy: JSON.parse((row.privacy as string) || '[]'),
  createdAt: (row.createdAt as string) || '',
  updatedAt: (row.updatedAt as string) || '',
  systemThinking: JSON.parse((row.systemThinking as string) || '{"summary":"","goals":[],"errors":[],"plan":[]}'),
  state: JSON.parse((row.state as string) || '{}'),
});

const rowToMessage = (id: string, row: Record<string, unknown>): Message => ({
  id,
  sessionId: (row.sessionId as string) || '',
  role: (row.role as MessageRole) || 'user',
  raw: (row.raw as string) || '',
  processed: (row.processed as string) || null,
  timestamp: (row.timestamp as string) || '',
});

const rowToKnowledgeItem = (id: string, row: Record<string, unknown>): KnowledgeItem => ({
  id,
  sessionId: (row.sessionId as string) || '',
  contents: JSON.parse((row.contents as string) || '[]'),
  entities: JSON.parse((row.entities as string) || '[]'),
  createdAt: (row.createdAt as string) || '',
  updatedAt: (row.updatedAt as string) || '',
});

const rowToTag = (name: string, row: Record<string, unknown>): Tag => ({
  name,
  description: (row.description as string) || '',
  color: (row.color as string) || '#6b7280',
  icon: (row.icon as string) || 'tag',
  commit: row.commit ? JSON.parse(row.commit as string) : undefined,
  suggested: row.suggested ? JSON.parse(row.suggested as string) : undefined,
});

const rowToCategory = (name: string, row: Record<string, unknown>): Category => ({
  name,
  description: (row.description as string) || '',
  color: (row.color as string) || '#6b7280',
  icon: (row.icon as string) || 'folder',
  commit: row.commit ? JSON.parse(row.commit as string) : undefined,
  suggested: row.suggested ? JSON.parse(row.suggested as string) : undefined,
});

const rowToPrivacy = (name: string, row: Record<string, unknown>): Privacy => ({
  name,
  description: (row.description as string) || '',
  color: (row.color as string) || '#6b7280',
  icon: (row.icon as string) || 'lock',
  commit: row.commit ? JSON.parse(row.commit as string) : undefined,
  suggested: row.suggested ? JSON.parse(row.suggested as string) : undefined,
});

const rowToEntity = (name: string, row: Record<string, unknown>): Entity => ({
  name,
  type: (row.type as string) || 'unknown',
  count: (row.count as number) || 0,
  sessions: JSON.parse((row.sessions as string) || '[]'),
  firstSeen: (row.firstSeen as string) || '',
  lastSeen: (row.lastSeen as string) || '',
});

const rowToSuggestion = (id: string, row: Record<string, unknown>): Suggestion => ({
  id,
  sessionId: (row.sessionId as string) || '',
  contents: JSON.parse((row.contents as string) || '[]'),
  category: (row.category as string) || 'general',
  tags: JSON.parse((row.tags as string) || '[]'),
  createdAt: (row.createdAt as string) || '',
  updatedAt: (row.updatedAt as string) || '',
});

const rowToDocument = (hash: string, row: Record<string, unknown>): Document => ({
  hash,
  name: (row.name as string) || '',
  content: (row.content as string) || '',
  type: (row.type as string) || '',
  size: (row.size as number) || 0,
  createdAt: (row.createdAt as string) || '',
});

// ============================================================================
// Helper Functions
// ============================================================================

export const observerHelpers = {
  // Initialization
  ensureReady: async (): Promise<void> => {
    await initStore();
  },

  // =========================================================================
  // Sessions
  // =========================================================================

  createSession: (name?: string): Session => {
    if (!isInitialized) {
      console.warn('[ObserverStore] Not initialized yet');
      throw new Error('Store not initialized');
    }

    const id = generateId();
    const now = new Date().toISOString();
    const session: Session = {
      id,
      name: name || `Session ${new Date().toLocaleDateString()}`,
      description: '',
      tags: [],
      privacy: ['private'],
      createdAt: now,
      updatedAt: now,
      systemThinking: { summary: '', goals: [], errors: [], plan: [] },
      state: {},
    };

    store.setRow('sessions', id, {
      name: session.name,
      description: session.description,
      tags: JSON.stringify(session.tags),
      privacy: JSON.stringify(session.privacy),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      systemThinking: JSON.stringify(session.systemThinking),
      state: JSON.stringify(session.state),
    });

    console.log('[ObserverStore] Created session:', id);
    return session;
  },

  getSession: (id: string): Session | undefined => {
    if (!isInitialized) return undefined;
    const row = store.getRow('sessions', id);
    if (!row || Object.keys(row).length === 0) return undefined;
    return rowToSession(id, row);
  },

  updateSession: (id: string, updates: Partial<Omit<Session, 'id' | 'createdAt'>>) => {
    if (!isInitialized) return;

    const now = new Date().toISOString();
    if (updates.name !== undefined) store.setCell('sessions', id, 'name', updates.name);
    if (updates.description !== undefined) store.setCell('sessions', id, 'description', updates.description);
    if (updates.tags !== undefined) store.setCell('sessions', id, 'tags', JSON.stringify(updates.tags));
    if (updates.privacy !== undefined) store.setCell('sessions', id, 'privacy', JSON.stringify(updates.privacy));
    if (updates.systemThinking !== undefined) store.setCell('sessions', id, 'systemThinking', JSON.stringify(updates.systemThinking));
    if (updates.state !== undefined) store.setCell('sessions', id, 'state', JSON.stringify(updates.state));
    store.setCell('sessions', id, 'updatedAt', now);
  },

  updateSessionState: (id: string, stateUpdates: Record<string, unknown>) => {
    if (!isInitialized) return;

    const session = observerHelpers.getSession(id);
    if (!session) return;

    const newState = { ...session.state, ...stateUpdates };
    store.setCell('sessions', id, 'state', JSON.stringify(newState));
    store.setCell('sessions', id, 'updatedAt', new Date().toISOString());
  },

  updateSystemThinking: (id: string, thinking: Partial<SystemThinking>) => {
    if (!isInitialized) return;

    const session = observerHelpers.getSession(id);
    if (!session) return;

    const newThinking = { ...session.systemThinking, ...thinking };
    store.setCell('sessions', id, 'systemThinking', JSON.stringify(newThinking));
    store.setCell('sessions', id, 'updatedAt', new Date().toISOString());
  },

  getAllSessions: (): Session[] => {
    if (!isInitialized) return [];
    const table = store.getTable('sessions');
    if (!table) return [];
    return Object.entries(table)
      .map(([id, row]) => rowToSession(id, row))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  },

  deleteSession: (id: string) => {
    if (!isInitialized) return;
    store.delRow('sessions', id);
    // Also delete related messages, knowledge items, and suggestions
    const messages = observerHelpers.getMessages(id);
    messages.forEach(m => store.delRow('messages', m.id));
    const knowledge = observerHelpers.getKnowledgeItems(id);
    knowledge.forEach(k => store.delRow('knowledge', k.id));
    const suggestions = observerHelpers.getSuggestions(id);
    suggestions.forEach(s => store.delRow('suggestions', s.id));
  },

  subscribeToSessions: (listener: SessionListener): (() => void) => {
    sessionListeners.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getAllSessions());
    }
    return () => sessionListeners.delete(listener);
  },

  // =========================================================================
  // Messages
  // =========================================================================

  addMessage: (sessionId: string, role: MessageRole, raw: string, processed?: string): Message => {
    if (!isInitialized) {
      throw new Error('Store not initialized');
    }

    const id = generateId();
    const now = new Date().toISOString();
    const message: Message = {
      id,
      sessionId,
      role,
      raw,
      processed: processed || null,
      timestamp: now,
    };

    store.setRow('messages', id, {
      sessionId: message.sessionId,
      role: message.role,
      raw: message.raw,
      processed: message.processed || '',
      timestamp: message.timestamp,
    });

    // Update session timestamp
    store.setCell('sessions', sessionId, 'updatedAt', now);

    console.log('[ObserverStore] Added message:', id);
    return message;
  },

  getMessages: (sessionId: string): Message[] => {
    if (!isInitialized) return [];
    const table = store.getTable('messages');
    if (!table) return [];
    return Object.entries(table)
      .map(([id, row]) => rowToMessage(id, row))
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  },

  getRecentMessages: (sessionId: string, limit = 20): Message[] => {
    return observerHelpers.getMessages(sessionId).slice(-limit);
  },

  subscribeToMessages: (sessionId: string, listener: MessageListener): (() => void) => {
    if (!messageListeners.has(sessionId)) {
      messageListeners.set(sessionId, new Set());
    }
    messageListeners.get(sessionId)!.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getMessages(sessionId));
    }
    return () => {
      const listeners = messageListeners.get(sessionId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          messageListeners.delete(sessionId);
        }
      }
    };
  },

  // =========================================================================
  // Knowledge Items
  // =========================================================================

  addKnowledgeItem: (sessionId: string, contents: KnowledgeContent[], entities: string[]): KnowledgeItem => {
    if (!isInitialized) {
      throw new Error('Store not initialized');
    }

    const id = generateId();
    const now = new Date().toISOString();
    const item: KnowledgeItem = {
      id,
      sessionId,
      contents,
      entities,
      createdAt: now,
      updatedAt: now,
    };

    store.setRow('knowledge', id, {
      sessionId: item.sessionId,
      contents: JSON.stringify(item.contents),
      entities: JSON.stringify(item.entities),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });

    console.log('[ObserverStore] Added knowledge item:', id);
    return item;
  },

  getKnowledgeItems: (sessionId: string): KnowledgeItem[] => {
    if (!isInitialized) return [];
    const table = store.getTable('knowledge');
    if (!table) return [];
    return Object.entries(table)
      .map(([id, row]) => rowToKnowledgeItem(id, row))
      .filter(k => k.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  getKnowledgeItemCount: (sessionId: string): number => {
    return observerHelpers.getKnowledgeItems(sessionId).length;
  },

  updateKnowledgeItem: (id: string, updates: Partial<Omit<KnowledgeItem, 'id' | 'sessionId' | 'createdAt'>>) => {
    if (!isInitialized) return;

    if (updates.contents !== undefined) store.setCell('knowledge', id, 'contents', JSON.stringify(updates.contents));
    if (updates.entities !== undefined) store.setCell('knowledge', id, 'entities', JSON.stringify(updates.entities));
    store.setCell('knowledge', id, 'updatedAt', new Date().toISOString());
  },

  subscribeToKnowledge: (sessionId: string, listener: KnowledgeListener): (() => void) => {
    if (!knowledgeListeners.has(sessionId)) {
      knowledgeListeners.set(sessionId, new Set());
    }
    knowledgeListeners.get(sessionId)!.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getKnowledgeItems(sessionId));
    }
    return () => {
      const listeners = knowledgeListeners.get(sessionId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          knowledgeListeners.delete(sessionId);
        }
      }
    };
  },

  // =========================================================================
  // Tags
  // =========================================================================

  getCommittedTags: (): Tag[] => {
    return observerHelpers.getAllTags().filter(t => t.commit !== undefined);
  },

  getAllTags: (): Tag[] => {
    if (!isInitialized) return [];
    const table = store.getTable('tags');
    if (!table) return [];
    return Object.entries(table).map(([name, row]) => rowToTag(name, row));
  },

  commitTag: (name: string, by: 'user' | 'ai') => {
    if (!isInitialized) return;
    store.setCell('tags', name, 'commit', JSON.stringify({ by, timestamp: new Date().toISOString() }));
  },

  deleteTag: (name: string) => {
    if (!isInitialized) return;
    store.delRow('tags', name);
  },

  suggestTag: (tag: Omit<Tag, 'commit'>) => {
    if (!isInitialized) return;
    store.setRow('tags', tag.name, {
      description: tag.description,
      color: tag.color,
      icon: tag.icon,
      suggested: JSON.stringify(tag.suggested),
    });
  },

  subscribeToTags: (listener: TagListener): (() => void) => {
    tagListeners.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getAllTags());
    }
    return () => tagListeners.delete(listener);
  },

  // =========================================================================
  // Categories
  // =========================================================================

  getCommittedCategories: (): Category[] => {
    return observerHelpers.getAllCategories().filter(c => c.commit !== undefined);
  },

  getAllCategories: (): Category[] => {
    if (!isInitialized) return [];
    const table = store.getTable('categories');
    if (!table) return [];
    return Object.entries(table).map(([name, row]) => rowToCategory(name, row));
  },

  commitCategory: (name: string, by: 'user' | 'ai') => {
    if (!isInitialized) return;
    store.setCell('categories', name, 'commit', JSON.stringify({ by, timestamp: new Date().toISOString() }));
  },

  deleteCategory: (name: string) => {
    if (!isInitialized) return;
    store.delRow('categories', name);
  },

  suggestCategory: (category: Omit<Category, 'commit'>) => {
    if (!isInitialized) return;
    store.setRow('categories', category.name, {
      description: category.description,
      color: category.color,
      icon: category.icon,
      suggested: JSON.stringify(category.suggested),
    });
  },

  subscribeToCategories: (listener: CategoryListener): (() => void) => {
    categoryListeners.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getAllCategories());
    }
    return () => categoryListeners.delete(listener);
  },

  // =========================================================================
  // Privacy
  // =========================================================================

  getAllPrivacy: (): Privacy[] => {
    if (!isInitialized) return [];
    const table = store.getTable('privacy');
    if (!table) return [];
    return Object.entries(table).map(([name, row]) => rowToPrivacy(name, row));
  },

  // =========================================================================
  // Entities
  // =========================================================================

  addOrUpdateEntity: (name: string, type: string, sessionId: string) => {
    if (!isInitialized) return;

    const existing = store.getRow('entities', name);
    const now = new Date().toISOString();

    if (existing && Object.keys(existing).length > 0) {
      const sessions: string[] = JSON.parse((existing.sessions as string) || '[]');
      if (!sessions.includes(sessionId)) {
        sessions.push(sessionId);
      }
      store.setRow('entities', name, {
        type: existing.type as string,
        count: ((existing.count as number) || 0) + 1,
        sessions: JSON.stringify(sessions),
        firstSeen: existing.firstSeen as string,
        lastSeen: now,
      });
    } else {
      store.setRow('entities', name, {
        type,
        count: 1,
        sessions: JSON.stringify([sessionId]),
        firstSeen: now,
        lastSeen: now,
      });
    }
  },

  getEntities: (): Entity[] => {
    if (!isInitialized) return [];
    const table = store.getTable('entities');
    if (!table) return [];
    return Object.entries(table)
      .map(([name, row]) => rowToEntity(name, row))
      .sort((a, b) => b.count - a.count);
  },

  getEntitiesBySession: (sessionId: string): Entity[] => {
    return observerHelpers.getEntities().filter(e => e.sessions.includes(sessionId));
  },

  subscribeToEntities: (listener: EntityListener): (() => void) => {
    entityListeners.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getEntities());
    }
    return () => entityListeners.delete(listener);
  },

  // =========================================================================
  // Suggestions
  // =========================================================================

  addSuggestion: (sessionId: string, contents: SuggestionContent[], category = 'general', tags: string[] = []): Suggestion => {
    if (!isInitialized) {
      throw new Error('Store not initialized');
    }

    const id = generateId();
    const now = new Date().toISOString();
    const suggestion: Suggestion = {
      id,
      sessionId,
      contents,
      category,
      tags,
      createdAt: now,
      updatedAt: now,
    };

    store.setRow('suggestions', id, {
      sessionId: suggestion.sessionId,
      contents: JSON.stringify(suggestion.contents),
      category: suggestion.category,
      tags: JSON.stringify(suggestion.tags),
      createdAt: suggestion.createdAt,
      updatedAt: suggestion.updatedAt,
    });

    console.log('[ObserverStore] Added suggestion:', id, 'for session:', sessionId, 'contents:', contents.length);

    // Manually notify listeners since table listener may not fire immediately
    notifySuggestionListeners(sessionId);

    return suggestion;
  },

  getSuggestions: (sessionId: string): Suggestion[] => {
    if (!isInitialized) return [];
    const table = store.getTable('suggestions');
    if (!table) return [];
    return Object.entries(table)
      .map(([id, row]) => rowToSuggestion(id, row))
      .filter(s => s.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()); // Ascending: oldest first, newest at bottom
  },

  subscribeToSuggestions: (sessionId: string, listener: SuggestionListener): (() => void) => {
    console.log('[ObserverStore] subscribeToSuggestions called for session:', sessionId);
    if (!suggestionListeners.has(sessionId)) {
      suggestionListeners.set(sessionId, new Set());
    }
    suggestionListeners.get(sessionId)!.add(listener);
    console.log('[ObserverStore] Listener added, total listeners for session:', suggestionListeners.get(sessionId)!.size);
    if (isInitialized) {
      const initialSuggestions = observerHelpers.getSuggestions(sessionId);
      console.log('[ObserverStore] Sending initial suggestions:', initialSuggestions.length);
      listener(initialSuggestions);
    }
    return () => {
      const listeners = suggestionListeners.get(sessionId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          suggestionListeners.delete(sessionId);
        }
      }
    };
  },

  // =========================================================================
  // Documents
  // =========================================================================

  addDocument: async (name: string, content: string, type: string): Promise<Document> => {
    if (!isInitialized) {
      throw new Error('Store not initialized');
    }

    // Generate hash from content
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    const now = new Date().toISOString();
    const doc: Document = {
      hash,
      name,
      content,
      type,
      size: content.length,
      createdAt: now,
    };

    store.setRow('documents', hash, {
      name: doc.name,
      content: doc.content,
      type: doc.type,
      size: doc.size,
      createdAt: doc.createdAt,
    });

    console.log('[ObserverStore] Added document:', hash);
    return doc;
  },

  getDocument: (hash: string): Document | undefined => {
    if (!isInitialized) return undefined;
    const row = store.getRow('documents', hash);
    if (!row || Object.keys(row).length === 0) return undefined;
    return rowToDocument(hash, row);
  },

  getAllDocuments: (): Document[] => {
    if (!isInitialized) return [];
    const table = store.getTable('documents');
    if (!table) return [];
    return Object.entries(table)
      .map(([hash, row]) => rowToDocument(hash, row))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  // =========================================================================
  // Direct Store Access (for chat/query interface)
  // =========================================================================

  /**
   * Get the raw TinyBase store instance
   * Use with caution - direct mutations bypass helpers
   */
  getStore: (): Store | null => {
    if (!isInitialized) return null;
    return store;
  },

  /**
   * Execute a read query on the store
   * Returns the result or throws an error
   */
  executeQuery: (queryFn: (store: Store) => unknown): unknown => {
    if (!isInitialized) {
      throw new Error('Store not initialized');
    }
    return queryFn(store);
  },

  /**
   * Execute a mutation on the store
   * Returns the result or throws an error
   */
  executeMutation: (mutationFn: (store: Store) => unknown): unknown => {
    if (!isInitialized) {
      throw new Error('Store not initialized');
    }
    return mutationFn(store);
  },

  /**
   * Get the schema of the TinyBase database
   * Returns table names, their columns, and sample data types
   */
  getSchema: (): DatabaseSchema => {
    if (!isInitialized) {
      return { tables: {}, initialized: false };
    }

    const tables: Record<string, TableSchema> = {};
    const tableNames = ['sessions', 'messages', 'knowledge', 'tags', 'categories', 'privacy', 'entities', 'suggestions', 'documents'];

    for (const tableName of tableNames) {
      const table = store.getTable(tableName);
      const rowCount = table ? Object.keys(table).length : 0;
      const columns: Record<string, ColumnSchema> = {};

      // Get column info from first row if exists
      if (table && rowCount > 0) {
        const firstRow = Object.values(table)[0] as Record<string, unknown>;
        for (const [colName, value] of Object.entries(firstRow)) {
          columns[colName] = {
            type: typeof value,
            sample: typeof value === 'string' && value.length > 100
              ? value.substring(0, 100) + '...'
              : value,
          };
        }
      }

      tables[tableName] = {
        rowCount,
        columns,
        primaryKey: tableName === 'tags' || tableName === 'categories' || tableName === 'privacy'
          ? 'name'
          : tableName === 'documents'
            ? 'hash'
            : 'id',
      };
    }

    return { tables, initialized: true };
  },

  // =========================================================================
  // Observer Errors
  // =========================================================================

  /**
   * Add an observer error with retry data
   */
  addObserverError: (
    sessionId: string,
    phase: ObserverPhase,
    error: string,
    retryData: ObserverError['retryData']
  ): string => {
    if (!isInitialized) return '';
    const id = generateId();
    const now = new Date().toISOString();

    store.setRow('observerErrors', id, {
      sessionId,
      phase,
      error,
      retryData: JSON.stringify(retryData),
      resolved: false,
      createdAt: now,
    });

    notifyObserverErrorListeners(sessionId);
    return id;
  },

  /**
   * Get all unresolved observer errors for a session
   */
  getObserverErrors: (sessionId: string): ObserverError[] => {
    if (!isInitialized) return [];
    const table = store.getTable('observerErrors');
    if (!table) return [];

    return Object.entries(table)
      .filter(([, row]) => row.sessionId === sessionId && !row.resolved)
      .map(([id, row]) => ({
        id,
        sessionId: row.sessionId as string,
        phase: row.phase as ObserverPhase,
        error: row.error as string,
        retryData: JSON.parse(row.retryData as string || '{}'),
        resolved: row.resolved as boolean,
        createdAt: row.createdAt as string,
        resolvedAt: row.resolvedAt as string | undefined,
      }));
  },

  /**
   * Mark an observer error as resolved
   */
  resolveObserverError: (errorId: string): void => {
    if (!isInitialized) return;
    const row = store.getRow('observerErrors', errorId);
    if (!row) return;

    store.setCell('observerErrors', errorId, 'resolved', true);
    store.setCell('observerErrors', errorId, 'resolvedAt', new Date().toISOString());

    notifyObserverErrorListeners(row.sessionId as string);
  },

  /**
   * Delete an observer error
   */
  deleteObserverError: (errorId: string): void => {
    if (!isInitialized) return;
    const row = store.getRow('observerErrors', errorId);
    if (!row) return;

    const sessionId = row.sessionId as string;
    store.delRow('observerErrors', errorId);
    notifyObserverErrorListeners(sessionId);
  },

  /**
   * Subscribe to observer errors for a session
   */
  subscribeToObserverErrors: (sessionId: string, listener: ObserverErrorListener): (() => void) => {
    if (!observerErrorListeners.has(sessionId)) {
      observerErrorListeners.set(sessionId, new Set());
    }
    observerErrorListeners.get(sessionId)!.add(listener);

    // Send initial data
    if (isInitialized) {
      listener(observerHelpers.getObserverErrors(sessionId));
    }

    return () => {
      const listeners = observerErrorListeners.get(sessionId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          observerErrorListeners.delete(sessionId);
        }
      }
    };
  },

  /**
   * Get a summary of all data for context
   */
  getDataSummary: (): DataSummary => {
    if (!isInitialized) {
      return { sessions: 0, messages: 0, knowledge: 0, tags: 0, categories: 0, entities: 0, suggestions: 0, documents: 0 };
    }

    return {
      sessions: Object.keys(store.getTable('sessions') || {}).length,
      messages: Object.keys(store.getTable('messages') || {}).length,
      knowledge: Object.keys(store.getTable('knowledge') || {}).length,
      tags: Object.keys(store.getTable('tags') || {}).length,
      categories: Object.keys(store.getTable('categories') || {}).length,
      entities: Object.keys(store.getTable('entities') || {}).length,
      suggestions: Object.keys(store.getTable('suggestions') || {}).length,
      documents: Object.keys(store.getTable('documents') || {}).length,
    };
  },
};

// ============================================================================
// Schema Types for Chat Interface
// ============================================================================

export interface ColumnSchema {
  type: string;
  sample: unknown;
}

export interface TableSchema {
  rowCount: number;
  columns: Record<string, ColumnSchema>;
  primaryKey: string;
}

export interface DatabaseSchema {
  tables: Record<string, TableSchema>;
  initialized: boolean;
}

export interface DataSummary {
  sessions: number;
  messages: number;
  knowledge: number;
  tags: number;
  categories: number;
  entities: number;
  suggestions: number;
  documents: number;
}
