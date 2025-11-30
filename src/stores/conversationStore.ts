/**
 * Conversation Store - Messages and transcripts
 *
 * Uses TinyBase with IndexedDB persistence for large conversation data.
 */

import { createStore, type Store } from 'tinybase';
import { createIndexedDbPersister, type IndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: string;
  isComplete: boolean;
  isStreaming?: boolean;
  processedByObserver?: boolean;
}

// Helper to generate unique IDs
export const generateMessageId = () => `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// TinyBase store and persister
let store: Store;
let persister: IndexedDbPersister;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Listeners for reactive updates
type MessageListener = (messages: ConversationMessage[]) => void;
const listeners = new Set<MessageListener>();

const notifyListeners = () => {
  const messages = conversationHelpers.getAllMessages();
  listeners.forEach(listener => listener(messages));
};

// Initialize TinyBase store with IndexedDB
const initStore = async (): Promise<void> => {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    store = createStore();
    persister = createIndexedDbPersister(store, 'amigoz-conversations');

    // Load existing data from IndexedDB
    await persister.load();

    // Start auto-saving changes
    await persister.startAutoSave();

    // Listen for changes
    store.addTablesListener(() => {
      notifyListeners();
    });

    isInitialized = true;
    console.log('[ConversationStore] Initialized with IndexedDB');
  })();

  return initPromise;
};

// Initialize immediately
initStore();

// Convert TinyBase row to ConversationMessage
const rowToMessage = (rowId: string, row: Record<string, unknown>): ConversationMessage => ({
  id: rowId,
  role: row.role as 'user' | 'model',
  content: row.content as string,
  timestamp: row.timestamp as string,
  isComplete: row.isComplete as boolean,
  isStreaming: row.isStreaming as boolean | undefined,
  processedByObserver: row.processedByObserver as boolean | undefined,
});

// Helper functions
export const conversationHelpers = {
  // Ensure store is ready
  ensureReady: async (): Promise<void> => {
    await initStore();
  },

  subscribe: (listener: MessageListener): (() => void) => {
    listeners.add(listener);
    // Immediately call with current data
    if (isInitialized) {
      listener(conversationHelpers.getAllMessages());
    }
    return () => listeners.delete(listener);
  },

  addUserMessage: (content: string): ConversationMessage => {
    if (!isInitialized) {
      console.warn('[ConversationStore] Not initialized yet');
      return { id: '', role: 'user', content, timestamp: new Date().toISOString(), isComplete: true };
    }

    const id = generateMessageId();
    const message: ConversationMessage = {
      id,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      isComplete: true,
      processedByObserver: false,
    };

    store.setRow('messages', id, {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      isComplete: message.isComplete,
      processedByObserver: message.processedByObserver ?? false,
    });

    console.log('[ConversationStore] Added user message:', content.substring(0, 50));
    return message;
  },

  addModelMessage: (content: string, isStreaming = false): ConversationMessage => {
    if (!isInitialized) {
      console.warn('[ConversationStore] Not initialized yet');
      return { id: '', role: 'model', content, timestamp: new Date().toISOString(), isComplete: !isStreaming };
    }

    const id = generateMessageId();
    const message: ConversationMessage = {
      id,
      role: 'model',
      content,
      timestamp: new Date().toISOString(),
      isComplete: !isStreaming,
      isStreaming,
      processedByObserver: false,
    };

    store.setRow('messages', id, {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
      isComplete: message.isComplete,
      isStreaming: message.isStreaming ?? false,
      processedByObserver: message.processedByObserver ?? false,
    });

    console.log('[ConversationStore] Added model message:', content.substring(0, 50));
    return message;
  },

  updateMessageContent: (id: string, content: string, isComplete = false) => {
    if (!isInitialized) return;

    store.setCell('messages', id, 'content', content);
    store.setCell('messages', id, 'isComplete', isComplete);
    if (isComplete) {
      store.setCell('messages', id, 'isStreaming', false);
    }
  },

  markAsProcessed: (id: string) => {
    if (!isInitialized) return;
    store.setCell('messages', id, 'processedByObserver', true);
  },

  getRecentMessages: (limit = 20): ConversationMessage[] => {
    if (!isInitialized) return [];

    const table = store.getTable('messages');
    if (!table) return [];

    const messages = Object.entries(table).map(([id, row]) => rowToMessage(id, row));

    return messages
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(-limit);
  },

  getAllMessages: (): ConversationMessage[] => {
    if (!isInitialized) return [];

    const table = store.getTable('messages');
    if (!table) return [];

    return Object.entries(table)
      .map(([id, row]) => rowToMessage(id, row))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  },

  clearAll: () => {
    if (!isInitialized) return;
    store.delTable('messages');
  },
};
