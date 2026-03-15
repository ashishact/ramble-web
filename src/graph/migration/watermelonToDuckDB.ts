/**
 * WatermelonDB → DuckDB Migration
 *
 * One-time migration that reads all data from WatermelonDB (LokiJS adapter)
 * and writes it to the DuckDB graph as nodes, edges, and conversations.
 *
 * Mapping:
 *   entities → nodes with label ['entity', type]
 *   topics   → nodes with label ['topic']
 *   memories → nodes with label ['memory', type] + CognitiveProperties
 *   goals    → nodes with label ['goal']
 *   entity↔topic links → edges with type RELATED_TO
 *   memory↔entity links → edges with type ABOUT
 *   memory↔topic links → edges with type MENTIONS
 *   conversations → conversations table
 *
 * Stores eliminated (data now in graph relationships):
 *   corrections, learnedCorrections, knowledgeNodes,
 *   cooccurrences, timelineEvents, extractionLogs
 */

import { database } from '../../db/database'
import type Entity from '../../db/models/Entity'
import type Topic from '../../db/models/Topic'
import type Memory from '../../db/models/Memory'
import type Goal from '../../db/models/Goal'
import type Conversation from '../../db/models/Conversation'
import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import type { CognitiveProperties, EntityProperties, TopicProperties, GoalProperties, MemoryOrigin } from '../types'
import { createLogger } from '../../program/utils/logger'

const logger = createLogger('Migration')

export interface MigrationStats {
  entities: number
  topics: number
  memories: number
  goals: number
  conversations: number
  edges: number
  durationMs: number
}

let edgeIdCounter = 0
function edgeId(): string { return `mig_edge_${Date.now()}_${++edgeIdCounter}` }

/**
 * Run the full migration from WatermelonDB to DuckDB graph.
 * Safe to run multiple times — uses INSERT OR IGNORE semantics.
 */
export async function migrateWatermelonToDuckDB(
  reactive: ReactiveGraphService
): Promise<MigrationStats> {
  const startTime = Date.now()
  const stats: MigrationStats = {
    entities: 0, topics: 0, memories: 0,
    goals: 0, conversations: 0, edges: 0, durationMs: 0,
  }

  logger.info('Starting WatermelonDB → DuckDB migration...')

  // ── Fetch all WatermelonDB data ────────────────────────────────────────
  const [allEntities, allTopics, allMemories, allGoals, allConversations] = await Promise.all([
    database.get<Entity>('entities').query().fetch(),
    database.get<Topic>('topics').query().fetch(),
    database.get<Memory>('memories').query().fetch(),
    database.get<Goal>('goals').query().fetch(),
    database.get<Conversation>('conversations').query().fetch(),
  ])

  logger.info('Fetched WatermelonDB data', {
    entities: allEntities.length,
    topics: allTopics.length,
    memories: allMemories.length,
    goals: allGoals.length,
    conversations: allConversations.length,
  })

  // ── Migrate Entities ───────────────────────────────────────────────────
  await reactive.batchMutations(async () => {
    for (const entity of allEntities) {
      const props: EntityProperties = {
        name: entity.name,
        type: entity.type,
        description: entity.description ?? undefined,
        aliases: entity.aliasesParsed ?? [],
        mentionCount: entity.mentionCount,
        firstMentioned: entity.firstMentioned,
        lastMentioned: entity.lastMentioned,
      }

      await reactive.createNode({
        id: entity.id,
        labels: ['entity', entity.type],
        properties: props as unknown as Record<string, unknown>,
      })
      stats.entities++
    }
  })

  // ── Migrate Topics ─────────────────────────────────────────────────────
  await reactive.batchMutations(async () => {
    for (const topic of allTopics) {
      const props: TopicProperties = {
        name: topic.name,
        category: topic.category ?? undefined,
        mentionCount: topic.mentionCount,
        firstMentioned: topic.firstMentioned,
        lastMentioned: topic.lastMentioned,
      }

      await reactive.createNode({
        id: topic.id,
        labels: ['topic'],
        properties: props as unknown as Record<string, unknown>,
      })
      stats.topics++

      // Create entity↔topic edges
      const entityIds = topic.entityIdsParsed ?? []
      for (const entityId of entityIds) {
        await reactive.createEdge({
          id: edgeId(),
          startId: entityId,
          endId: topic.id,
          type: 'RELATED_TO',
          properties: { source: 'migration' },
        })
        stats.edges++
      }
    }
  })

  // ── Migrate Memories ───────────────────────────────────────────────────
  await reactive.batchMutations(async () => {
    for (const memory of allMemories) {
      const origin = (memory.origin ?? 'typed') as MemoryOrigin

      const props: CognitiveProperties = {
        content: memory.content,
        type: memory.type,
        subject: memory.subject ?? undefined,
        importance: memory.importance,
        confidence: memory.confidence,
        activityScore: memory.activityScore,
        ownership: memory.ownershipScore,
        state: memory.state as CognitiveProperties['state'],
        validFrom: memory.validFrom ?? undefined,
        validUntil: memory.validUntil ?? undefined,
        origin,
        extractionVersion: memory.extractionVersion ?? 'v1-migrated',
        sourceConversationIds: memory.sourceConversationIdsParsed ?? [],
        reinforceCount: memory.reinforcementCount,
        lastReinforced: memory.lastReinforced,
        supersededBy: memory.supersededBy ?? undefined,
      }

      await reactive.createNode({
        id: memory.id,
        labels: ['memory', memory.type],
        properties: props as unknown as Record<string, unknown>,
      })
      stats.memories++

      // Create memory↔entity edges
      const entityIds = memory.entityIdsParsed ?? []
      for (const entityId of entityIds) {
        await reactive.createEdge({
          id: edgeId(),
          startId: memory.id,
          endId: entityId,
          type: 'ABOUT',
          properties: { source: 'migration' },
        })
        stats.edges++
      }

      // Create memory↔topic edges
      const topicIds = memory.topicIdsParsed ?? []
      for (const topicId of topicIds) {
        await reactive.createEdge({
          id: edgeId(),
          startId: memory.id,
          endId: topicId,
          type: 'MENTIONS',
          properties: { source: 'migration' },
        })
        stats.edges++
      }

      // Create contradiction edges
      if (memory.contradictsParsed && memory.contradictsParsed.length > 0) {
        for (const otherId of memory.contradictsParsed) {
          await reactive.createEdge({
            id: edgeId(),
            startId: memory.id,
            endId: otherId,
            type: 'CONTRADICTS',
            properties: { source: 'migration' },
          })
          stats.edges++
        }
      }

      // Create supersession edge
      if (memory.supersededBy) {
        await reactive.createEdge({
          id: edgeId(),
          startId: memory.supersededBy,
          endId: memory.id,
          type: 'SUPERSEDES',
          properties: { source: 'migration' },
        })
        stats.edges++
      }
    }
  })

  // ── Migrate Goals ──────────────────────────────────────────────────────
  await reactive.batchMutations(async () => {
    for (const goal of allGoals) {
      const props: GoalProperties = {
        statement: goal.statement,
        type: goal.type,
        status: goal.status as GoalProperties['status'],
        progress: goal.progress,
        entityIds: goal.entityIdsParsed ?? [],
        topicIds: goal.topicIdsParsed ?? [],
      }

      await reactive.createNode({
        id: goal.id,
        labels: ['goal'],
        properties: props as unknown as Record<string, unknown>,
      })
      stats.goals++
    }
  })

  // ── Migrate Conversations ──────────────────────────────────────────────
  for (const conv of allConversations) {
    await reactive.exec(
      `INSERT OR IGNORE INTO conversations (id, session_id, timestamp, raw_text, source, speaker, processed, intent, recording_id, batch_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        conv.id,
        conv.sessionId ?? '',
        conv.createdAt,
        conv.rawText,
        conv.source,
        conv.speaker ?? 'user',
        conv.processed,
        conv.intent ?? null,
        conv.recordingId ?? null,
        null,
        conv.createdAt,
      ]
    )
    stats.conversations++
  }

  stats.durationMs = Date.now() - startTime

  logger.info('Migration complete', stats)
  return stats
}
