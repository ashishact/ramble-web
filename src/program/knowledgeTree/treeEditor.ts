/**
 * Tree Editor — multi-entity grounded tree editing orchestrator.
 *
 * Replaces the old per-entity curateTree() with a single multi-entity pass:
 * 1. Build rich context (expanded entities, conversation history, formatted trees)
 * 2. First LLM pass → actions + optional searchTerms
 * 3. Search loop (if searchTerms, max 2 iterations)
 * 4. Resolve short IDs → real IDs
 * 5. Verification for CREATE actions (dedup check)
 * 6. Execute actions grouped by entity
 */

import { callLLM } from '../llmClient'
import { parseLLMJSON } from '../utils/jsonUtils'
import { knowledgeNodeStore } from '../../db/stores'
import type KnowledgeNode from '../../db/models/KnowledgeNode'
import { buildTreeEditorContext, type TreeEditorInput } from './treeEditorContext'
import {
  TREE_EDITOR_SYSTEM_PROMPT,
  TREE_EDITOR_VERIFY_SYSTEM_PROMPT,
  buildTreeEditorUserPrompt,
  buildVerificationPrompt,
} from './treeEditorPrompt'
import { validateAndApplyActions } from './applyActions'
import { resolveAllShortIds } from './resolveIds'
import { addMapping } from './shortIdMap'
import { formatSearchResults } from './treeFormatter'
import type { CurationAction, TreeEditorResponse, ShortIdMap } from './types'
import { createLogger } from '../utils/logger'
import { eventBus } from '../../lib/eventBus'
import { telemetry } from '../telemetry'

const logger = createLogger('TreeEditor')

const MAX_SEARCH_LOOPS = 2

// ============================================================================
// Types
// ============================================================================

export interface EditTreesResult {
  actionsProposed: number
  actionsApplied: number
  entitiesAffected: number
  searchLoops: number
}

// ============================================================================
// Response Parsing
// ============================================================================

function parseTreeEditorResponse(raw: string): TreeEditorResponse {
  const { data, error } = parseLLMJSON<{
    actions?: CurationAction[]
    searchTerms?: string[] | null
  }>(raw)

  if (error || !data) {
    logger.warn('Failed to parse tree editor response', { error, raw: raw.slice(0, 200) })
    return { actions: [{ type: 'skip', reason: 'Parse error' }], searchTerms: null }
  }

  const actions: CurationAction[] = Array.isArray(data.actions) ? data.actions : []
  const searchTerms = Array.isArray(data.searchTerms) && data.searchTerms.length > 0
    ? data.searchTerms
    : null

  return { actions, searchTerms }
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Edit knowledge trees for multiple entities in one pass.
 *
 * This is the main entry point called by kernel.ts when an `edit-trees` task runs.
 */
export async function editTrees(input: TreeEditorInput): Promise<EditTreesResult> {
  // 1. Build full context
  telemetry.emit('tree-editor', 'context-build', 'start', { entityCount: input.entityIds.length })
  const ctx = await buildTreeEditorContext(input)
  telemetry.emit('tree-editor', 'context-build', 'end', {
    entities: ctx.entities.length,
    entityNames: ctx.entities.map(e => e.name),
    memories: ctx.memories.length,
  }, { status: 'success' })

  if (ctx.entities.length === 0) {
    logger.info('No eligible entities for tree editing')
    return { actionsProposed: 0, actionsApplied: 0, entitiesAffected: 0, searchLoops: 0 }
  }

  if (ctx.memories.length === 0) {
    logger.info('No memories to process for tree editing')
    return { actionsProposed: 0, actionsApplied: 0, entitiesAffected: 0, searchLoops: 0 }
  }

  eventBus.emit('tree:activity', {
    type: 'curation-start',
    message: `Tree editor: ${ctx.entities.length} entit${ctx.entities.length === 1 ? 'y' : 'ies'}, ${ctx.memories.length} memories`,
    detail: ctx.entities.map(e => e.name).join(', '),
    timestamp: Date.now(),
  })

  // 2. First LLM pass
  const userPrompt = buildTreeEditorUserPrompt(ctx)
  let allActions: CurationAction[] = []
  let searchLoops = 0

  try {
    eventBus.emit('tree:activity', {
      type: 'curation-llm-call',
      message: `Tree editor LLM call (${ctx.entities.length} entities)`,
      timestamp: Date.now(),
    })

    telemetry.emit('tree-editor', 'llm-pass', 'start', {
      pass: 'initial',
      promptLength: userPrompt.length,
      systemPromptPreview: TREE_EDITOR_SYSTEM_PROMPT,
      promptPreview: userPrompt,
      tier: 'medium',
    }, { isLLM: true })
    const llmResult = await callLLM({
      tier: 'medium',
      prompt: userPrompt,
      systemPrompt: TREE_EDITOR_SYSTEM_PROMPT,
      category: 'tree-editor',
      options: { temperature: 0.3 },
    })
    telemetry.emit('tree-editor', 'llm-pass', 'end', {
      responsePreview: llmResult.content,
      durationMs: llmResult.processing_time_ms,
      model: llmResult.model,
      inputTokens: llmResult.tokens_used.prompt,
      outputTokens: llmResult.tokens_used.completion,
    }, { status: 'success', isLLM: true })

    const response = parseTreeEditorResponse(llmResult.content)
    allActions = response.actions

    eventBus.emit('tree:activity', {
      type: 'curation-llm-response',
      message: `Tree editor: ${response.actions.length} actions${response.searchTerms ? ` + search: ${response.searchTerms.join(', ')}` : ''}`,
      detail: `actions: ${response.actions.length}`,
      timestamp: Date.now(),
    })

    // 3. Search loop (if LLM requested searchTerms)
    let currentSearchTerms = response.searchTerms
    let additionalContext = ''

    while (currentSearchTerms && searchLoops < MAX_SEARCH_LOOPS) {
      searchLoops++

      // Search across entity trees first, then globally
      const entityIds = ctx.entities.map(e => e.id)
      let results = await knowledgeNodeStore.searchNodes(currentSearchTerms, entityIds)
      if (results.length === 0) {
        results = await knowledgeNodeStore.searchNodes(currentSearchTerms)
      }

      // Add search results to idMap and format
      for (const node of results) {
        addMapping(ctx.idMap, node.id, 'n')
      }
      additionalContext += formatSearchResults(results, ctx.idMap)

      // Follow-up LLM call with search results
      eventBus.emit('tree:activity', {
        type: 'curation-llm-call',
        message: `Tree editor search loop ${searchLoops} (${results.length} results)`,
        timestamp: Date.now(),
      })

      const searchPrompt = userPrompt + '\n' + additionalContext +
        '\n\nAbove are search results from the tree. Update your actions based on what you see.'

      const searchResult = await callLLM({
        tier: 'medium',
        prompt: searchPrompt,
        systemPrompt: TREE_EDITOR_SYSTEM_PROMPT,
        category: 'tree-editor',
        options: { temperature: 0.3 },
      })

      const searchResponse = parseTreeEditorResponse(searchResult.content)
      allActions = searchResponse.actions // Replace with updated actions
      currentSearchTerms = searchResponse.searchTerms

      eventBus.emit('tree:activity', {
        type: 'curation-llm-response',
        message: `Tree editor search ${searchLoops}: ${searchResponse.actions.length} actions`,
        timestamp: Date.now(),
      })
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Tree editor LLM call failed', { error: errorMessage })
    eventBus.emit('tree:activity', {
      type: 'curation-llm-error',
      message: `Tree editor LLM error`,
      detail: errorMessage,
      timestamp: Date.now(),
    })
    return { actionsProposed: 0, actionsApplied: 0, entitiesAffected: 0, searchLoops }
  }

  // 4. Resolve short IDs → real IDs
  telemetry.emit('tree-editor', 'id-resolution', 'start', {
    actionCount: allActions.length,
    idMapSize: ctx.idMap.toReal.size,
    actionsPreview: allActions.map(a => {
      const rec = a as unknown as Record<string, unknown>
      const summary: Record<string, unknown> = { type: a.type }
      if ('node' in a) summary.node = rec.node
      if ('parent' in a) summary.parent = rec.parent
      if ('label' in a) summary.label = rec.label
      if ('source' in a) summary.source = rec.source
      if ('target' in a) summary.target = rec.target
      return summary
    }),
  })

  const resolvedActions = allActions.map(action => resolveAllShortIds(action, ctx.idMap))
  const actionsProposed = resolvedActions.filter(a => a.type !== 'skip').length

  // Detect unresolved short IDs (still look like "n2", "e3" after resolution)
  const unresolvedActions: Array<{ type: string; field: string; unresolvedId: string }> = []
  for (const action of resolvedActions) {
    if (action.type === 'skip') continue
    const actionRecord = action as unknown as Record<string, unknown>
    for (const [field, value] of Object.entries(actionRecord)) {
      if (typeof value === 'string' && /^[a-z]\d+$/.test(value)) {
        unresolvedActions.push({ type: action.type, field, unresolvedId: value })
      }
      if (Array.isArray(value)) {
        for (const v of value) {
          if (typeof v === 'string' && /^[a-z]\d+$/.test(v)) {
            unresolvedActions.push({ type: action.type, field, unresolvedId: v })
          }
        }
      }
    }
  }

  telemetry.emit('tree-editor', 'id-resolution', 'end', {
    total: allActions.length,
    proposed: actionsProposed,
    skips: allActions.length - actionsProposed,
    unresolvedCount: unresolvedActions.length,
    unresolvedDetails: unresolvedActions.length > 0 ? unresolvedActions : undefined,
    resolvedPreview: resolvedActions.filter(a => a.type !== 'skip').map(a => {
      const rec = a as unknown as Record<string, unknown>
      const summary: Record<string, unknown> = { type: a.type }
      if ('node' in a) summary.node = rec.node
      if ('parent' in a) summary.parent = rec.parent
      if ('label' in a) summary.label = rec.label
      return summary
    }),
  }, { status: unresolvedActions.length > 0 ? 'error' : 'success' })

  logger.info('Short ID resolution complete', {
    total: allActions.length,
    proposed: actionsProposed,
    skips: allActions.length - actionsProposed,
    idMapSize: ctx.idMap.toReal.size,
  })

  // 5. Verification for CREATE actions (dedup check)
  const finalActions = await verifyCreateActions(resolvedActions, ctx.idMap, ctx.entities)

  // 6. Execute actions grouped by entity
  const entityActionsMap = await groupActionsByEntity(finalActions)

  telemetry.emit('tree-editor', 'apply-actions', 'start', {
    actionsProposed,
    finalActionCount: finalActions.filter(a => a.type !== 'skip').length,
    groupedEntities: entityActionsMap.size,
    droppedInGrouping: finalActions.filter(a => a.type !== 'skip').length - Array.from(entityActionsMap.values()).reduce((sum, acts) => sum + acts.length, 0),
    groupSizes: Array.from(entityActionsMap.entries()).map(([eid, acts]) => ({
      entity: ctx.entities.find(e => e.id === eid)?.name ?? eid.slice(0, 8),
      actions: acts.length,
    })),
  })
  let totalApplied = 0
  const entitiesAffected = new Set<string>()

  for (const [entityId, actions] of entityActionsMap) {
    if (actions.length === 0) continue

    const currentNodes = await knowledgeNodeStore.getByEntity(entityId)
    const nodeMap = new Map(currentNodes.map(n => [n.id, n]))
    const applied = await validateAndApplyActions(actions, entityId, currentNodes)
    totalApplied += applied.length

    if (applied.length > 0) {
      entitiesAffected.add(entityId)
      await knowledgeNodeStore.refreshChildCounts(entityId)

      const entityName = ctx.entities.find(e => e.id === entityId)?.name ?? entityId

      // Emit per-action detail events (human-readable, using node labels)
      for (const action of applied) {
        const msg = formatActionMessage(action, entityName, nodeMap)
        if (msg) {
          eventBus.emit('tree:activity', {
            type: 'curation-action',
            entityName,
            entityId,
            message: msg,
            detail: formatActionDetail(action),
            timestamp: Date.now(),
          })
        }
      }

      eventBus.emit('tree:activity', {
        type: 'curation-actions-applied',
        entityName,
        entityId,
        message: `Applied ${applied.length}/${actions.length} actions for "${entityName}"`,
        detail: actions.length !== applied.length
          ? `${actions.length - applied.length} actions dropped (validation)`
          : undefined,
        timestamp: Date.now(),
      })
    }
  }

  telemetry.emit('tree-editor', 'apply-actions', 'end', { applied: totalApplied, entities: entitiesAffected.size }, { status: 'success' })

  eventBus.emit('tree:activity', {
    type: 'curation-complete',
    message: `Tree editor complete: ${totalApplied} actions applied to ${entitiesAffected.size} entit${entitiesAffected.size === 1 ? 'y' : 'ies'}`,
    timestamp: Date.now(),
  })

  logger.info('Tree editor complete', {
    actionsProposed,
    actionsApplied: totalApplied,
    entitiesAffected: entitiesAffected.size,
    searchLoops,
  })

  return {
    actionsProposed,
    actionsApplied: totalApplied,
    entitiesAffected: entitiesAffected.size,
    searchLoops,
  }
}

// ============================================================================
// Per-action human-readable message formatter
// ============================================================================

function formatActionMessage(
  action: CurationAction,
  entityName: string,
  nodeMap: Map<string, KnowledgeNode>
): string | null {
  const label = (id: string) => nodeMap.get(id)?.label ?? id

  switch (action.type) {
    case 'edit':
      return `\u270F\uFE0F Edit "${label(action.node)}" for ${entityName}`
    case 'create':
      return `+ Create "${action.label}" under "${label(action.parent)}" for ${entityName}`
    case 'delete':
      return `\u2717 Delete "${label(action.node)}" for ${entityName} (${action.reason})`
    case 'move':
      return `\u21AA Move "${label(action.node)}" \u2192 "${label(action.newParent)}" for ${entityName}`
    case 'merge':
      return `\u2295 Merge "${label(action.source)}" into "${label(action.target)}" for ${entityName}`
    case 'rename':
      return `\u270E Rename "${label(action.node)}" \u2192 "${action.label}" for ${entityName}`
    case 'split':
      return `\u2442 Split "${label(action.node)}" into ${action.into.length} children for ${entityName}`
    case 'skip':
      return null // Don't log skips
    default:
      return null
  }
}

/** Extract the content/value from an action for display in the activity log */
function formatActionDetail(action: CurationAction): string | undefined {
  switch (action.type) {
    case 'edit':
      return action.summary ?? action.content?.slice(0, 200)
    case 'create':
      return action.summary ?? action.content?.slice(0, 200)
    case 'merge':
      return action.mergedSummary ?? action.mergedContent?.slice(0, 200)
    case 'delete':
      return action.reason
    case 'split':
      return action.into.map(c => c.label).join(', ')
    default:
      return undefined
  }
}

// ============================================================================
// Verification — CREATE dedup check
// ============================================================================

/**
 * For CREATE actions, search the tree for near-matches.
 * If matches found, ask a verification LLM (small tier) whether to still create or convert to edit/skip.
 */
async function verifyCreateActions(
  actions: CurationAction[],
  idMap: ShortIdMap,
  entities: Array<{ id: string; name: string }>
): Promise<CurationAction[]> {
  const createActions = actions.filter(a => a.type === 'create') as Array<CurationAction & { type: 'create' }>
  const nonCreateActions = actions.filter(a => a.type !== 'create')

  if (createActions.length === 0) return actions

  // Extract key words from proposed creates and search for near-matches
  const entityIds = entities.map(e => e.id)
  const allMatches: Array<{ shortId: string; label: string; content: string; entityName: string }> = []

  for (const create of createActions) {
    const searchTerms = create.label.split(/\s+/).filter(w => w.length > 2)
    if (searchTerms.length === 0) continue

    const results = await knowledgeNodeStore.searchNodes(searchTerms, entityIds)
    for (const node of results) {
      const shortId = addMapping(idMap, node.id, 'n')
      const entityName = entities.find(e => e.id === node.entityId)?.name ?? 'unknown'
      allMatches.push({
        shortId,
        label: node.label,
        content: node.content ?? node.summary ?? '(empty)',
        entityName,
      })
    }
  }

  // No matches → all creates are genuine new content
  if (allMatches.length === 0) return actions

  // Ask verification LLM
  try {
    eventBus.emit('tree:activity', {
      type: 'curation-llm-call',
      message: `Tree editor verification (${createActions.length} creates, ${allMatches.length} matches)`,
      timestamp: Date.now(),
    })

    const verifyPrompt = buildVerificationPrompt(
      createActions.map(c => ({
        label: c.label,
        content: c.content,
        parent: c.parent,
        memoryIds: c.memoryIds,
      })),
      allMatches,
    )

    telemetry.emit('tree-editor', 'verify-creates', 'start', {
      createCount: createActions.length,
      matchCount: allMatches.length,
      systemPromptPreview: TREE_EDITOR_VERIFY_SYSTEM_PROMPT,
      promptPreview: verifyPrompt,
      tier: 'small',
    }, { isLLM: true })

    const verifyResult = await callLLM({
      tier: 'small',
      prompt: verifyPrompt,
      systemPrompt: TREE_EDITOR_VERIFY_SYSTEM_PROMPT,
      category: 'tree-editor-verify',
      options: { temperature: 0.1 },
    })

    telemetry.emit('tree-editor', 'verify-creates', 'end', {
      responsePreview: verifyResult.content,
      durationMs: verifyResult.processing_time_ms,
      model: verifyResult.model,
      inputTokens: verifyResult.tokens_used.prompt,
      outputTokens: verifyResult.tokens_used.completion,
    }, { status: 'success', isLLM: true })

    const { data, error } = parseLLMJSON<{ actions?: CurationAction[] }>(verifyResult.content)
    if (error || !data?.actions) {
      logger.warn('Verification parse failed, using original creates', { error })
      return actions
    }

    // Resolve short IDs in verification response
    const verifiedActions = data.actions.map(a => resolveAllShortIds(a, idMap))

    eventBus.emit('tree:activity', {
      type: 'curation-llm-response',
      message: `Verification: ${verifiedActions.length} actions (from ${createActions.length} creates)`,
      timestamp: Date.now(),
    })

    return [...nonCreateActions, ...verifiedActions]
  } catch (error) {
    logger.warn('Verification LLM failed, using original creates', {
      error: error instanceof Error ? error.message : String(error),
    })
    return actions
  }
}

// ============================================================================
// Group Actions by Entity
// ============================================================================

/**
 * Group resolved actions by their target entity.
 * Looks up node.entityId from DB for node-referencing actions.
 * Skip actions are dropped.
 */
async function groupActionsByEntity(
  actions: CurationAction[]
): Promise<Map<string, CurationAction[]>> {
  const groups = new Map<string, CurationAction[]>()

  for (const action of actions) {
    if (action.type === 'skip') continue

    let entityId: string | null = null

    // Determine entity from the action's target node
    if ('node' in action && typeof action.node === 'string') {
      const node = await knowledgeNodeStore.getById(action.node)
      entityId = node?.entityId ?? null
    } else if ('parent' in action && typeof action.parent === 'string') {
      // CREATE action — entity comes from parent node
      const parentNode = await knowledgeNodeStore.getById(action.parent)
      entityId = parentNode?.entityId ?? null
    } else if ('source' in action && typeof action.source === 'string') {
      // MERGE action
      const sourceNode = await knowledgeNodeStore.getById(action.source)
      entityId = sourceNode?.entityId ?? null
    }

    if (!entityId) {
      // Log the full action so we can diagnose unresolved IDs
      const actionAny = action as unknown as Record<string, unknown>
      const idField = 'node' in action ? actionAny.node
        : 'parent' in action ? actionAny.parent
        : 'source' in action ? actionAny.source
        : undefined
      const isUnresolvedShortId = typeof idField === 'string' && /^[a-z]\d+$/.test(idField)
      logger.warn('Dropping action: could not determine entity', {
        type: action.type,
        targetId: idField,
        action: JSON.stringify(action).slice(0, 200),
      })
      telemetry.emit('tree-editor', 'action-dropped', 'end', {
        actionType: action.type,
        targetId: idField,
        reason: isUnresolvedShortId
          ? `Unresolved short ID "${idField}" — not found in idMap`
          : `Node "${idField}" not found in database`,
        actionPreview: JSON.stringify(action).slice(0, 300),
      }, { status: 'error' })
      continue
    }

    if (!groups.has(entityId)) groups.set(entityId, [])
    groups.get(entityId)!.push(action)
  }

  return groups
}
