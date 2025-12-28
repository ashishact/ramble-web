/**
 * Stores - Central data management
 *
 * Architecture:
 * - Plain localStorage for persistence
 * - In-memory caching for real-time performance
 * - Simple subscription pattern for reactive updates
 *
 * Note: conversationStore and knowledgeStore have been replaced by WatermelonDB.
 * Only settingsStore remains for UI settings persistence.
 */

export {
  settingsHelpers,
  type AppSettings,
} from './settingsStore';
