/**
 * Tree Gap Analysis
 *
 * Scans entity knowledge trees for structural gaps and feeds them into
 * the question generation prompt. Pure analysis — no LLM calls.
 *
 * Three scoring modes:
 * - gap:       empty or thin leaf nodes → prompt user for missing info
 * - depth:     high-mention entities with sparse content → deepen knowledge
 * - staleness: old verified nodes with multiple memories → refresh outdated info
 */

import { knowledgeNodeStore } from '../../../db/stores/knowledgeNodeStore'
import { cooccurrenceStore } from '../../../db/stores/cooccurrenceStore'
import { entityStore } from '../../../db/stores'
import type KnowledgeNode from '../../../db/models/KnowledgeNode'

// ============================================================================
// Types
// ============================================================================

export interface TreeGap {
  entityId: string
  entityName: string
  entityType: string
  mode: 'gap' | 'depth' | 'staleness'
  nodePath: string        // "Identity / Location"
  nodeLabel: string
  nodeId: string
  detail: string          // human-readable gap description
  priority: number        // 0-1 score
}

// ============================================================================
// Main
// ============================================================================

/**
 * Analyze knowledge trees for gaps relevant to the current conversation.
 *
 * 1. Collect conversation entities + co-occurring entities
 * 2. Load tree for each, score gaps across 3 modes
 * 3. Return top gaps sorted by priority
 */
const MAX_ENTITIES = 10
const MAX_NODES_PER_TREE = 20

export async function analyzeTreeGaps(
  conversationEntityIds: string[],
  maxGaps = 8
): Promise<TreeGap[]> {
  // 1. Collect entity IDs: conversation entities first, then co-occurring
  // Conversation entities get priority — co-occurring fill remaining slots
  const orderedIds: string[] = [...conversationEntityIds]
  const seen = new Set(conversationEntityIds)

  for (const eid of conversationEntityIds) {
    if (orderedIds.length >= MAX_ENTITIES) break
    const cluster = await cooccurrenceStore.getCluster(eid, 3)
    for (const coId of cluster) {
      if (orderedIds.length >= MAX_ENTITIES) break
      if (!seen.has(coId)) {
        seen.add(coId)
        orderedIds.push(coId)
      }
    }
  }

  // 2. For each entity, load tree (capped) and score gaps
  const allGaps: TreeGap[] = []
  const conversationSet = new Set(conversationEntityIds)

  for (const entityId of orderedIds) {
    const entity = await entityStore.getById(entityId)
    if (!entity) continue

    const allNodes = await knowledgeNodeStore.getByEntity(entityId)
    if (allNodes.length === 0) continue
    // Cap nodes — getByEntity sorts by depth asc, so shallower nodes come first
    const nodes = allNodes.slice(0, MAX_NODES_PER_TREE)

    const isConversationEntity = conversationSet.has(entityId)

    // --- Gap mode: empty or thin leaf nodes ---
    for (const node of nodes) {
      if (node.isDeleted) continue
      if (node.nodeType === 'group') continue // groups are containers

      const contentLen = (node.content ?? '').length
      const isEmpty = contentLen === 0
      const isThin = contentLen > 0 && contentLen < 50

      if (isEmpty || isThin) {
        let priority = isEmpty ? 0.7 : 0.4
        if (isConversationEntity) priority += 0.2
        priority = Math.min(priority, 1)

        allGaps.push({
          entityId,
          entityName: entity.name,
          entityType: entity.type,
          mode: 'gap',
          nodePath: getNodePath(node, nodes),
          nodeLabel: node.label,
          nodeId: node.id,
          detail: isEmpty
            ? `No information captured for "${node.label}"`
            : `Only brief info for "${node.label}" (${contentLen} chars)`,
          priority,
        })
      }
    }

    // --- Depth mode: high-mention entities with sparse tree content ---
    if (entity.mentionCount > 8) {
      const totalContent = nodes.reduce((sum, n) => sum + (n.content ?? '').length, 0)
      if (totalContent < 100) {
        const maxCooc = await getMaxCooccurrence(entityId, conversationEntityIds)
        if (maxCooc > 5 || isConversationEntity) {
          // Find the root or shallowest non-group node to attach gap to
          const targetNode = nodes.find(n => !n.isDeleted && n.nodeType !== 'group') ?? nodes[0]
          allGaps.push({
            entityId,
            entityName: entity.name,
            entityType: entity.type,
            mode: 'depth',
            nodePath: getNodePath(targetNode, nodes),
            nodeLabel: targetNode.label,
            nodeId: targetNode.id,
            detail: `"${entity.name}" mentioned ${entity.mentionCount} times but tree has very little content`,
            priority: isConversationEntity ? 0.8 : 0.5,
          })
        }
      }
    }

    // --- Staleness mode: old verified nodes with multiple memories ---
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    const staleCutoff = Date.now() - SEVEN_DAYS

    for (const node of nodes) {
      if (node.isDeleted) continue
      if (node.modifiedAt >= staleCutoff) continue
      if (node.verification === 'unverified') continue
      if (node.memoryIdsParsed.length < 2) continue

      allGaps.push({
        entityId,
        entityName: entity.name,
        entityType: entity.type,
        mode: 'staleness',
        nodePath: getNodePath(node, nodes),
        nodeLabel: node.label,
        nodeId: node.id,
        detail: `"${node.label}" hasn't been updated in over a week`,
        priority: isConversationEntity ? 0.5 : 0.3,
      })
    }
  }

  // 3. Sort by priority desc, return top maxGaps
  allGaps.sort((a, b) => b.priority - a.priority)
  return allGaps.slice(0, maxGaps)
}

// ============================================================================
// Helpers
// ============================================================================

/** Walk parentId chain to build "Parent / Child" path string */
function getNodePath(node: KnowledgeNode, allNodes: KnowledgeNode[]): string {
  const nodeMap = new Map(allNodes.map(n => [n.id, n]))
  const parts: string[] = [node.label]

  let current = node
  while (current.parentId) {
    const parent = nodeMap.get(current.parentId)
    if (!parent) break
    parts.unshift(parent.label)
    current = parent
  }

  return parts.join(' / ')
}

/** Get max cooccurrence count between entityId and any conversation entity */
async function getMaxCooccurrence(
  entityId: string,
  conversationEntityIds: string[]
): Promise<number> {
  let max = 0
  for (const convEid of conversationEntityIds) {
    const count = await cooccurrenceStore.getCount(entityId, convEid)
    if (count > max) max = count
  }
  return max
}
