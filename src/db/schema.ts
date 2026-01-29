/**
 * WatermelonDB Schema v1 - Core Loop Architecture
 *
 * DATABASE NAME: ramble_v3
 *
 * Philosophy:
 * - Everything has TEMPORALITY (when true, when last reinforced)
 * - Searchable structured data
 * - Plugin-based extraction (JSON in DB)
 * - Simple event loop: input → search → LLM → update → save
 *
 * Tables:
 * - CORE: sessions, conversations, tasks (durable execution)
 * - KNOWLEDGE: entities, topics, memories, goals
 * - SYSTEM: plugins, extraction_logs, corrections
 *
 * Fresh start - no migrations needed.
 * Includes summary column for conversation summaries.
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb'
import { createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

// Database name - fresh start
export const DATABASE_NAME = 'ramble_v3'

export const schema = appSchema({
  version: 3,
  tables: [
    // ========================================================================
    // CORE - Foundation (Keep from v4)
    // ========================================================================

    // Sessions - Conversation sessions
    tableSchema({
      name: 'sessions',
      columns: [
        { name: 'startedAt', type: 'number', isIndexed: true },
        { name: 'endedAt', type: 'number', isOptional: true },
        { name: 'unitCount', type: 'number' },
        { name: 'summary', type: 'string', isOptional: true },
        { name: 'metadata', type: 'string' },  // JSON for flexible data
      ]
    }),

    // Conversations - Raw input units (immutable ground truth)
    tableSchema({
      name: 'conversations',
      columns: [
        { name: 'sessionId', type: 'string', isIndexed: true },
        { name: 'timestamp', type: 'number', isIndexed: true },
        { name: 'rawText', type: 'string' },
        { name: 'sanitizedText', type: 'string' },
        { name: 'summary', type: 'string', isOptional: true },  // LLM-generated summary for large texts
        { name: 'source', type: 'string' },      // 'speech' | 'text'
        { name: 'speaker', type: 'string' },      // 'user' | 'agent'
        { name: 'processed', type: 'boolean', isIndexed: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
      ]
    }),

    // Tasks - Durable execution queue (Keep from v4)
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'taskType', type: 'string', isIndexed: true },
        { name: 'status', type: 'string', isIndexed: true },  // pending, running, completed, failed
        { name: 'priority', type: 'number', isIndexed: true },
        { name: 'payload', type: 'string' },        // JSON
        { name: 'result', type: 'string', isOptional: true },  // JSON
        { name: 'attempts', type: 'number' },
        { name: 'maxAttempts', type: 'number' },
        { name: 'lastError', type: 'string', isOptional: true },
        { name: 'checkpoint', type: 'string', isOptional: true },  // JSON for resumable state
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'startedAt', type: 'number', isOptional: true },
        { name: 'completedAt', type: 'number', isOptional: true },
        { name: 'scheduledAt', type: 'number', isIndexed: true },  // When to execute
        { name: 'sessionId', type: 'string', isOptional: true, isIndexed: true },
      ]
    }),

    // ========================================================================
    // KNOWLEDGE - Core knowledge graph with temporality
    // ========================================================================

    // Entities - Named entities (people, places, things, concepts)
    tableSchema({
      name: 'entities',
      columns: [
        { name: 'name', type: 'string', isIndexed: true },
        { name: 'type', type: 'string', isIndexed: true },  // person, organization, place, project, concept, etc.
        { name: 'aliases', type: 'string' },        // JSON array of alternative names
        { name: 'description', type: 'string', isOptional: true },
        // Temporality
        { name: 'firstMentioned', type: 'number', isIndexed: true },
        { name: 'lastMentioned', type: 'number', isIndexed: true },
        { name: 'mentionCount', type: 'number', isIndexed: true },
        // Flexible metadata
        { name: 'metadata', type: 'string' },       // JSON for attributes, relationships, etc.
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Topics - Themes/subjects being discussed
    tableSchema({
      name: 'topics',
      columns: [
        { name: 'name', type: 'string', isIndexed: true },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'category', type: 'string', isOptional: true, isIndexed: true },  // work, personal, health, etc.
        { name: 'entityIds', type: 'string' },      // JSON array of related entity IDs
        // Temporality
        { name: 'firstMentioned', type: 'number', isIndexed: true },
        { name: 'lastMentioned', type: 'number', isIndexed: true },
        { name: 'mentionCount', type: 'number', isIndexed: true },
        // Flexible metadata
        { name: 'metadata', type: 'string' },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Memories - Working memory items (facts, beliefs, concerns, etc.)
    tableSchema({
      name: 'memories',
      columns: [
        { name: 'content', type: 'string' },        // The actual memory/fact
        { name: 'type', type: 'string', isIndexed: true },  // LLM-generated: fact, belief, goal, concern, preference, etc.
        { name: 'subject', type: 'string', isOptional: true, isIndexed: true },  // Who/what this is about
        // Links
        { name: 'entityIds', type: 'string' },      // JSON array
        { name: 'topicIds', type: 'string' },       // JSON array
        { name: 'sourceConversationIds', type: 'string' },  // JSON array - provenance
        // Scoring
        { name: 'confidence', type: 'number' },     // 0-1
        { name: 'importance', type: 'number', isIndexed: true },  // 0-1, for prioritization
        // Temporal validity - when is this TRUE
        { name: 'validFrom', type: 'number', isOptional: true },
        { name: 'validUntil', type: 'number', isOptional: true },
        // Temporality - when was this EXPRESSED/REINFORCED
        { name: 'firstExpressed', type: 'number', isIndexed: true },
        { name: 'lastReinforced', type: 'number', isIndexed: true },
        { name: 'reinforcementCount', type: 'number' },
        // Versioning
        { name: 'supersededBy', type: 'string', isOptional: true, isIndexed: true },  // If updated by new memory
        { name: 'supersedes', type: 'string', isOptional: true },  // What this replaces
        // Metadata
        { name: 'metadata', type: 'string' },       // JSON for emotions, stakes, etc.
        { name: 'createdAt', type: 'number', isIndexed: true },
      ]
    }),

    // Goals - User goals and objectives
    tableSchema({
      name: 'goals',
      columns: [
        { name: 'statement', type: 'string' },
        { name: 'type', type: 'string', isIndexed: true },  // LLM-generated
        { name: 'status', type: 'string', isIndexed: true },  // active, achieved, abandoned, blocked
        { name: 'progress', type: 'number' },       // 0-100
        { name: 'parentGoalId', type: 'string', isOptional: true, isIndexed: true },
        // Links
        { name: 'entityIds', type: 'string' },      // JSON array
        { name: 'topicIds', type: 'string' },       // JSON array
        { name: 'memoryIds', type: 'string' },      // JSON array - supporting memories
        // Temporality
        { name: 'firstExpressed', type: 'number', isIndexed: true },
        { name: 'lastReferenced', type: 'number', isIndexed: true },
        { name: 'achievedAt', type: 'number', isOptional: true },
        { name: 'deadline', type: 'number', isOptional: true },
        // Metadata
        { name: 'metadata', type: 'string' },       // JSON for motivation, blockers, milestones
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // ========================================================================
    // SYSTEM - Infrastructure
    // ========================================================================

    // Plugins - Extractor/observer plugins (JSON-based)
    tableSchema({
      name: 'plugins',
      columns: [
        { name: 'name', type: 'string', isIndexed: true },
        { name: 'description', type: 'string' },
        { name: 'type', type: 'string', isIndexed: true },  // extractor, observer, validator
        { name: 'version', type: 'number' },
        { name: 'active', type: 'boolean', isIndexed: true },
        // Trigger conditions
        { name: 'triggers', type: 'string' },       // JSON: { patterns: [...], conditions: {...} }
        { name: 'alwaysRun', type: 'boolean' },     // Run on every input regardless of triggers
        // LLM configuration
        { name: 'promptTemplate', type: 'string', isOptional: true },
        { name: 'systemPrompt', type: 'string', isOptional: true },
        { name: 'outputSchema', type: 'string', isOptional: true },  // JSON schema for structured output
        { name: 'llmTier', type: 'string', isOptional: true },  // cheap, balanced, quality
        { name: 'llmConfig', type: 'string', isOptional: true },  // JSON: temperature, maxTokens, etc.
        // Stats
        { name: 'runCount', type: 'number' },
        { name: 'successCount', type: 'number' },
        { name: 'avgProcessingTimeMs', type: 'number' },
        // Meta
        { name: 'isCore', type: 'boolean' },        // Built-in vs user-defined
        { name: 'createdAt', type: 'number' },
        { name: 'updatedAt', type: 'number' },
        { name: 'lastUsed', type: 'number', isOptional: true },
      ]
    }),

    // Corrections - STT corrections (Keep from v4)
    tableSchema({
      name: 'corrections',
      columns: [
        { name: 'wrongText', type: 'string', isIndexed: true },
        { name: 'correctText', type: 'string' },
        { name: 'originalCase', type: 'string' },
        { name: 'usageCount', type: 'number' },
        { name: 'createdAt', type: 'number' },
        { name: 'lastUsed', type: 'number', isOptional: true },
        { name: 'sourceConversationId', type: 'string', isOptional: true },
      ]
    }),

    // Learned Corrections - Context-aware STT corrections (v2)
    // Tracks corrections with surrounding context for smarter matching
    tableSchema({
      name: 'learned_corrections',
      columns: [
        { name: 'original', type: 'string', isIndexed: true },     // The wrong word/phrase
        { name: 'corrected', type: 'string' },                      // What it was corrected to
        { name: 'leftContext', type: 'string' },                    // JSON array of 3 words before
        { name: 'rightContext', type: 'string' },                   // JSON array of 3 words after
        { name: 'count', type: 'number' },                          // Times this exact correction was made
        { name: 'confidence', type: 'number' },                     // Calculated confidence score
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'lastUsedAt', type: 'number', isOptional: true },
      ]
    }),

    // ========================================================================
    // DEBUG - Tracing and logging
    // ========================================================================

    // Extraction Logs - Simple trace for debugging
    tableSchema({
      name: 'extraction_logs',
      columns: [
        { name: 'pluginId', type: 'string', isIndexed: true },
        { name: 'conversationId', type: 'string', isIndexed: true },
        { name: 'sessionId', type: 'string', isOptional: true, isIndexed: true },
        // Input/Output
        { name: 'inputText', type: 'string' },
        { name: 'outputJson', type: 'string' },     // What was extracted
        // LLM details (if used)
        { name: 'llmPrompt', type: 'string', isOptional: true },
        { name: 'llmResponse', type: 'string', isOptional: true },
        { name: 'llmModel', type: 'string', isOptional: true },
        { name: 'tokensUsed', type: 'number', isOptional: true },
        // Performance
        { name: 'processingTimeMs', type: 'number' },
        { name: 'success', type: 'boolean', isIndexed: true },
        { name: 'error', type: 'string', isOptional: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
      ]
    }),

    // ========================================================================
    // DATA - Flexible key-value storage (v3)
    // ========================================================================

    // Data - Generic data storage for app data without frequent migrations
    // Used for: onboarding status, user profile, feature flags, etc.
    tableSchema({
      name: 'data',
      columns: [
        { name: 'key', type: 'string', isIndexed: true },      // Unique key (e.g., "onboarding", "user_profile")
        { name: 'dataType', type: 'string', isIndexed: true }, // Category (e.g., "system", "user", "feature")
        { name: 'value', type: 'string' },                      // JSON string
        { name: 'createdAt', type: 'number' },
        { name: 'updatedAt', type: 'number' },
      ]
    }),
  ]
})

// Migrations - IMPORTANT: Only additive changes to preserve data
export const migrations = schemaMigrations({
  migrations: [
    {
      // v1 → v2: Add learned_corrections table
      toVersion: 2,
      steps: [
        createTable({
          name: 'learned_corrections',
          columns: [
            { name: 'original', type: 'string', isIndexed: true },
            { name: 'corrected', type: 'string' },
            { name: 'leftContext', type: 'string' },
            { name: 'rightContext', type: 'string' },
            { name: 'count', type: 'number' },
            { name: 'confidence', type: 'number' },
            { name: 'createdAt', type: 'number', isIndexed: true },
            { name: 'lastUsedAt', type: 'number', isOptional: true },
          ]
        }),
      ],
    },
    {
      // v2 → v3: Add data table for flexible key-value storage
      // Used for onboarding, user profile, feature flags, etc.
      toVersion: 3,
      steps: [
        createTable({
          name: 'data',
          columns: [
            { name: 'key', type: 'string', isIndexed: true },
            { name: 'dataType', type: 'string', isIndexed: true },
            { name: 'value', type: 'string' },
            { name: 'createdAt', type: 'number' },
            { name: 'updatedAt', type: 'number' },
          ]
        }),
      ],
    },
  ],
})
