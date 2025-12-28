/**
 * WatermelonDB Schema Migrations
 *
 * Fresh start with v1 - all tables defined in schema.ts
 * No migrations needed for initial setup.
 *
 * ============================================================================
 * MIGRATION STRATEGY - IMPORTANT FOR ALL DEVELOPERS
 * ============================================================================
 *
 * When adding new columns/tables in the future:
 * 1. Bump the version in src/db/schema.ts
 * 2. Add a migration step here with toVersion matching new schema version
 * 3. Update the corresponding Model class in src/db/models/
 *
 * IMPORTANT RULES:
 * - NEVER remove or modify existing migration steps
 * - ALWAYS add new steps for new versions
 * - Test upgrade paths
 * ============================================================================
 */

import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

export const migrations = schemaMigrations({
  migrations: [
    // Fresh start - all tables defined in schema.ts v1
    // Future migrations go here
  ],
})
