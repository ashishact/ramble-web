/**
 * WatermelonDB Schema v1
 *
 * Layered Architecture:
 * - Layer 0: Stream (conversations)
 * - Layer 1: Primitives (propositions, stances, relations, spans, entities)
 * - Layer 2: Derived (claims, goals, patterns, values, contradictions)
 */

import { appSchema, tableSchema } from '@nozbe/watermelondb'

export const schema = appSchema({
  version: 3,
  tables: [
    // ========================================================================
    // SUPPORT TABLES
    // ========================================================================

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

    // Tasks - Durable task queue
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'taskType', type: 'string', isIndexed: true },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'priority', type: 'string' },
        { name: 'priorityValue', type: 'number', isIndexed: true },
        { name: 'payloadJson', type: 'string' },
        { name: 'attempts', type: 'number' },
        { name: 'maxAttempts', type: 'number' },
        { name: 'lastError', type: 'string', isOptional: true },
        { name: 'lastErrorAt', type: 'number', isOptional: true },
        { name: 'backoffConfigJson', type: 'string' },
        { name: 'checkpointJson', type: 'string', isOptional: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
        { name: 'startedAt', type: 'number', isOptional: true },
        { name: 'completedAt', type: 'number', isOptional: true },
        { name: 'executeAt', type: 'number', isIndexed: true },
        { name: 'nextRetryAt', type: 'number', isOptional: true, isIndexed: true },
        { name: 'groupId', type: 'string', isOptional: true, isIndexed: true },
        { name: 'dependsOn', type: 'string', isOptional: true },
        { name: 'sessionId', type: 'string', isOptional: true, isIndexed: true },
      ]
    }),

    // ========================================================================
    // LAYER 0: STREAM (Ground Truth)
    // ========================================================================

    // Conversations - Raw conversation units (immutable once created)
    tableSchema({
      name: 'conversations',
      columns: [
        { name: 'sessionId', type: 'string', isIndexed: true },
        { name: 'timestamp', type: 'number', isIndexed: true },
        { name: 'rawText', type: 'string' },
        { name: 'sanitizedText', type: 'string' },
        { name: 'source', type: 'string' },  // 'speech' | 'text'
        { name: 'speaker', type: 'string' },  // 'user' | 'agent'
        { name: 'discourseFunction', type: 'string' },  // 'assert' | 'question' | 'command' | 'express' | 'commit'
        { name: 'precedingContextSummary', type: 'string' },
        { name: 'createdAt', type: 'number' },
        { name: 'processed', type: 'boolean', isIndexed: true },
      ]
    }),

    // ========================================================================
    // LAYER 1: PRIMITIVES (Extracted from Stream)
    // ========================================================================

    // Propositions - What is said (content without modality)
    tableSchema({
      name: 'propositions',
      columns: [
        { name: 'content', type: 'string' },
        { name: 'subject', type: 'string', isIndexed: true },
        { name: 'type', type: 'string' },  // 'state' | 'event' | 'process' | 'hypothetical' | 'generic'
        { name: 'entityIdsJson', type: 'string' },
        { name: 'spanIdsJson', type: 'string' },
        { name: 'conversationId', type: 'string', isIndexed: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
      ]
    }),

    // Stances - How propositions are held (4 dimensions)
    tableSchema({
      name: 'stances',
      columns: [
        { name: 'propositionId', type: 'string', isIndexed: true },
        { name: 'holder', type: 'string' },
        // Epistemic: How certain? What evidence?
        { name: 'epistemicCertainty', type: 'number' },
        { name: 'epistemicEvidence', type: 'string' },
        // Volitional: Want vs averse?
        { name: 'volitionalValence', type: 'number' },
        { name: 'volitionalStrength', type: 'number' },
        { name: 'volitionalType', type: 'string', isOptional: true },
        // Deontic: Obligation?
        { name: 'deonticStrength', type: 'number' },
        { name: 'deonticSource', type: 'string', isOptional: true },
        { name: 'deonticType', type: 'string', isOptional: true },
        // Affective: Emotional?
        { name: 'affectiveValence', type: 'number' },
        { name: 'affectiveArousal', type: 'number' },
        { name: 'emotionsJson', type: 'string', isOptional: true },
        // Meta
        { name: 'expressedAt', type: 'number', isIndexed: true },
        { name: 'supersedes', type: 'string', isOptional: true },
      ]
    }),

    // Relations - How propositions connect
    tableSchema({
      name: 'relations',
      columns: [
        { name: 'sourceId', type: 'string', isIndexed: true },
        { name: 'targetId', type: 'string', isIndexed: true },
        { name: 'category', type: 'string', isIndexed: true },
        { name: 'subtype', type: 'string' },
        { name: 'strength', type: 'number' },
        { name: 'spanIdsJson', type: 'string' },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Spans - Text regions matched by pattern matching (JS, not LLM)
    tableSchema({
      name: 'spans',
      columns: [
        { name: 'conversationId', type: 'string', isIndexed: true },
        { name: 'charStart', type: 'number' },
        { name: 'charEnd', type: 'number' },
        { name: 'textExcerpt', type: 'string' },
        { name: 'matchedBy', type: 'string' },  // 'pattern' | 'rule'
        { name: 'patternId', type: 'string', isOptional: true },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Entity Mentions - Raw text references to entities (Layer 1)
    tableSchema({
      name: 'entity_mentions',
      columns: [
        { name: 'text', type: 'string' },                    // Raw text: "he", "John", "my boss"
        { name: 'mentionType', type: 'string' },             // pronoun, proper_noun, common_noun, etc.
        { name: 'suggestedType', type: 'string' },           // person, organization, project, etc.
        { name: 'spanId', type: 'string', isIndexed: true },
        { name: 'conversationId', type: 'string', isIndexed: true },
        { name: 'resolvedEntityId', type: 'string', isOptional: true, isIndexed: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
      ]
    }),

    // Primitive Entities - Named entities from Layer 1 extraction
    tableSchema({
      name: 'primitive_entities',
      columns: [
        { name: 'canonicalName', type: 'string', isIndexed: true },
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'aliases', type: 'string' },
        { name: 'firstSpanId', type: 'string' },
        { name: 'mentionCount', type: 'number' },
        { name: 'lastMentioned', type: 'number', isIndexed: true },
        { name: 'createdAt', type: 'number' },
      ]
    }),

    // Entities - Named entities (from claim extraction)
    tableSchema({
      name: 'entities',
      columns: [
        { name: 'canonicalName', type: 'string', isIndexed: true },
        { name: 'entityType', type: 'string', isIndexed: true },
        { name: 'aliases', type: 'string' },
        { name: 'createdAt', type: 'number' },
        { name: 'lastReferenced', type: 'number', isIndexed: true },
        { name: 'mentionCount', type: 'number', isIndexed: true },
      ]
    }),

    // ========================================================================
    // LAYER 2: DERIVED (Memoized computations from primitives)
    // ========================================================================

    // Generic derived table for memoized computations
    tableSchema({
      name: 'derived',
      columns: [
        { name: 'type', type: 'string', isIndexed: true },
        { name: 'dependencyIdsJson', type: 'string' },
        { name: 'dependencyHash', type: 'string' },
        { name: 'dataJson', type: 'string' },
        { name: 'stale', type: 'boolean', isIndexed: true },
        { name: 'computedAt', type: 'number', isIndexed: true },
      ]
    }),

    // Claims - Structured knowledge units
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
        { name: 'memoryTier', type: 'string', isIndexed: true },
        { name: 'salience', type: 'number', isIndexed: true },
        { name: 'promotedAt', type: 'number', isOptional: true },
        { name: 'lastAccessed', type: 'number', isIndexed: true },
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
        { name: 'parentGoalId', type: 'string', isOptional: true, isIndexed: true },
        { name: 'createdAt', type: 'number' },
        { name: 'lastReferenced', type: 'number', isIndexed: true },
        { name: 'achievedAt', type: 'number', isOptional: true },
        { name: 'priority', type: 'number' },
        { name: 'progressType', type: 'string' },
        { name: 'progressValue', type: 'number' },
        { name: 'progressIndicatorsJson', type: 'string' },
        { name: 'blockersJson', type: 'string' },
        { name: 'sourceClaimId', type: 'string' },
        { name: 'motivation', type: 'string', isOptional: true },
        { name: 'deadline', type: 'number', isOptional: true },
      ]
    }),

    // Patterns - Detected behavior patterns
    tableSchema({
      name: 'patterns',
      columns: [
        { name: 'patternType', type: 'string', isIndexed: true },
        { name: 'description', type: 'string' },
        { name: 'evidenceClaimsJson', type: 'string' },
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

    // Claim Sources - Many-to-many mapping (claims <-> conversation units)
    tableSchema({
      name: 'claim_sources',
      columns: [
        { name: 'claimId', type: 'string', isIndexed: true },
        { name: 'unitId', type: 'string', isIndexed: true },
      ]
    }),

    // ========================================================================
    // OBSERVERS & EXTRACTORS
    // ========================================================================

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

    // Extraction Programs - LLM-based extraction configurations
    tableSchema({
      name: 'extraction_programs',
      columns: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'version', type: 'number' },
        { name: 'active', type: 'boolean', isIndexed: true },
        { name: 'patternsJson', type: 'string', isOptional: true },
        { name: 'alwaysRun', type: 'boolean' },
        { name: 'promptTemplate', type: 'string', isOptional: true },
        { name: 'outputSchemaJson', type: 'string', isOptional: true },
        { name: 'llmTier', type: 'string', isOptional: true },
        { name: 'llmTemperature', type: 'number', isOptional: true },
        { name: 'llmMaxTokens', type: 'number', isOptional: true },
        { name: 'priority', type: 'number' },
        { name: 'minConfidence', type: 'number' },
        { name: 'isCore', type: 'boolean' },
        { name: 'claimTypesJson', type: 'string' },
        { name: 'createdAt', type: 'number' },
        { name: 'updatedAt', type: 'number' },
        { name: 'lastUsed', type: 'number', isOptional: true },
        { name: 'runCount', type: 'number' },
        { name: 'successRate', type: 'number' },
        { name: 'avgProcessingTimeMs', type: 'number' },
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
        { name: 'priority', type: 'number' },
        { name: 'triggers', type: 'string' },
        { name: 'claimTypeFilter', type: 'string', isOptional: true },
        { name: 'usesLlm', type: 'boolean' },
        { name: 'llmTier', type: 'string', isOptional: true },
        { name: 'llmTemperature', type: 'number', isOptional: true },
        { name: 'llmMaxTokens', type: 'number', isOptional: true },
        { name: 'promptTemplate', type: 'string', isOptional: true },
        { name: 'outputSchemaJson', type: 'string', isOptional: true },
        { name: 'shouldRunLogic', type: 'string', isOptional: true },
        { name: 'processLogic', type: 'string', isOptional: true },
        { name: 'isCore', type: 'boolean' },
        { name: 'version', type: 'number' },
        { name: 'createdAt', type: 'number' },
        { name: 'updatedAt', type: 'number' },
        { name: 'runCount', type: 'number' },
        { name: 'successRate', type: 'number' },
        { name: 'avgProcessingTimeMs', type: 'number' },
      ]
    }),

    // ========================================================================
    // SUPPORT TABLES
    // ========================================================================

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
        { name: 'sourceUnitId', type: 'string', isOptional: true },
      ]
    }),

    // ========================================================================
    // DEBUG / TRACING
    // ========================================================================

    // Extraction Traces - Debug info for how things were extracted
    tableSchema({
      name: 'extraction_traces',
      columns: [
        // What was traced
        { name: 'targetType', type: 'string', isIndexed: true },  // 'proposition' | 'claim' | 'entity' | 'relation'
        { name: 'targetId', type: 'string', isIndexed: true },    // ID of the extracted item
        // Source info
        { name: 'conversationId', type: 'string', isIndexed: true },
        { name: 'inputText', type: 'string' },
        // Span info (JS pattern matching)
        { name: 'spanId', type: 'string', isOptional: true },
        { name: 'charStart', type: 'number', isOptional: true },
        { name: 'charEnd', type: 'number', isOptional: true },
        { name: 'matchedPattern', type: 'string', isOptional: true },  // Pattern ID or regex
        { name: 'matchedText', type: 'string', isOptional: true },
        // LLM extraction info
        { name: 'llmPrompt', type: 'string', isOptional: true },
        { name: 'llmResponse', type: 'string', isOptional: true },
        { name: 'llmModel', type: 'string', isOptional: true },
        { name: 'llmTokensUsed', type: 'number', isOptional: true },
        // Processing info
        { name: 'processingTimeMs', type: 'number' },
        { name: 'extractorId', type: 'string', isOptional: true },
        { name: 'error', type: 'string', isOptional: true },
        { name: 'createdAt', type: 'number', isIndexed: true },
      ]
    }),
  ]
})
