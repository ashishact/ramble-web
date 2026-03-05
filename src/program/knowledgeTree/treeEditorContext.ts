/**
 * Tree Editor Context Builder — assembles rich context for multi-entity tree editing.
 *
 * Expands entity set via topics and co-occurrence, loads conversation history,
 * formats multi-entity tree sections, and builds the shared short ID map.
 */

import {
  entityStore,
  topicStore,
  memoryStore,
  conversationStore,
  cooccurrenceStore,
  knowledgeNodeStore,
} from '../../db/stores'
import { getTemplateForEntityType } from './templates'
import { filterEligibleEntities } from './entityFilter'
import { createShortIdMap, addMapping } from './shortIdMap'
import { rankNodesByRelevance, formatWithSkipping } from './treeFormatter'
import type { ShortIdMap } from './types'
import type { Intent } from '../types/recording'
import type KnowledgeNode from '../../db/models/KnowledgeNode'
import { createLogger } from '../utils/logger'
import { eventBus } from '../../lib/eventBus'

const logger = createLogger('TreeEditorCtx')

// ============================================================================
// Types
// ============================================================================

export interface TreeEditorInput {
  entityIds: string[]
  topicIds: string[]
  memoryIds: string[]
  conversationId: string
  intent: Intent
}

export interface EntityInfo {
  id: string
  name: string
  type: string
  aliases: string[]
  shortId: string
}

export interface TreeEditorContext {
  entities: EntityInfo[]
  treeSections: string       // formatted multi-entity tree string
  conversationContext: string
  newText: string            // the conversation that triggered this
  memories: Array<{ id: string; content: string; type: string; shortId: string }>
  idMap: ShortIdMap
  intent: Intent
}

// ============================================================================
// Entity Expansion via Topics
// ============================================================================

/**
 * Expand the initial entity set by looking at:
 * 1. Topic → entity links (topics track which entities they relate to)
 * 2. Co-occurrence clusters (entities that appear together)
 *
 * Returns expanded + filtered entity IDs.
 */
async function expandEntitiesViaTopics(
  directEntityIds: string[],
  topicIds: string[]
): Promise<string[]> {
  const entityIdSet = new Set(directEntityIds)

  // Expand via topic → entity links
  for (const topicId of topicIds) {
    const topic = await topicStore.getById(topicId)
    if (topic) {
      for (const eid of topic.entityIdsParsed) {
        entityIdSet.add(eid)
      }
    }
  }

  // Expand via co-occurrence clusters (top 3 co-occurring per entity)
  for (const entityId of directEntityIds) {
    const cluster = await cooccurrenceStore.getCluster(entityId, 3)
    for (const eid of cluster) {
      entityIdSet.add(eid)
    }
  }

  // Filter through eligibility (user always qualifies, others need mentionCount >= 3)
  const allIds = [...entityIdSet]
  const entities = (await Promise.all(
    allIds.map(id => entityStore.getById(id))
  )).filter((e): e is NonNullable<typeof e> => e !== null)

  const eligible = await filterEligibleEntities(entities)
  return eligible.map(e => e.id)
}

// ============================================================================
// Conversation Context
// ============================================================================

/**
 * Load recent conversations for flow context.
 * Excludes the current conversation to avoid duplication.
 */
async function loadConversationContext(
  conversationId: string,
  limit = 5
): Promise<string> {
  const recent = await conversationStore.getRecent(limit + 1) // +1 to filter out current
  const filtered = recent
    .filter(c => c.id !== conversationId)
    .slice(0, limit)
    .reverse() // oldest first for reading flow

  if (filtered.length === 0) return ''

  const lines: string[] = []
  for (const conv of filtered) {
    const text = conv.summary ?? conv.normalizedText ?? conv.sanitizedText
    const truncated = text.length > 300 ? text.slice(0, 300) + '...' : text
    const time = new Date(conv.timestamp).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    const source = conv.source === 'speech' ? 'voice' : conv.source
    lines.push(`[${time}] (${source}): ${truncated}`)
  }

  return lines.join('\n')
}

// ============================================================================
// Tree Context
// ============================================================================

/**
 * Load and format knowledge trees for multiple entities.
 * Creates trees from template if they don't exist yet.
 */
async function loadTreeContext(
  entityIds: string[],
  memories: Array<{ id: string; content: string; type: string }>,
  idMap: ShortIdMap
): Promise<{ treeSections: string; entities: EntityInfo[] }> {
  const sections: string[] = []
  const entityInfos: EntityInfo[] = []

  for (const entityId of entityIds) {
    const entity = await entityStore.getById(entityId)
    if (!entity) continue

    // Load or create tree
    let nodes: KnowledgeNode[] = await knowledgeNodeStore.getByEntity(entityId)
    if (nodes.length === 0) {
      const template = getTemplateForEntityType(entity.type)
      nodes = await knowledgeNodeStore.createTreeFromTemplate(entityId, template)
      logger.info('Created tree from template', {
        entityId, entityType: entity.type, nodeCount: nodes.length,
      })
      eventBus.emit('tree:activity', {
        type: 'tree-created',
        entityName: entity.name,
        entityId,
        message: `Tree created from template: "${entity.name}" [${entity.type}]`,
        detail: `${nodes.length} nodes`,
        timestamp: Date.now(),
      })
    }

    // Build short IDs for all nodes
    const entityShortId = addMapping(idMap, entityId, 'e')
    for (const node of nodes) {
      addMapping(idMap, node.id, 'n')
    }

    // Rank relevance and format
    const relevanceScores = rankNodesByRelevance(nodes, memories, '')
    const formattedTree = formatWithSkipping(nodes, relevanceScores, idMap, entity.name, entityShortId)

    sections.push(formattedTree)
    entityInfos.push({
      id: entityId,
      name: entity.name,
      type: entity.type,
      aliases: entity.aliasesParsed,
      shortId: entityShortId,
    })
  }

  return {
    treeSections: sections.join('\n\n'),
    entities: entityInfos,
  }
}

// ============================================================================
// Main Context Builder
// ============================================================================

/**
 * Build the full context for the tree editor LLM call.
 *
 * Orchestrates: entity expansion → memory loading → conversation context →
 * tree loading/formatting → short ID map assembly.
 */
export async function buildTreeEditorContext(
  input: TreeEditorInput
): Promise<TreeEditorContext> {
  const idMap = createShortIdMap()

  // 1. Expand entity set via topics and co-occurrence
  const expandedEntityIds = await expandEntitiesViaTopics(input.entityIds, input.topicIds)

  // 2. Load memories from DB
  const loaded = (await Promise.all(
    input.memoryIds.map(id => memoryStore.getById(id))
  )).filter((m): m is NonNullable<typeof m> => m !== null)

  const memories = loaded.map(m => {
    const shortId = addMapping(idMap, m.id, 'm')
    return { id: m.id, content: m.content, type: m.type, shortId }
  })

  // 3. Load conversation context (recent conversations for flow)
  const conversationContext = await loadConversationContext(input.conversationId)

  // 4. Load the triggering conversation's text
  const conversation = await conversationStore.getById(input.conversationId)
  const newText = conversation?.normalizedText
    ?? conversation?.sanitizedText
    ?? conversation?.rawText
    ?? ''

  // 5. Load and format tree context for all expanded entities
  const { treeSections, entities } = await loadTreeContext(
    expandedEntityIds,
    memories,
    idMap,
  )

  logger.info('Tree editor context built', {
    directEntities: input.entityIds.length,
    expandedEntities: expandedEntityIds.length,
    memories: memories.length,
    hasConversationContext: conversationContext.length > 0,
  })

  return {
    entities,
    treeSections,
    conversationContext,
    newText,
    memories,
    idMap,
    intent: input.intent,
  }
}
