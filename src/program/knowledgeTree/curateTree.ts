/**
 * Tree Curation Loop — multi-turn LLM curation of per-entity knowledge trees.
 *
 * Orchestrates:
 * 1. Tree initialization from template (if first time)
 * 2. Short ID mapping for LLM token efficiency
 * 3. Relevance-based tree formatting with smart skipping
 * 4. Multi-turn LLM conversation (up to MAX_TURNS)
 * 5. Action resolution (short IDs → real IDs) and validation
 * 6. DB application and child count maintenance
 */

import { callLLM } from '../llmClient'
import { parseLLMJSON } from '../utils/jsonUtils'
import { entityStore, knowledgeNodeStore, cooccurrenceStore } from '../../db/stores'
import { getTemplateForEntityType } from './templates'
import { createShortIdMap, addMapping, resolveShortId } from './shortIdMap'
import { rankNodesByRelevance, formatWithSkipping, formatExpandedNode, formatSearchResults } from './treeFormatter'
import { TREE_CURATION_SYSTEM_PROMPT, buildCurationUserPrompt } from './curationPrompt'
import { validateAndApplyActions } from './applyActions'
import { resolveAllShortIds } from './resolveIds'
import type { CurationAction, CurationResponse, ShortIdMap } from './types'
import type { Intent } from '../types/recording'
import { createLogger } from '../utils/logger'

const logger = createLogger('TreeCuration')

const MAX_TURNS = 4

// ============================================================================
// Response Parsing
// ============================================================================

function parseCurationResponse(raw: string): CurationResponse {
  const { data, error } = parseLLMJSON<{ actions?: CurationAction[]; needsMore?: CurationResponse['needsMore'] }>(raw)

  if (error || !data) {
    logger.warn('Failed to parse curation response', { error, raw: raw.slice(0, 200) })
    return { actions: [{ type: 'skip', reason: 'Parse error' }], needsMore: null }
  }

  const actions: CurationAction[] = Array.isArray(data.actions) ? data.actions : []
  const needsMore = data.needsMore ?? null

  return { actions, needsMore }
}

// ============================================================================
// Main Curation Function
// ============================================================================

/**
 * Curate a knowledge tree for a single entity with new memories.
 *
 * Steps:
 * 1. Load or create tree from template
 * 2. Build short ID map
 * 3. Format tree with relevance-based skipping
 * 4. Multi-turn LLM loop (expand/search on needsMore)
 * 5. Resolve short IDs → real IDs
 * 6. Validate and apply actions to DB
 * 7. Refresh child counts
 */
export async function curateTree(
  entityId: string,
  newMemories: Array<{ id: string; content: string; type: string }>,
  conversationContext: string,
  intent: Intent = 'inform'
): Promise<CurationAction[]> {
  // Step 1: Check if entity has a tree. If not, create from template.
  let nodes = await knowledgeNodeStore.getByEntity(entityId)
  if (nodes.length === 0) {
    const entity = await entityStore.getById(entityId)
    if (!entity) {
      logger.warn('Entity not found for tree curation', { entityId })
      return []
    }
    const template = getTemplateForEntityType(entity.type)
    nodes = await knowledgeNodeStore.createTreeFromTemplate(entityId, template)
    logger.info('Created tree from template', { entityId, entityType: entity.type, nodeCount: nodes.length })
  }

  // Get entity info for prompt
  const entity = await entityStore.getById(entityId)
  if (!entity) return []

  // Step 2: Build short ID map
  const idMap: ShortIdMap = createShortIdMap()
  const entityShortId = addMapping(idMap, entityId, 'e')
  for (const node of nodes) {
    addMapping(idMap, node.id, 'n')
  }
  for (const mem of newMemories) {
    addMapping(idMap, mem.id, 'm')
  }

  // Step 3: Rank relevance and format tree with skipping
  const relevanceScores = rankNodesByRelevance(nodes, newMemories, conversationContext)
  const formattedTree = formatWithSkipping(nodes, relevanceScores, idMap, entity.name, entityShortId)

  // Step 4: Multi-turn curation loop
  const allActions: CurationAction[] = []
  let additionalContext = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const userPrompt = buildCurationUserPrompt({
      entityName: entity.name,
      entityShortId,
      entityType: entity.type,
      entityAliases: entity.aliasesParsed,
      formattedTree,
      newMemories,
      conversationContext,
      additionalContext,
      previousActions: allActions,
      idMap,
      intent,
    })

    let response: CurationResponse
    try {
      const llmResult = await callLLM({
        tier: 'medium',
        prompt: userPrompt,
        systemPrompt: TREE_CURATION_SYSTEM_PROMPT,
        options: {
          temperature: 0.3,
        },
      })
      response = parseCurationResponse(llmResult.content)
    } catch (error) {
      logger.error('LLM call failed during tree curation', {
        entityId,
        turn,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
      break
    }

    allActions.push(...response.actions)

    if (!response.needsMore) break

    // Handle needsMore requests
    if (response.needsMore.type === 'expand') {
      const realId = resolveShortId(idMap, response.needsMore.node)
      if (realId) {
        const expanded = await knowledgeNodeStore.getChildren(realId)
        for (const child of expanded) addMapping(idMap, child.id, 'n')
        additionalContext += formatExpandedNode(expanded, idMap)
      } else {
        logger.warn('Expand: could not resolve short ID', { shortId: response.needsMore.node })
        break
      }
    }

    if (response.needsMore.type === 'search') {
      const scope = response.needsMore.scope ?? 'related'
      // Two-tier search: co-occurring entities first
      const cooccurring = await cooccurrenceStore.getCluster(entityId, 3)
      let results = await knowledgeNodeStore.searchNodes(
        response.needsMore.terms,
        [entityId, ...cooccurring]
      )
      if (results.length === 0 && scope === 'all') {
        results = await knowledgeNodeStore.searchNodes(response.needsMore.terms)
      }
      for (const node of results) addMapping(idMap, node.id, 'n')
      additionalContext += formatSearchResults(results, idMap)
    }

    if (response.needsMore.type === 'ask_user') {
      // Phase 4: queue as widget prompt. For now: log and break.
      logger.info('LLM asks user (Phase 4 stub)', {
        question: response.needsMore.question,
        context: response.needsMore.context,
      })
      break
    }
  }

  // Step 5: Resolve short IDs back to real IDs
  const resolvedActions = allActions.map(action => resolveAllShortIds(action, idMap))

  // Step 6: Validate and apply to DB
  // Reload nodes to get any newly created ones from template
  const currentNodes = await knowledgeNodeStore.getByEntity(entityId)
  const applied = await validateAndApplyActions(resolvedActions, entityId, currentNodes)

  // Step 7: Post-curation maintenance
  await knowledgeNodeStore.refreshChildCounts(entityId)

  logger.info('Tree curation complete', {
    entityId,
    entityName: entity.name,
    actionsQueued: allActions.length,
    actionsApplied: applied.length,
  })

  return applied
}
