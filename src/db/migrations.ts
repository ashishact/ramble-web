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

import { schemaMigrations, createTable } from '@nozbe/watermelondb/Schema/migrations'

export const migrations = schemaMigrations({
  migrations: [
    // v2: Add extraction_traces table for debug/tracing
    {
      toVersion: 2,
      steps: [
        createTable({
          name: 'extraction_traces',
          columns: [
            { name: 'targetType', type: 'string', isIndexed: true },
            { name: 'targetId', type: 'string', isIndexed: true },
            { name: 'conversationId', type: 'string', isIndexed: true },
            { name: 'inputText', type: 'string' },
            { name: 'spanId', type: 'string', isOptional: true },
            { name: 'charStart', type: 'number', isOptional: true },
            { name: 'charEnd', type: 'number', isOptional: true },
            { name: 'matchedPattern', type: 'string', isOptional: true },
            { name: 'matchedText', type: 'string', isOptional: true },
            { name: 'llmPrompt', type: 'string', isOptional: true },
            { name: 'llmResponse', type: 'string', isOptional: true },
            { name: 'llmModel', type: 'string', isOptional: true },
            { name: 'llmTokensUsed', type: 'number', isOptional: true },
            { name: 'processingTimeMs', type: 'number' },
            { name: 'extractorId', type: 'string', isOptional: true },
            { name: 'error', type: 'string', isOptional: true },
            { name: 'createdAt', type: 'number', isIndexed: true },
          ],
        }),
      ],
    },
    // v3: Add entity_mentions table for Layer 1 entity references
    {
      toVersion: 3,
      steps: [
        createTable({
          name: 'entity_mentions',
          columns: [
            { name: 'text', type: 'string' },
            { name: 'mentionType', type: 'string' },
            { name: 'suggestedType', type: 'string' },
            { name: 'spanId', type: 'string', isIndexed: true },
            { name: 'conversationId', type: 'string', isIndexed: true },
            { name: 'resolvedEntityId', type: 'string', isOptional: true, isIndexed: true },
            { name: 'createdAt', type: 'number', isIndexed: true },
          ],
        }),
      ],
    },
    // v4: Add vocabulary table for STT entity spelling correction
    {
      toVersion: 4,
      steps: [
        createTable({
          name: 'vocabulary',
          columns: [
            { name: 'correctSpelling', type: 'string', isIndexed: true },
            { name: 'entityType', type: 'string', isIndexed: true },
            { name: 'contextHints', type: 'string' },
            { name: 'phoneticPrimary', type: 'string', isIndexed: true },
            { name: 'phoneticSecondary', type: 'string', isOptional: true },
            { name: 'usageCount', type: 'number' },
            { name: 'variantCountsJson', type: 'string' },
            { name: 'createdAt', type: 'number' },
            { name: 'lastUsed', type: 'number', isOptional: true },
            { name: 'sourceEntityId', type: 'string', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
  ],
})
