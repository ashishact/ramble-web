/**
 * Stores - Central data management
 *
 * Architecture:
 * - Plain localStorage for persistence
 * - In-memory caching for real-time performance
 * - Simple subscription pattern for reactive updates
 */

export {
  conversationHelpers,
  type ConversationMessage,
} from './conversationStore';

export {
  knowledgeHelpers,
  type KnowledgeNode,
  type KnowledgeRelationship,
} from './knowledgeStore';

export {
  settingsHelpers,
  type AppSettings,
} from './settingsStore';
