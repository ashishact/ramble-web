/**
 * WatermelonDB Schema v1 - Core Loop Architecture
 *
 * DATABASE NAME: ramble_v2
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
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb'

// Database name - separate from old schema
export const DATABASE_NAME = 'ramble_v2'

export const schema = appSchema({
  version: 1,
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
  ]
})
