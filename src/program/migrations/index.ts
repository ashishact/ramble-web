/**
 * Migration Registry
 *
 * Central registry of all application-level data migrations.
 *
 * ============================================================================
 * MIGRATION STRATEGY - IMPORTANT FOR ALL DEVELOPERS
 * ============================================================================
 *
 * This app is used by many users who may be on ANY version. When pushing a new
 * version, we MUST ensure proper migrations for all users upgrading from any
 * previous version.
 *
 * There are TWO types of migrations:
 *
 * 1. WatermelonDB SCHEMA Migrations (src/db/migrations.ts)
 *    - Handles database structure changes (add columns, tables, indexes)
 *    - Automatically applied by WatermelonDB on database open
 *    - Version tracked in schema.ts (appSchema version field)
 *    - Example: Adding new columns to extraction_programs table
 *
 * 2. Application DATA Migrations (this file)
 *    - Handles data transformations, cleanups, and business logic changes
 *    - Run manually by user or auto-run on startup if needed
 *    - Version tracked in localStorage ('ramble_migrations')
 *    - Example: Converting old data formats, removing deprecated data
 *
 * WHEN ADDING A NEW MIGRATION:
 *
 * Schema Changes (column/table changes):
 *   1. Update src/db/schema.ts - add/modify tables/columns
 *   2. Bump the version number in appSchema
 *   3. Add migration step to src/db/migrations.ts using addColumns/createTable
 *   4. Update corresponding Model class in src/db/models/
 *   5. Update store adapter if needed
 *
 * Data Changes (business logic, cleanup):
 *   1. Create new file: src/program/migrations/migrations/XXX_description.ts
 *   2. Export migration with version, name, description, up(), and optional down()
 *   3. Add to ALL_MIGRATIONS array below in version order
 *   4. Test with fresh and existing databases
 *
 * NEVER remove old migrations - users upgrading from old versions need them!
 * ============================================================================
 */

export * from './types';
export * from './migrationManager';

// Export all migrations in order
// IMPORTANT: Keep this list in ascending version order
// Never remove migrations - users on old versions need them to upgrade
//
// Example:
// import { migration001 } from './migrations/001_example_migration';
// export const ALL_MIGRATIONS = [migration001];

export const ALL_MIGRATIONS: import('./types').Migration[] = [];
