/**
 * WatermelonDB Schema
 *
 * Defines all 17 tables for the RAMBLE system
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const schema = appSchema({
  version: 1,
  tables: [
    // Sessions - Conversation sessions
    tableSchema({
      name: 'sessions',
      columns: [
        { name: 'startedAt', type: 'number' },
        { name: 'endedAt', type: 'number', isOptional: true },
        { name: 'unitCount', type: 'number' },
        { name: 'summary', type: 'string', isOptional: true },
        { name: 'moodTrajectoryJson', type: 'string', isOptional: true },
      ]
    }),

    // Conversations - Raw conversation units
    tableSchema({
      name: 'conversations',
      columns: [
        { name: 'sessionId', type: 'string', isIndexed: true },
        { name: 'timestamp', type: 'number', isIndexed: true },
        { name: 'rawText', type: 'string' },
        { name: 'sanitizedText', type: 'string' },
        { name: 'source', type: 'string' }, // 'speech' | 'text'
        { name: 'precedingContextSummary', type: 'string' },
        { name: 'createdAt', type: 'number' },
        { name: 'processed', type: 'boolean' },
      ]
    }),

    // Claims - Core knowledge units (HIGH GROWTH TABLE)
    tableSchema({
      name: 'claims',
      columns: [
        { name: 'statement', type: 'string' },
        { name: 'subject', type: 'string', isIndexed: true },
        { name: 'claimType', type: 'string', isIndexed: true },
        { name: 'temporality', type: 'string' },
        { name: 'abstraction', type: 'string' },
        { name: 'sourceType', type: 'string' },
        { name: 'initialConfidence', type: 'number' },
        { name: 'currentConfidence', type: 'number', isIndexed: true },
        { name: 'state', type: 'string', isIndexed: true },
        { name: 'emotionalValence', type: 'number' },
        { name: 'emotionalIntensity', type: 'number' },
        { name: 'stakes', type: 'string' },
        { name: 'validFrom', type: 'number' },
        { name: 'validUntil', type: 'number', isOptional: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'lastConfirmed', type: 'number', isIndexed: true },
        { name: 'confirmationCount', type: 'number' },
        { name: 'extractionProgramId', type: 'string', isIndexed: true },
        { name: 'supersededBy', type: 'string', isOptional: true },
        { name: 'elaborates', type: 'string', isOptional: true },
        // Memory system fields
        { name: 'memoryTier', type: 'string', isIndexed: true },
        { name: 'salience', type: 'number', isIndexed: true },
        { name: 'promotedAt', type: 'number', isOptional: true },
        { name: 'lastAccessed', type: 'number', isIndexed: true },
      ]
    }),

    // Source Tracking - Claim source attribution (HIGH GROWTH)
    tableSchema({
      name: 'source_tracking',
      columns: [
        { name: 'claimId', type: 'string', isIndexed: true },
        { name: 'unitId', type: 'string', isIndexed: true },
        { name: 'unitText', type: 'string' },
        { name: 'textExcerpt', type: 'string' },
        { name: 'charStart', type: 'number', isOptional: true },
        { name: 'charEnd', type: 'number', isOptional: true },
        { name: 'patternId', type: 'string', isOptional: true },
        { name: 'llmPrompt', type: 'string' },
        { name: 'llmResponse', type: 'string' },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Claim Sources - Many-to-many mapping (claims <-> conversation units)
    tableSchema({
      name: 'claim_sources',
      columns: [
        { name: 'claimId', type: 'string', isIndexed: true },
        { name: 'unitId', type: 'string', isIndexed: true },
      ]
    }),

    // Entities - Named entities
    tableSchema({
      name: 'entities',
      columns: [
        { name: 'canonicalName', type: 'string', isIndexed: true },
        { name: 'entityType', type: 'string', isIndexed: true },
        { name: 'aliases', type: 'string' }, // JSON array
        { name: 'createdAt', type: 'number' },
        { name: 'lastReferenced', type: 'number', isIndexed: true },
        { name: 'mentionCount', type: 'number', isIndexed: true },
      ]
    }),

    // Goals - User goals and objectives
    tableSchema({
      name: 'goals',
      columns: [
        { name: 'statement', type: 'string' },
        { name: 'goalType', type: 'string', isIndexed: true },
        { name: 'timeframe', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'progressValue', type: 'number' },
        { name: 'priority', type: 'string' },
        { name: 'createdAt', type: 'number' },
        { name: 'achievedAt', type: 'number', isOptional: true },
        { name: 'parentGoalId', type: 'string', isOptional: true, isIndexed: true },
      ]
    }),

    // Observer Outputs - Results from observer analysis
    tableSchema({
      name: 'observer_outputs',
      columns: [
        { name: 'observerType', type: 'string', isIndexed: true },
        { name: 'outputType', type: 'string', isIndexed: true },
        { name: 'contentJson', type: 'string' },
        { name: 'sourceClaimsJson', type: 'string' },
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'sessionId', type: 'string', isIndexed: true },
      ]
    }),

    // Contradictions - Detected contradictions between claims
    tableSchema({
      name: 'contradictions',
      columns: [
        { name: 'claimAId', type: 'string', isIndexed: true },
        { name: 'claimBId', type: 'string', isIndexed: true },
        { name: 'resolutionType', type: 'string', isOptional: true },
        { name: 'resolutionExplanation', type: 'string', isOptional: true },
        { name: 'resolved', type: 'boolean', isIndexed: true },
        { name: 'createdAt', type: 'number' },
        { name: 'resolvedAt', type: 'number', isOptional: true },
      ]
    }),

    // Patterns - Detected behavior patterns
    tableSchema({
      name: 'patterns',
      columns: [
        { name: 'patternType', type: 'string', isIndexed: true },
        { name: 'description', type: 'string' },
        { name: 'evidenceClaimsJson', type: 'string' }, // JSON array of claim IDs
        { name: 'occurrenceCount', type: 'number' },
        { name: 'confidence', type: 'number' },
        { name: 'createdAt', type: 'number' },
        { name: 'lastObserved', type: 'number', isIndexed: true },
      ]
    }),

    // Values - User-expressed values
    tableSchema({
      name: 'values',
      columns: [
        { name: 'statement', type: 'string' },
        { name: 'domain', type: 'string', isIndexed: true },
        { name: 'importance', type: 'number' },
        { name: 'sourceClaimId', type: 'string', isIndexed: true },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Extraction Programs - LLM-based extraction configurations
    tableSchema({
      name: 'extraction_programs',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'type', type: 'string' }, // 'pattern' | 'llm'
        { name: 'version', type: 'number' },
        { name: 'active', type: 'boolean', isIndexed: true },
        { name: 'patternsJson', type: 'string', isOptional: true },
        { name: 'promptTemplate', type: 'string', isOptional: true },
        { name: 'outputSchemaJson', type: 'string', isOptional: true },
        { name: 'llmTier', type: 'string', isOptional: true },
        { name: 'priority', type: 'number' },
        { name: 'createdAt', type: 'number' },
        { name: 'lastUsed', type: 'number', isOptional: true },
        { name: 'runCount', type: 'number' },
        { name: 'successRate', type: 'number' },
      ]
    }),

    // Observer Programs - Observer pipeline configurations
    tableSchema({
      name: 'observer_programs',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'description', type: 'string' },
        { name: 'active', type: 'boolean', isIndexed: true },
        { name: 'triggers', type: 'string' }, // JSON array
        { name: 'llmTier', type: 'string', isOptional: true },
        { name: 'promptTemplate', type: 'string', isOptional: true },
        { name: 'outputSchemaJson', type: 'string', isOptional: true },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Extensions - Plugin-style extensions
    tableSchema({
      name: 'extensions',
      columns: [
        { name: 'extensionType', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'configJson', type: 'string' },
        { name: 'systemPrompt', type: 'string', isOptional: true },
        { name: 'userPromptTemplate', type: 'string', isOptional: true },
        { name: 'llmTier', type: 'string', isOptional: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'createdAt', type: 'number' },
        { name: 'lastUsed', type: 'number', isOptional: true },
      ]
    }),

    // Synthesis Cache - Cached synthesized insights
    tableSchema({
      name: 'synthesis_cache',
      columns: [
        { name: 'synthesisType', type: 'string', isIndexed: true },
        { name: 'cacheKey', type: 'string', isIndexed: true },
        { name: 'contentJson', type: 'string' },
        { name: 'sourceClaimsJson', type: 'string' },
        { name: 'ttlSeconds', type: 'number' },
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'stale', type: 'boolean', isIndexed: true },
      ]
    }),

    // Corrections - Text correction mappings
    tableSchema({
      name: 'corrections',
      columns: [
        { name: 'wrongText', type: 'string', isIndexed: true },
        { name: 'correctText', type: 'string' },
        { name: 'originalCase', type: 'string' },
        { name: 'usageCount', type: 'number' },
        { name: 'createdAt', type: 'number' },
        { name: 'lastUsed', type: 'number', isOptional: true },
      ]
    }),

    // Tasks - Durable task queue
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'taskType', type: 'string', isIndexed: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'priority', type: 'number', isIndexed: true },
        { name: 'payloadJson', type: 'string' },
        { name: 'resultJson', type: 'string', isOptional: true },
        { name: 'errorMessage', type: 'string', isOptional: true },
        { name: 'attempts', type: 'number' },
        { name: 'maxAttempts', type: 'number' },
        { name: 'backoffConfigJson', type: 'string' },
        { name: 'checkpointJson', type: 'string', isOptional: true },
        { name: 'sessionId', type: 'string', isOptional: true, isIndexed: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'startedAt', type: 'number', isOptional: true },
        { name: 'completedAt', type: 'number', isOptional: true },
        { name: 'nextRetryAt', type: 'number', isOptional: true, isIndexed: true },
      ]
    }),
  ]
})
