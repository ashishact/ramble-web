/**
 * Knowledge Store - Nodes and Relationships
 *
 * Uses TinyBase with IndexedDB persistence for knowledge graph data.
 */

import { createStore, type Store } from 'tinybase';
import { createIndexedDbPersister, type IndexedDbPersister } from 'tinybase/persisters/persister-indexed-db';

export interface KnowledgeNode {
  id: number;
  title: string;
  content: string;
  tags: string[];
  icon?: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface KnowledgeRelationship {
  id: number;
  sourceNodeId: number;
  targetNodeId: number;
  description: string;
  createdBy: string;
  createdAt: string;
}

// TinyBase store and persister
let store: Store;
let persister: IndexedDbPersister;
let isInitialized = false;
let initPromise: Promise<void> | null = null;

// Listeners for reactive updates
type NodeListener = (nodes: KnowledgeNode[]) => void;
type RelationshipListener = (relationships: KnowledgeRelationship[]) => void;
const nodeListeners = new Set<NodeListener>();
const relationshipListeners = new Set<RelationshipListener>();

const notifyNodeListeners = () => {
  const nodes = knowledgeHelpers.getAllNodes();
  nodeListeners.forEach(listener => listener(nodes));
};

const notifyRelationshipListeners = () => {
  const relationships = knowledgeHelpers.getAllRelationships();
  relationshipListeners.forEach(listener => listener(relationships));
};

// Initialize TinyBase store with IndexedDB
const initStore = async (): Promise<void> => {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    store = createStore();
    persister = createIndexedDbPersister(store, 'amigoz-knowledge');

    // Load existing data from IndexedDB
    await persister.load();

    // Start auto-saving changes
    await persister.startAutoSave();

    // Listen for changes
    store.addTableListener('nodes', () => notifyNodeListeners());
    store.addTableListener('relationships', () => notifyRelationshipListeners());

    isInitialized = true;
    console.log('[KnowledgeStore] Initialized with IndexedDB');

    // Initialize sample data if empty
    knowledgeHelpers.initializeSampleData();
  })();

  return initPromise;
};

// Initialize immediately
initStore();

// Convert TinyBase row to KnowledgeNode
const rowToNode = (rowId: string, row: Record<string, unknown>): KnowledgeNode => ({
  id: parseInt(rowId, 10),
  title: row.title as string,
  content: row.content as string,
  tags: JSON.parse((row.tags as string) || '[]'),
  icon: row.icon as string | undefined,
  createdBy: row.createdBy as string,
  createdAt: row.createdAt as string,
  updatedAt: row.updatedAt as string | undefined,
});

// Convert TinyBase row to KnowledgeRelationship
const rowToRelationship = (rowId: string, row: Record<string, unknown>): KnowledgeRelationship => ({
  id: parseInt(rowId, 10),
  sourceNodeId: row.sourceNodeId as number,
  targetNodeId: row.targetNodeId as number,
  description: row.description as string,
  createdBy: row.createdBy as string,
  createdAt: row.createdAt as string,
});

// Get next ID for nodes/relationships
const getNextNodeId = (): number => {
  if (!isInitialized) return 1;
  const table = store.getTable('nodes');
  if (!table || Object.keys(table).length === 0) return 1;
  const ids = Object.keys(table).map(id => parseInt(id, 10));
  return Math.max(...ids) + 1;
};

const getNextRelationshipId = (): number => {
  if (!isInitialized) return 1;
  const table = store.getTable('relationships');
  if (!table || Object.keys(table).length === 0) return 1;
  const ids = Object.keys(table).map(id => parseInt(id, 10));
  return Math.max(...ids) + 1;
};

// Helper functions
export const knowledgeHelpers = {
  ensureReady: async (): Promise<void> => {
    await initStore();
  },

  subscribeToNodes: (listener: NodeListener): (() => void) => {
    nodeListeners.add(listener);
    if (isInitialized) {
      listener(knowledgeHelpers.getAllNodes());
    }
    return () => nodeListeners.delete(listener);
  },

  subscribeToRelationships: (listener: RelationshipListener): (() => void) => {
    relationshipListeners.add(listener);
    if (isInitialized) {
      listener(knowledgeHelpers.getAllRelationships());
    }
    return () => relationshipListeners.delete(listener);
  },

  createNode: (data: Omit<KnowledgeNode, 'id' | 'createdAt'>): KnowledgeNode => {
    if (!isInitialized) {
      console.warn('[KnowledgeStore] Not initialized yet');
      return { id: 0, ...data, createdAt: new Date().toISOString() } as KnowledgeNode;
    }

    const id = getNextNodeId();
    const node: KnowledgeNode = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
    };

    store.setRow('nodes', String(id), {
      title: node.title,
      content: node.content,
      tags: JSON.stringify(node.tags || []),
      icon: node.icon || '',
      createdBy: node.createdBy,
      createdAt: node.createdAt,
    });

    return node;
  },

  updateNode: (id: number, updates: Partial<Omit<KnowledgeNode, 'id' | 'createdAt'>>) => {
    if (!isInitialized) return;

    const rowId = String(id);
    if (updates.title !== undefined) store.setCell('nodes', rowId, 'title', updates.title);
    if (updates.content !== undefined) store.setCell('nodes', rowId, 'content', updates.content);
    if (updates.tags !== undefined) store.setCell('nodes', rowId, 'tags', JSON.stringify(updates.tags));
    if (updates.icon !== undefined) store.setCell('nodes', rowId, 'icon', updates.icon);
    store.setCell('nodes', rowId, 'updatedAt', new Date().toISOString());
  },

  deleteNode: (id: number) => {
    if (!isInitialized) return;

    store.delRow('nodes', String(id));

    // Delete related relationships
    const relationships = knowledgeHelpers.getAllRelationships();
    relationships.forEach(rel => {
      if (rel.sourceNodeId === id || rel.targetNodeId === id) {
        store.delRow('relationships', String(rel.id));
      }
    });
  },

  getNode: (id: number): KnowledgeNode | undefined => {
    if (!isInitialized) return undefined;

    const row = store.getRow('nodes', String(id));
    if (!row || Object.keys(row).length === 0) return undefined;
    return rowToNode(String(id), row);
  },

  getAllNodes: (): KnowledgeNode[] => {
    if (!isInitialized) return [];

    const table = store.getTable('nodes');
    if (!table) return [];

    return Object.entries(table).map(([id, row]) => rowToNode(id, row));
  },

  createRelationship: (data: Omit<KnowledgeRelationship, 'id' | 'createdAt'>): KnowledgeRelationship => {
    if (!isInitialized) {
      console.warn('[KnowledgeStore] Not initialized yet');
      return { id: 0, ...data, createdAt: new Date().toISOString() } as KnowledgeRelationship;
    }

    const id = getNextRelationshipId();
    const relationship: KnowledgeRelationship = {
      ...data,
      id,
      createdAt: new Date().toISOString(),
    };

    store.setRow('relationships', String(id), {
      sourceNodeId: relationship.sourceNodeId,
      targetNodeId: relationship.targetNodeId,
      description: relationship.description,
      createdBy: relationship.createdBy,
      createdAt: relationship.createdAt,
    });

    return relationship;
  },

  deleteRelationship: (id: number) => {
    if (!isInitialized) return;
    store.delRow('relationships', String(id));
  },

  getNodeRelationships: (nodeId: number): KnowledgeRelationship[] => {
    if (!isInitialized) return [];

    return knowledgeHelpers.getAllRelationships().filter(
      rel => rel.sourceNodeId === nodeId || rel.targetNodeId === nodeId
    );
  },

  getAllRelationships: (): KnowledgeRelationship[] => {
    if (!isInitialized) return [];

    const table = store.getTable('relationships');
    if (!table) return [];

    return Object.entries(table).map(([id, row]) => rowToRelationship(id, row));
  },

  getRelatedNodes: (nodeId: number): Array<KnowledgeNode & { relationshipDescription: string; relationshipType: 'outgoing' | 'incoming' }> => {
    const relationships = knowledgeHelpers.getNodeRelationships(nodeId);
    const relatedNodes: Array<KnowledgeNode & { relationshipDescription: string; relationshipType: 'outgoing' | 'incoming' }> = [];

    relationships.forEach(rel => {
      if (rel.sourceNodeId === nodeId) {
        const targetNode = knowledgeHelpers.getNode(rel.targetNodeId);
        if (targetNode) {
          relatedNodes.push({
            ...targetNode,
            relationshipDescription: rel.description,
            relationshipType: 'outgoing',
          });
        }
      } else if (rel.targetNodeId === nodeId) {
        const sourceNode = knowledgeHelpers.getNode(rel.sourceNodeId);
        if (sourceNode) {
          relatedNodes.push({
            ...sourceNode,
            relationshipDescription: rel.description,
            relationshipType: 'incoming',
          });
        }
      }
    });

    return relatedNodes;
  },

  searchNodes: (query: string, limit = 10): KnowledgeNode[] => {
    const lowerQuery = query.toLowerCase();
    return knowledgeHelpers.getAllNodes()
      .filter(node =>
        node.title.toLowerCase().includes(lowerQuery) ||
        node.content.toLowerCase().includes(lowerQuery) ||
        node.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
      )
      .slice(0, limit);
  },

  semanticSearch: (query: string, limit = 20): Array<KnowledgeNode & { similarity: number }> => {
    const lowerQuery = query.toLowerCase();
    const words = lowerQuery.split(/\s+/).filter(w => w.length > 2);

    return knowledgeHelpers.getAllNodes()
      .map(node => {
        const text = `${node.title} ${node.content} ${node.tags.join(' ')}`.toLowerCase();
        const matchCount = words.filter(word => text.includes(word)).length;
        const similarity = words.length > 0 ? matchCount / words.length : 0;
        return { ...node, similarity };
      })
      .filter(node => node.similarity > 0)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  },

  initializeSampleData: () => {
    if (!isInitialized) return;
    const nodes = knowledgeHelpers.getAllNodes();
    if (nodes.length > 0) return;

    const sampleNodes = [
      { title: 'Getting Started', content: 'Welcome to the knowledge graph. This is a sample node.', tags: ['intro', 'help'], icon: '🚀', createdBy: 'system' },
      { title: 'React Basics', content: 'React is a JavaScript library for building user interfaces.', tags: ['react', 'frontend'], icon: '⚛️', createdBy: 'system' },
      { title: 'TypeScript', content: 'TypeScript is a typed superset of JavaScript.', tags: ['typescript', 'types'], icon: '📘', createdBy: 'system' },
      { title: 'D3.js Visualization', content: 'D3.js is a library for data visualizations.', tags: ['d3', 'visualization'], icon: '📊', createdBy: 'system' },
      { title: 'TailwindCSS', content: 'Tailwind CSS is a utility-first CSS framework.', tags: ['css', 'styling'], icon: '🎨', createdBy: 'system' },
    ];

    const createdNodes: KnowledgeNode[] = [];
    sampleNodes.forEach(data => {
      createdNodes.push(knowledgeHelpers.createNode(data));
    });

    const sampleRels = [
      { sourceNodeId: createdNodes[0].id, targetNodeId: createdNodes[1].id, description: 'introduces', createdBy: 'system' },
      { sourceNodeId: createdNodes[1].id, targetNodeId: createdNodes[2].id, description: 'works well with', createdBy: 'system' },
      { sourceNodeId: createdNodes[1].id, targetNodeId: createdNodes[3].id, description: 'can use', createdBy: 'system' },
      { sourceNodeId: createdNodes[1].id, targetNodeId: createdNodes[4].id, description: 'styled with', createdBy: 'system' },
    ];

    sampleRels.forEach(data => {
      knowledgeHelpers.createRelationship(data);
    });

    console.log('[KnowledgeStore] Sample data initialized');
  },
};
