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

import { graphMutations } from '../../../graph/data'
import type { KnowledgeNodeItem, EntityItem } from '../../../graph/data'

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
// Row parsers
// ============================================================================

function parseKnowledgeNode(row: Record<string, unknown>): KnowledgeNodeItem {
  const props = typeof row.properties === 'string'
    ? JSON.parse(row.properties as string)
    : (row.properties ?? {}) as Record<string, unknown>
  return { ...row, ...(props as Record<string, unknown>) } as unknown as KnowledgeNodeItem
}

function isDeleted(node: KnowledgeNodeItem): boolean {
  return (node.metadata as Record<string, unknown>)?.deleted === true
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
  const orderedIds: string[] = [...conversationEntityIds]
  const seen = new Set(conversationEntityIds)

  for (const eid of conversationEntityIds) {
    if (orderedIds.length >= MAX_ENTITIES) break
    const cluster = await getCooccurrenceCluster(eid, 3)
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
    const entity = await getEntityById(entityId)
    if (!entity) continue

    const allNodes = await getKnowledgeNodesByEntity(entityId)
    if (allNodes.length === 0) continue
    // Cap nodes — sorted by depth asc, so shallower nodes come first
    const nodes = allNodes.slice(0, MAX_NODES_PER_TREE)

    const isConversationEntity = conversationSet.has(entityId)

    // --- Gap mode: empty or thin leaf nodes ---
    for (const node of nodes) {
      if (isDeleted(node)) continue
      if (node.nodeType === 'group') continue

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
    if ((entity.mentionCount ?? 0) > 8) {
      const totalContent = nodes.reduce((sum, n) => sum + (n.content ?? '').length, 0)
      if (totalContent < 100) {
        const maxCooc = await getMaxCooccurrence(entityId, conversationEntityIds)
        if (maxCooc > 5 || isConversationEntity) {
          const targetNode = nodes.find(n => !isDeleted(n) && n.nodeType !== 'group') ?? nodes[0]
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
      if (isDeleted(node)) continue
      if ((node.modifiedAt ?? node.updatedAt) >= staleCutoff) continue
      if (node.verification === 'unverified') continue
      if ((node.memoryIds ?? []).length < 2) continue

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
// Graph query helpers
// ============================================================================

async function getEntityById(entityId: string): Promise<EntityItem | null> {
  const node = await graphMutations.getNode(entityId)
  if (!node) return null
  const props = typeof node.properties === 'string'
    ? JSON.parse(node.properties as unknown as string)
    : node.properties
  return { id: node.id, ...(props as Record<string, unknown>) } as unknown as EntityItem
}

async function getKnowledgeNodesByEntity(entityId: string): Promise<KnowledgeNodeItem[]> {
  const rows = await graphMutations.query<Record<string, unknown>>(
    `SELECT * FROM nodes WHERE list_contains(labels, 'knowledge_node')
     AND json_extract_string(properties, '$.entityId') = $1
     ORDER BY CAST(json_extract(properties, '$.depth') AS INT) ASC,
              CAST(json_extract(properties, '$.sortOrder') AS INT) ASC`,
    [entityId]
  )
  return rows.map(parseKnowledgeNode)
}

/** Get co-occurring entity IDs with count >= minStrength */
async function getCooccurrenceCluster(entityId: string, minStrength: number): Promise<string[]> {
  // Query edges of type COOCCURS where this entity is involved
  const rows = await graphMutations.query<Record<string, unknown>>(
    `SELECT start_id, end_id, properties FROM edges
     WHERE type = 'COOCCURS'
     AND (start_id = $1 OR end_id = $1)`,
    [entityId]
  )

  const results: string[] = []
  for (const row of rows) {
    const props = typeof row.properties === 'string'
      ? JSON.parse(row.properties as string)
      : (row.properties ?? {}) as Record<string, unknown>
    const count = (props.count as number) ?? 0
    if (count >= minStrength) {
      const otherId = (row.start_id as string) === entityId
        ? (row.end_id as string)
        : (row.start_id as string)
      results.push(otherId)
    }
  }
  return results
}

/** Get max cooccurrence count between entityId and any conversation entity */
async function getMaxCooccurrence(
  entityId: string,
  conversationEntityIds: string[]
): Promise<number> {
  let max = 0
  for (const convEid of conversationEntityIds) {
    const count = await getCooccurrenceCount(entityId, convEid)
    if (count > max) max = count
  }
  return max
}

async function getCooccurrenceCount(entityIdA: string, entityIdB: string): Promise<number> {
  const [eA, eB] = entityIdA < entityIdB ? [entityIdA, entityIdB] : [entityIdB, entityIdA]
  const rows = await graphMutations.query<Record<string, unknown>>(
    `SELECT properties FROM edges
     WHERE type = 'COOCCURS' AND start_id = $1 AND end_id = $2
     LIMIT 1`,
    [eA, eB]
  )
  if (rows.length === 0) return 0
  const props = typeof rows[0].properties === 'string'
    ? JSON.parse(rows[0].properties as string)
    : (rows[0].properties ?? {}) as Record<string, unknown>
  return (props.count as number) ?? 0
}

// ============================================================================
// Helpers
// ============================================================================

/** Walk parentId chain to build "Parent / Child" path string */
function getNodePath(node: KnowledgeNodeItem, allNodes: KnowledgeNodeItem[]): string {
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
