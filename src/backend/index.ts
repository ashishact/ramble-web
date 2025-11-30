/**
 * Backend Module - Browser-based backend simulation
 *
 * This module provides all backend functionality running directly in the browser.
 * Data is stored in TinyBase with IndexedDB persistence.
 */

export * from './types';
export * from './api';

// Re-export stores from the stores directory
export { knowledgeHelpers } from '../stores/knowledgeStore';
export { conversationHelpers } from '../stores/conversationStore';
export { settingsHelpers } from '../stores/settingsStore';
