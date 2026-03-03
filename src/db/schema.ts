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
 *
 * ⚠️  NAMING RULE: Never use `updatedAt` as a model PROPERTY name.
 *     WatermelonDB auto-touches a snake_case `updated_at` column on every update().
 *     Our schema uses camelCase, so the auto-touch crashes.
 *     Use `modifiedAt` as the TS property name instead: @field('updatedAt') modifiedAt!: number
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb'
import { addColumns, createTable, schemaMigrations } from '@nozbe/watermelondb/Schema/migrations'

// Database name - fresh start
export const DATABASE_NAME = 'ramble_v3'

export const schema = appSchema({
  version: 8,
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
        { name: 'source', type: 'string' },      // 'speech' | 'typed' | 'pasted' | 'document' | 'meeting'
        { name: 'speaker', type: 'string' },      // 'user' | 'agent'
        { name: 'processed', type: 'boolean', isIndexed: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
        // v4 additions
        { name: 'normalizedText', type: 'string', isOptional: true },   // Phase 1 output: cleaned full text
        { name: 'sentences', type: 'string', isOptional: true },        // JSON array of { text, speakerHint }
        // v8 additions
        { name: 'recordingId', type: 'string', isOptional: true, isIndexed: true },  // Links to recording that created this conv
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
        // v4 additions
        { name: 'state', type: 'string', isIndexed: true, isOptional: true },           // 'provisional' | 'stable' | 'contested' | 'superseded'
        { name: 'origin', type: 'string', isOptional: true },                            // 'speech' | 'typed' | 'pasted' | 'document' | 'meeting'
        { name: 'ownershipScore', type: 'number' },                                      // 0-1
        { name: 'activityScore', type: 'number', isIndexed: true },                      // 0-1, dynamic, decays over time
        { name: 'extractionVersion', type: 'string', isOptional: true },                 // tracks which model/prompt version created this
        // v5 additions
        { name: 'contradicts', type: 'string', isOptional: true },                       // JSON array of memory IDs this belief competes with
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

    // ========================================================================
    // WIDGET RECORDS - Generic on-demand widget storage (v6)
    // ========================================================================

    // Widget Records - Generic storage for LLM-generated widget output
    // Used by: suggestions, questions, meeting transcription, speak-better, future widgets
    // Indexed by type so queries never cross-contaminate between widget types.
    // Full history preserved — each generation appends a new row (except meeting active state).
    tableSchema({
      name: 'widget_records',
      columns: [
        { name: 'type',      type: 'string', isIndexed: true },              // 'suggestion' | 'question' | 'meeting' | 'speak_better' | ...
        { name: 'subtype',   type: 'string', isOptional: true, isIndexed: true },  // e.g. 'active' | 'archive' for meetings
        { name: 'sessionId', type: 'string', isOptional: true, isIndexed: true },  // optional link to sessions table
        { name: 'title',     type: 'string', isOptional: true },             // human-readable label
        { name: 'content',   type: 'string' },                               // full JSON payload (type-specific)
        { name: 'tags',      type: 'string', isOptional: true },             // JSON string array for cross-type search
        { name: 'createdAt', type: 'number', isIndexed: true },              // immutable creation timestamp
        { name: 'updatedAt', type: 'number' },                               // last mutation timestamp
      ]
    }),

    // ========================================================================
    // RECORDINGS - Universal recording sessions for time travel (v7)
    // ========================================================================

    // Recordings - Every input session (voice, text, paste, document, image)
    // Saved for time travel: user can scrub through timeline and see
    // working memory at any point. System I saves intermediate chunks,
    // System II saves the full recording.
    tableSchema({
      name: 'recordings',
      columns: [
        { name: 'type',            type: 'string', isIndexed: true },   // 'voice' | 'text' | 'paste' | 'document' | 'image'
        { name: 'startedAt',       type: 'number', isIndexed: true },   // When recording began
        { name: 'endedAt',         type: 'number', isOptional: true },  // When recording ended (null while active)
        { name: 'fullText',        type: 'string' },                    // Complete accumulated text
        { name: 'source',          type: 'string' },                    // 'in-app' | 'out-of-app'
        { name: 'audioType',       type: 'string', isOptional: true },  // 'mic' | 'system' for voice recordings
        { name: 'throughputRate',   type: 'number', isOptional: true },  // chars/sec — physical bottleneck signal
        { name: 'chunkCount',      type: 'number' },                    // Number of intermediate chunks
        { name: 'processingMode',  type: 'string', isOptional: true },  // 'system-i' | 'system-ii'
        { name: 'sessionId',       type: 'string', isOptional: true, isIndexed: true },  // Link to sessions table
        { name: 'metadata',        type: 'string' },                    // JSON for extensibility
        { name: 'createdAt',       type: 'number', isIndexed: true },
      ]
    }),

    // ========================================================================
    // UPLOADED FILES - File upload metadata (v7)
    // ========================================================================

    // Uploaded Files - Robust metadata for dropped/uploaded files.
    // Files are stored in a user-selected folder via File System Access API.
    // This table tracks what was uploaded, where it lives, and its processing status.
    // Topics are extracted from uploads but NOT entities (uploaded content could
    // be third-party noise — we don't know if it's the user's own content).
    tableSchema({
      name: 'uploaded_files',
      columns: [
        { name: 'fileName',        type: 'string' },                    // Original file name
        { name: 'fileType',        type: 'string', isIndexed: true },   // MIME type (e.g. 'application/pdf', 'image/png')
        { name: 'fileSize',        type: 'number' },                    // Size in bytes
        { name: 'fileExtension',   type: 'string' },                    // e.g. 'pdf', 'png', 'md'
        { name: 'storagePath',     type: 'string' },                    // Path in user-selected folder
        { name: 'status',          type: 'string', isIndexed: true },   // 'pending' | 'processing' | 'ready' | 'error'
        { name: 'previewText',     type: 'string', isOptional: true },  // First paragraph or extracted text snippet
        { name: 'recordingId',     type: 'string', isOptional: true, isIndexed: true },  // Link to recordings table
        { name: 'conversationId',  type: 'string', isOptional: true, isIndexed: true },  // Link after System II processes it
        { name: 'tags',            type: 'string', isOptional: true },  // JSON array
        { name: 'metadata',        type: 'string' },                    // JSON (dimensions for images, page count for PDFs, etc.)
        { name: 'createdAt',       type: 'number', isIndexed: true },
        { name: 'updatedAt',       type: 'number' },
      ]
    }),
  ]
})

// Migrations - IMPORTANT: Only additive changes to preserve data
export const migrations = schemaMigrations({
  migrations: [
    {
      // v7 → v8: Add recordingId to conversations for intermediate chunk grouping
      // Links each conversation to the recording that created it, enabling reliable
      // dedup of intermediate chunks (whose text differs from the final corrected version).
      toVersion: 8,
      steps: [
        addColumns({
          table: 'conversations',
          columns: [
            { name: 'recordingId', type: 'string', isOptional: true, isIndexed: true },
          ],
        }),
      ],
    },
    {
      // v6 → v7: Add recordings + uploaded_files tables for unified pipeline
      // recordings: time-travel through all input sessions (voice, text, paste, document, image)
      // uploaded_files: robust file upload metadata with processing status
      toVersion: 7,
      steps: [
        createTable({
          name: 'recordings',
          columns: [
            { name: 'type',            type: 'string', isIndexed: true },
            { name: 'startedAt',       type: 'number', isIndexed: true },
            { name: 'endedAt',         type: 'number', isOptional: true },
            { name: 'fullText',        type: 'string' },
            { name: 'source',          type: 'string' },
            { name: 'audioType',       type: 'string', isOptional: true },
            { name: 'throughputRate',   type: 'number', isOptional: true },
            { name: 'chunkCount',      type: 'number' },
            { name: 'processingMode',  type: 'string', isOptional: true },
            { name: 'sessionId',       type: 'string', isOptional: true, isIndexed: true },
            { name: 'metadata',        type: 'string' },
            { name: 'createdAt',       type: 'number', isIndexed: true },
          ],
        }),
        createTable({
          name: 'uploaded_files',
          columns: [
            { name: 'fileName',        type: 'string' },
            { name: 'fileType',        type: 'string', isIndexed: true },
            { name: 'fileSize',        type: 'number' },
            { name: 'fileExtension',   type: 'string' },
            { name: 'storagePath',     type: 'string' },
            { name: 'status',          type: 'string', isIndexed: true },
            { name: 'previewText',     type: 'string', isOptional: true },
            { name: 'recordingId',     type: 'string', isOptional: true, isIndexed: true },
            { name: 'conversationId',  type: 'string', isOptional: true, isIndexed: true },
            { name: 'tags',            type: 'string', isOptional: true },
            { name: 'metadata',        type: 'string' },
            { name: 'createdAt',       type: 'number', isIndexed: true },
            { name: 'updatedAt',       type: 'number' },
          ],
        }),
      ],
    },
    {
      // v5 → v6: Add widget_records table for generic on-demand widget storage
      toVersion: 6,
      steps: [
        createTable({
          name: 'widget_records',
          columns: [
            { name: 'type',      type: 'string', isIndexed: true },
            { name: 'subtype',   type: 'string', isOptional: true, isIndexed: true },
            { name: 'sessionId', type: 'string', isOptional: true, isIndexed: true },
            { name: 'title',     type: 'string', isOptional: true },
            { name: 'content',   type: 'string' },
            { name: 'tags',      type: 'string', isOptional: true },
            { name: 'createdAt', type: 'number', isIndexed: true },
            { name: 'updatedAt', type: 'number' },
          ],
        }),
      ],
    },
    {
      // v4 → v5: Add contradicts column to memories (belief competition model)
      toVersion: 5,
      steps: [
        addColumns({
          table: 'memories',
          columns: [
            { name: 'contradicts', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      // v3 → v4: Add state/origin/scoring columns to memories, add normalizedText/sentences to conversations
      toVersion: 4,
      steps: [
        addColumns({
          table: 'memories',
          columns: [
            { name: 'state', type: 'string', isIndexed: true, isOptional: true },
            { name: 'origin', type: 'string', isOptional: true },
            { name: 'ownershipScore', type: 'number' },
            { name: 'activityScore', type: 'number', isIndexed: true },
            { name: 'extractionVersion', type: 'string', isOptional: true },
          ],
        }),
        addColumns({
          table: 'conversations',
          columns: [
            { name: 'normalizedText', type: 'string', isOptional: true },
            { name: 'sentences', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
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
