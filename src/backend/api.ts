/**
 * API Module - Function-based API for knowledge operations
 *
 * This provides a compatibility layer that uses the TinyBase stores.
 * All functions return Promises to maintain compatibility with async patterns.
 */

import { knowledgeHelpers, type KnowledgeNode, type KnowledgeRelationship } from '../stores/knowledgeStore';
import { settingsHelpers } from '../stores/settingsStore';

// Extended types for UI
export interface RelatedKnowledgeNode extends KnowledgeNode {
  relationshipDescription: string;
  relationshipType: 'outgoing' | 'incoming';
}

export interface SemanticSearchResult extends KnowledgeNode {
  similarity: number;
}

// Re-export types for convenience
export type { KnowledgeNode, KnowledgeRelationship };

// Node API

/**
 * Get the current node
 */
export async function fetchCurrentNode(): Promise<KnowledgeNode | null> {
  await knowledgeHelpers.ensureReady();
  const currentNodeId = settingsHelpers.getCurrentNodeId();
  if (!currentNodeId) return null;
  return knowledgeHelpers.getNode(currentNodeId) ?? null;
}

/**
 * Set the current node by ID
 */
export async function selectNode(nodeId: number): Promise<KnowledgeNode | null> {
  await knowledgeHelpers.ensureReady();
  settingsHelpers.setCurrentNodeId(nodeId);
  return knowledgeHelpers.getNode(nodeId) ?? null;
}

/**
 * Get a node by ID
 */
export async function fetchNodeById(nodeId: number): Promise<KnowledgeNode | null> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.getNode(nodeId) ?? null;
}

/**
 * Get all nodes
 */
export async function fetchAllNodes(): Promise<KnowledgeNode[]> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.getAllNodes();
}

/**
 * Create a new node
 */
export async function createNode(data: Omit<KnowledgeNode, 'id' | 'createdAt'>): Promise<KnowledgeNode> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.createNode(data);
}

/**
 * Update a node
 */
export async function updateNode(id: number, data: Partial<KnowledgeNode>): Promise<KnowledgeNode | null> {
  await knowledgeHelpers.ensureReady();
  knowledgeHelpers.updateNode(id, data);
  return knowledgeHelpers.getNode(id) ?? null;
}

/**
 * Delete a node
 */
export async function deleteNode(id: number): Promise<boolean> {
  await knowledgeHelpers.ensureReady();
  const exists = knowledgeHelpers.getNode(id);
  if (exists) {
    knowledgeHelpers.deleteNode(id);
    return true;
  }
  return false;
}

// Relationship API

/**
 * Get relationships for a node (for D3 graph)
 */
export async function fetchNodeRelationships(nodeId: number): Promise<KnowledgeRelationship[]> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.getNodeRelationships(nodeId);
}

/**
 * Get related nodes (with relationship info)
 */
export async function fetchRelatedNodes(nodeId: number): Promise<RelatedKnowledgeNode[]> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.getRelatedNodes(nodeId);
}

/**
 * Create a relationship between nodes
 */
export async function createRelationship(
  data: Omit<KnowledgeRelationship, 'id' | 'createdAt'>
): Promise<KnowledgeRelationship> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.createRelationship(data);
}

/**
 * Delete a relationship
 */
export async function deleteRelationship(id: number): Promise<boolean> {
  await knowledgeHelpers.ensureReady();
  knowledgeHelpers.deleteRelationship(id);
  return true;
}

// Search API

/**
 * Full-text search for nodes
 */
export async function searchNodes(query: string, limit: number = 10): Promise<KnowledgeNode[]> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.searchNodes(query, limit);
}

/**
 * Semantic search for nodes
 */
export async function semanticSearch(query: string, limit: number = 20): Promise<SemanticSearchResult[]> {
  await knowledgeHelpers.ensureReady();
  return knowledgeHelpers.semanticSearch(query, limit);
}

// Utility

/**
 * Reset the knowledge store to sample data (clears and re-initializes)
 */
export async function resetKnowledgeStore(): Promise<void> {
  await knowledgeHelpers.ensureReady();
  // Clear all data and re-initialize sample data
  const allNodes = knowledgeHelpers.getAllNodes();
  allNodes.forEach(node => knowledgeHelpers.deleteNode(node.id));
  knowledgeHelpers.initializeSampleData();
}
