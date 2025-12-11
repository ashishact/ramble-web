/**
 * Migration Registry
 *
 * Central registry of all database migrations
 */

export * from './types';
export * from './migrationManager';

// Import all migrations
import { migration001 } from './migrations/001_remove_thought_chains';

// Export all migrations in order
export const ALL_MIGRATIONS = [
  migration001,
];
