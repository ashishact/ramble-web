/**
 * Backend Types - Re-exports from TinyBase stores for compatibility
 */

// Re-export from TinyBase stores
export type { KnowledgeNode, KnowledgeRelationship } from '../stores/knowledgeStore';
export type { ConversationMessage } from '../stores/conversationStore';

// Extended types for UI (defined in api.ts)
export type { RelatedKnowledgeNode, SemanticSearchResult } from './api';

// Legacy types for compatibility
export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  isComplete?: boolean;
}

export interface LLMProvider {
  name: 'gemini' | 'anthropic' | 'openai' | 'groq';
  apiKey: string;
  model?: string;
}
