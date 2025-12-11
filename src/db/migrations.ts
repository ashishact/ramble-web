/**
 * WatermelonDB Schema Migrations
 *
 * Handles database SCHEMA changes (columns, tables, indexes).
 * These migrations run automatically when the database opens.
 *
 * ============================================================================
 * MIGRATION STRATEGY - IMPORTANT FOR ALL DEVELOPERS
 * ============================================================================
 *
 * This app is used by many users who may be on ANY version. When pushing a new
 * version, we MUST ensure proper migrations for all users upgrading from any
 * previous version.
 *
 * WHEN TO ADD A MIGRATION:
 * - Adding a new column to an existing table
 * - Creating a new table
 * - Adding/removing indexes
 * - Any structural database change
 *
 * HOW TO ADD A MIGRATION:
 * 1. Bump the version in src/db/schema.ts (appSchema version field)
 * 2. Add a new migration step below with toVersion matching new schema version
 * 3. Update the corresponding Model class in src/db/models/
 * 4. Update the store adapter if needed
 * 5. Test with both fresh install AND upgrade from previous version
 *
 * IMPORTANT RULES:
 * - NEVER remove or modify existing migration steps
 * - ALWAYS add new steps for new versions
 * - Each migration must be idempotent (safe to run multiple times)
 * - Test upgrade paths from ALL previous versions
 *
 * For DATA migrations (business logic changes, cleanups):
 * See src/program/migrations/index.ts
 * ============================================================================
 */

import { schemaMigrations, addColumns } from '@nozbe/watermelondb/Schema/migrations'

export const migrations = schemaMigrations({
  migrations: [
    // -------------------------------------------------------------------------
    // Version 1 -> 2: Fix extraction_programs and observer_programs schemas
    // Added 2024: Missing columns that were in Models but not in initial schema
    // -------------------------------------------------------------------------
    {
      toVersion: 2,
      steps: [
        // Add missing columns to extraction_programs
        addColumns({
          table: 'extraction_programs',
          columns: [
            { name: 'alwaysRun', type: 'boolean' },
            { name: 'llmTemperature', type: 'number', isOptional: true },
            { name: 'llmMaxTokens', type: 'number', isOptional: true },
            { name: 'minConfidence', type: 'number' },
            { name: 'isCore', type: 'boolean' },
            { name: 'claimTypesJson', type: 'string' },
            { name: 'updatedAt', type: 'number' },
            { name: 'avgProcessingTimeMs', type: 'number' },
          ],
        }),
        // Add missing columns to observer_programs
        addColumns({
          table: 'observer_programs',
          columns: [
            { name: 'priority', type: 'number' },
            { name: 'claimTypeFilter', type: 'string', isOptional: true },
            { name: 'usesLlm', type: 'boolean' },
            { name: 'llmTemperature', type: 'number', isOptional: true },
            { name: 'llmMaxTokens', type: 'number', isOptional: true },
            { name: 'shouldRunLogic', type: 'string', isOptional: true },
            { name: 'processLogic', type: 'string', isOptional: true },
            { name: 'isCore', type: 'boolean' },
            { name: 'version', type: 'number' },
            { name: 'updatedAt', type: 'number' },
            { name: 'runCount', type: 'number' },
            { name: 'successRate', type: 'number' },
            { name: 'avgProcessingTimeMs', type: 'number' },
          ],
        }),
      ],
    },

    // -------------------------------------------------------------------------
    // Version 2 -> 3: Goals schema expansion and timestamp standardization
    // Added: Full Goal fields for progress tracking, blockers, motivation
    // -------------------------------------------------------------------------
    {
      toVersion: 3,
      steps: [
        // Add missing columns to goals table
        addColumns({
          table: 'goals',
          columns: [
            { name: 'priority', type: 'number' },
            { name: 'progressType', type: 'string' },
            { name: 'progressValue', type: 'number' },
            { name: 'progressIndicatorsJson', type: 'string' },
            { name: 'blockersJson', type: 'string' },
            { name: 'sourceClaimId', type: 'string' },
            { name: 'motivation', type: 'string', isOptional: true },
            { name: 'deadline', type: 'number', isOptional: true },
          ],
        }),
      ],
    },

    // -------------------------------------------------------------------------
    // Future migrations go here - DO NOT remove or modify migrations above
    // -------------------------------------------------------------------------
  ],
})
