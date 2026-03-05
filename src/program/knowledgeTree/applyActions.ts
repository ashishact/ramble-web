/**
 * Action Handlers — validates and applies curation actions to the DB.
 *
 * Each action type gets a handler. Invalid actions are logged and skipped,
 * never failing the batch.
 */

import { knowledgeNodeStore } from '../../db/stores'
import type KnowledgeNode from '../../db/models/KnowledgeNode'
import type { NodeType } from '../../db/models/KnowledgeNode'
import type { CurationAction } from './types'
import { createLogger } from '../utils/logger'

const logger = createLogger('TreeCuration')

// ============================================================================
// Validation
// ============================================================================

interface ValidationContext {
  nodeMap: Map<string, KnowledgeNode>   // all nodes in this entity tree
  entityId: string
}

function getNode(ctx: ValidationContext, id: string): KnowledgeNode | null {
  return ctx.nodeMap.get(id) ?? null
}

function isRootNode(ctx: ValidationContext, id: string): boolean {
  const node = getNode(ctx, id)
  return node ? node.parentId === null : false
}

/**
 * Check for circular reference: walk up from targetId to root.
 * If we encounter nodeId, it would create a cycle.
 */
function wouldCreateCycle(ctx: ValidationContext, nodeId: string, targetParentId: string): boolean {
  let current: string | null = targetParentId
  while (current) {
    if (current === nodeId) return true
    const node = getNode(ctx, current)
    current = node?.parentId ?? null
  }
  return false
}

// ============================================================================
// Action Handlers
// ============================================================================

async function handleEdit(
  action: CurationAction & { type: 'edit' },
  ctx: ValidationContext
): Promise<boolean> {
  const node = getNode(ctx, action.node)
  if (!node) {
    logger.warn('Edit: node not found', { nodeId: action.node })
    return false
  }
  if (node.entityId !== ctx.entityId) {
    logger.warn('Edit: node belongs to different entity', { nodeId: action.node })
    return false
  }

  const updates: Parameters<typeof knowledgeNodeStore.update>[1] = {}
  if (action.content !== undefined) updates.content = action.content
  if (action.summary !== undefined) updates.summary = action.summary

  // Append new memoryIds (union with existing, no duplicates)
  if (action.memoryIds && action.memoryIds.length > 0) {
    const existing = node.memoryIdsParsed
    const merged = [...new Set([...existing, ...action.memoryIds])]
    updates.memoryIds = merged
  }

  await knowledgeNodeStore.update(action.node, updates)
  return true
}

async function handleCreate(
  action: CurationAction & { type: 'create' },
  ctx: ValidationContext
): Promise<boolean> {
  const parent = getNode(ctx, action.parent)
  if (!parent) {
    logger.warn('Create: parent not found', { parentId: action.parent })
    return false
  }
  if (!action.label || action.label.trim().length === 0) {
    logger.warn('Create: empty label')
    return false
  }

  // Determine sort order: after insertAfter sibling, or at end
  let sortOrder = parent.childCount
  if (action.insertAfter) {
    const sibling = getNode(ctx, action.insertAfter)
    if (sibling) sortOrder = sibling.sortOrder + 1
  }

  const node = await knowledgeNodeStore.create({
    entityId: ctx.entityId,
    parentId: action.parent,
    depth: parent.depth + 1,
    sortOrder,
    label: action.label,
    content: action.content,
    summary: action.summary,
    nodeType: (action.nodeType as NodeType) ?? 'text',
    memoryIds: action.memoryIds,
    source: 'inferred',
    verification: 'unverified',
  })

  // Add to context so subsequent actions can reference this node
  ctx.nodeMap.set(node.id, node)

  return true
}

async function handleDelete(
  action: CurationAction & { type: 'delete' },
  ctx: ValidationContext
): Promise<boolean> {
  const node = getNode(ctx, action.node)
  if (!node) {
    logger.warn('Delete: node not found', { nodeId: action.node })
    return false
  }
  if (isRootNode(ctx, action.node) && node.depth === 0) {
    logger.warn('Delete: cannot delete root-level node', { nodeId: action.node })
    return false
  }

  // Re-parent children to deleted node's parent
  await knowledgeNodeStore.reparentChildren(action.node, node.parentId)

  // Soft-delete
  await knowledgeNodeStore.softDelete(action.node)
  logger.info('Deleted node', { nodeId: action.node, reason: action.reason })
  return true
}

async function handleMove(
  action: CurationAction & { type: 'move' },
  ctx: ValidationContext
): Promise<boolean> {
  const node = getNode(ctx, action.node)
  const newParent = getNode(ctx, action.newParent)
  if (!node || !newParent) {
    logger.warn('Move: node or parent not found', { node: action.node, newParent: action.newParent })
    return false
  }

  // Check for circular reference
  if (wouldCreateCycle(ctx, action.node, action.newParent)) {
    logger.warn('Move: would create circular reference', { node: action.node, newParent: action.newParent })
    return false
  }

  const newDepth = newParent.depth + 1
  const depthDiff = newDepth - node.depth

  let sortOrder = newParent.childCount
  if (action.insertAfter) {
    const sibling = getNode(ctx, action.insertAfter)
    if (sibling) sortOrder = sibling.sortOrder + 1
  }

  await knowledgeNodeStore.update(action.node, {
    parentId: action.newParent,
    depth: newDepth,
    sortOrder,
  })

  // Recursively update descendant depths
  if (depthDiff !== 0) {
    await knowledgeNodeStore._updateDescendantDepths(action.node, depthDiff)
  }

  return true
}

async function handleMerge(
  action: CurationAction & { type: 'merge' },
  ctx: ValidationContext
): Promise<boolean> {
  const source = getNode(ctx, action.source)
  const target = getNode(ctx, action.target)
  if (!source || !target) {
    logger.warn('Merge: source or target not found', { source: action.source, target: action.target })
    return false
  }
  if (action.source === action.target) {
    logger.warn('Merge: source and target are the same')
    return false
  }
  if (source.entityId !== target.entityId) {
    logger.warn('Merge: nodes belong to different entities')
    return false
  }

  // Update target with merged content
  const existingMemoryIds = target.memoryIdsParsed
  const sourceMemoryIds = source.memoryIdsParsed
  const mergedMemoryIds = [...new Set([...existingMemoryIds, ...sourceMemoryIds])]

  await knowledgeNodeStore.update(action.target, {
    content: action.mergedContent,
    summary: action.mergedSummary,
    memoryIds: mergedMemoryIds,
  })

  // Re-parent source's children to target
  await knowledgeNodeStore.reparentChildren(action.source, action.target)

  // Soft-delete source
  await knowledgeNodeStore.softDelete(action.source)

  return true
}

async function handleRename(
  action: CurationAction & { type: 'rename' },
  ctx: ValidationContext
): Promise<boolean> {
  const node = getNode(ctx, action.node)
  if (!node) {
    logger.warn('Rename: node not found', { nodeId: action.node })
    return false
  }
  if (!action.label || action.label.trim().length === 0) {
    logger.warn('Rename: empty label')
    return false
  }

  await knowledgeNodeStore.update(action.node, { label: action.label })
  return true
}

async function handleSplit(
  action: CurationAction & { type: 'split' },
  ctx: ValidationContext
): Promise<boolean> {
  const node = getNode(ctx, action.node)
  if (!node) {
    logger.warn('Split: node not found', { nodeId: action.node })
    return false
  }
  if (!action.into || action.into.length < 2) {
    logger.warn('Split: need at least 2 entries in "into"')
    return false
  }

  // Convert original node to group, clear its content
  await knowledgeNodeStore.update(action.node, {
    nodeType: 'group',
    content: null,
    summary: null,
  })

  // Create new children from "into" array
  for (let i = 0; i < action.into.length; i++) {
    const item = action.into[i]
    const child = await knowledgeNodeStore.create({
      entityId: ctx.entityId,
      parentId: action.node,
      depth: node.depth + 1,
      sortOrder: i,
      label: item.label,
      content: item.content,
      summary: item.summary,
      nodeType: 'text',
      memoryIds: item.memoryIds,
      source: 'inferred',
      verification: 'unverified',
    })
    ctx.nodeMap.set(child.id, child)
  }

  return true
}

// ============================================================================
// Main Apply Function
// ============================================================================

/**
 * Validate and apply a list of curation actions to the DB.
 * Invalid actions are logged and skipped; valid ones are applied in order.
 * Returns only the successfully applied actions.
 */
export async function validateAndApplyActions(
  actions: CurationAction[],
  entityId: string,
  existingNodes: KnowledgeNode[]
): Promise<CurationAction[]> {
  const ctx: ValidationContext = {
    nodeMap: new Map(existingNodes.map(n => [n.id, n])),
    entityId,
  }

  const applied: CurationAction[] = []

  for (const action of actions) {
    let success = false

    try {
      switch (action.type) {
        case 'edit':
          success = await handleEdit(action, ctx)
          break
        case 'create':
          success = await handleCreate(action, ctx)
          break
        case 'delete':
          success = await handleDelete(action, ctx)
          break
        case 'move':
          success = await handleMove(action, ctx)
          break
        case 'merge':
          success = await handleMerge(action, ctx)
          break
        case 'rename':
          success = await handleRename(action, ctx)
          break
        case 'split':
          success = await handleSplit(action, ctx)
          break
        case 'skip':
          logger.debug('Skip action', { reason: (action as { reason: string }).reason })
          success = true
          break
        // Phase 4 stubs
        case 'retype':
          logger.info('Retype action (Phase 4 stub, skipping)', { node: action.node })
          success = true
          break
        case 'link':
          logger.info('Link action (Phase 4 stub, skipping)', { fromNode: action.fromNode })
          success = true
          break
        case 'verify':
          logger.info('Verify action (Phase 4 stub, skipping)', { node: action.node })
          success = true
          break
        default:
          logger.warn('Unknown action type', { action })
          break
      }
    } catch (error) {
      logger.error('Action handler failed', {
        type: action.type,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }

    if (success) {
      applied.push(action)
    }
  }

  return applied
}
