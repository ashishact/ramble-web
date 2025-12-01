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

const sessionListeners = new Set<SessionListener>();
const messageListeners = new Map<string, Set<MessageListener>>(); // sessionId -> listeners
const knowledgeListeners = new Map<string, Set<KnowledgeListener>>();
const suggestionListeners = new Map<string, Set<SuggestionListener>>();
const tagListeners = new Set<TagListener>();
const categoryListeners = new Set<CategoryListener>();
const entityListeners = new Set<EntityListener>();

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
  const listeners = suggestionListeners.get(sessionId);
  if (listeners) {
    const suggestions = observerHelpers.getSuggestions(sessionId);
    listeners.forEach(listener => listener(suggestions));
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

// UUID generator
const generateId = () => crypto.randomUUID();

// Default initial data
const DEFAULT_PRIVACY: Privacy[] = [
  { name: 'public', description: 'Visible to everyone', color: '#22c55e', icon: 'globe', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'private', description: 'Only visible to you', color: '#ef4444', icon: 'lock', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'friends', description: 'Visible to friends', color: '#3b82f6', icon: 'users', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'family', description: 'Visible to family', color: '#a855f7', icon: 'home', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'work', description: 'Work-related content', color: '#f59e0b', icon: 'briefcase', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'school', description: 'School-related content', color: '#06b6d4', icon: 'book', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'personal', description: 'Personal content', color: '#ec4899', icon: 'heart', commit: { by: 'user', timestamp: new Date().toISOString() } },
];

const DEFAULT_CATEGORIES: Category[] = [
  { name: 'general', description: 'General thoughts and ideas', color: '#6b7280', icon: 'folder', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'ideas', description: 'New ideas and concepts', color: '#eab308', icon: 'lightbulb', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'tasks', description: 'Tasks and to-dos', color: '#22c55e', icon: 'check-circle', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'notes', description: 'Notes and observations', color: '#3b82f6', icon: 'file-text', commit: { by: 'user', timestamp: new Date().toISOString() } },
  { name: 'questions', description: 'Questions to explore', color: '#a855f7', icon: 'help-circle', commit: { by: 'user', timestamp: new Date().toISOString() } },
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

    console.log('[ObserverStore] Added suggestion:', id);
    return suggestion;
  },

  getSuggestions: (sessionId: string): Suggestion[] => {
    if (!isInitialized) return [];
    const table = store.getTable('suggestions');
    if (!table) return [];
    return Object.entries(table)
      .map(([id, row]) => rowToSuggestion(id, row))
      .filter(s => s.sessionId === sessionId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  subscribeToSuggestions: (sessionId: string, listener: SuggestionListener): (() => void) => {
    if (!suggestionListeners.has(sessionId)) {
      suggestionListeners.set(sessionId, new Set());
    }
    suggestionListeners.get(sessionId)!.add(listener);
    if (isInitialized) {
      listener(observerHelpers.getSuggestions(sessionId));
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
};
