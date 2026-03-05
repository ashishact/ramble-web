/**
 * Tree Formatter — formats a knowledge tree for LLM consumption with smart skipping.
 *
 * Nodes are displayed with short IDs (n1, n2...) so the LLM can reference them.
 * Collapsed group nodes show child label summaries as a table of contents.
 * Expanded nodes show full content or summary.
 */

import type KnowledgeNode from '../../db/models/KnowledgeNode'
import type { ShortIdMap } from './types'
import { addMapping } from './shortIdMap'

// ============================================================================
// Relevance Ranking
// ============================================================================

/**
 * Simple keyword-based relevance scoring for nodes.
 * Tokenizes new memories into words and checks if any word matches node labels.
 * Returns a Map of nodeId → relevance score (higher = more relevant, should expand).
 */
export function rankNodesByRelevance(
  nodes: KnowledgeNode[],
  newMemories: Array<{ id: string; content: string; type: string }>,
  _conversationContext: string
): Map<string, number> {
  const scores = new Map<string, number>()

  // Tokenize all memory content into lowercase words
  const allText = newMemories.map(m => m.content).join(' ')
  const words = new Set(
    allText.toLowerCase().split(/[\s,.:;!?'"()\[\]{}]+/).filter(w => w.length > 2)
  )

  for (const node of nodes) {
    let score = 0
    const labelLower = node.label.toLowerCase()
    const summaryLower = (node.summary ?? '').toLowerCase()

    // Check if any memory word matches this node's label
    for (const word of words) {
      if (labelLower.includes(word)) score += 2
      if (summaryLower.includes(word)) score += 1
    }

    // L0/L1 nodes (depth 0 or 1) always get a base score
    if (node.depth <= 1) score += 1

    scores.set(node.id, score)
  }

  return scores
}

// ============================================================================
// Tree Formatting
// ============================================================================

interface TreeNode {
  node: KnowledgeNode
  children: TreeNode[]
}

/**
 * Build a tree structure from flat node list.
 */
function buildTree(nodes: KnowledgeNode[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  // Create TreeNode wrappers
  for (const node of nodes) {
    if (node.isDeleted) continue
    nodeMap.set(node.id, { node, children: [] })
  }

  // Wire parent-child relationships
  for (const [, treeNode] of nodeMap) {
    if (treeNode.node.parentId && nodeMap.has(treeNode.node.parentId)) {
      nodeMap.get(treeNode.node.parentId)!.children.push(treeNode)
    } else {
      roots.push(treeNode)
    }
  }

  // Sort children by sortOrder
  for (const [, treeNode] of nodeMap) {
    treeNode.children.sort((a, b) => a.node.sortOrder - b.node.sortOrder)
  }

  roots.sort((a, b) => a.node.sortOrder - b.node.sortOrder)
  return roots
}

/**
 * Determine the expansion threshold — nodes above this score get expanded.
 * Top ~30% of scored nodes or minimum of 3.
 */
function getExpansionThreshold(scores: Map<string, number>): number {
  const values = [...scores.values()].filter(v => v > 0).sort((a, b) => b - a)
  if (values.length === 0) return 1
  const idx = Math.min(Math.max(Math.floor(values.length * 0.3), 3), values.length - 1)
  return values[idx] ?? 1
}

/**
 * Format child labels as a parenthetical table of contents.
 * E.g., "(5 children: Abha, Prashanth, Chetan, ...and 2 more)"
 */
function formatChildSummary(children: TreeNode[], idMap: ShortIdMap): string {
  const visibleChildren = children.filter(c => !c.node.isDeleted)
  if (visibleChildren.length === 0) return '(empty)'

  const MAX_SHOWN = 3
  const labels = visibleChildren.map(c => c.node.label)

  if (labels.length <= MAX_SHOWN + 2) {
    // Show all if 5 or fewer
    return `(${labels.length} children: ${labels.join(', ')})`
  }

  const shown = labels.slice(0, MAX_SHOWN)
  const remaining = labels.length - MAX_SHOWN

  // Include short IDs for collapsed children so LLM can EXPAND
  void idMap // referenced for future use
  return `(${labels.length} children: ${shown.join(', ')}, ...and ${remaining} more)`
}

/**
 * Format the tree with smart skipping for LLM consumption.
 *
 * Output format:
 * ```
 * Entity Name [e1]
 *   Identity [n1]
 *     ├── [n2] Role: "Founder, building Ramble..."
 *     └── [n3] Location: (empty)
 *   Relationships [n4] (5 children: Abha, Prashanth, ...)
 * ```
 */
export function formatWithSkipping(
  nodes: KnowledgeNode[],
  relevanceScores: Map<string, number>,
  idMap: ShortIdMap,
  entityName?: string,
  entityShortId?: string
): string {
  const tree = buildTree(nodes)
  const threshold = getExpansionThreshold(relevanceScores)
  const lines: string[] = []

  if (entityName && entityShortId) {
    lines.push(`${entityName} [${entityShortId}]`)
  }

  function formatNode(treeNode: TreeNode, indent: string, isLast: boolean, isRoot: boolean) {
    const { node, children } = treeNode
    const shortId = addMapping(idMap, node.id, 'n')
    const score = relevanceScores.get(node.id) ?? 0
    const shouldExpand = score >= threshold || node.depth <= 1

    const prefix = isRoot ? '' : (isLast ? '└── ' : '├── ')
    const childIndent = isRoot ? indent + '  ' : indent + (isLast ? '    ' : '│   ')

    if (shouldExpand && children.length > 0) {
      // Expanded group: show label + recurse into children
      lines.push(`${indent}${prefix}${node.label} [${shortId}]`)
      for (let i = 0; i < children.length; i++) {
        formatNode(children[i], childIndent, i === children.length - 1, false)
      }
    } else if (children.length > 0) {
      // Collapsed group: show label + child summary
      const summary = formatChildSummary(children, idMap)
      lines.push(`${indent}${prefix}[${shortId}] ${node.label} ${summary}`)
      // Still add children to idMap so LLM can EXPAND them
      for (const child of children) {
        addMapping(idMap, child.node.id, 'n')
      }
    } else if (node.content || node.summary) {
      // Leaf with content
      const display = node.summary ?? node.content?.slice(0, 80) ?? ''
      lines.push(`${indent}${prefix}[${shortId}] ${node.label}: "${display}"`)
    } else {
      // Empty leaf
      lines.push(`${indent}${prefix}[${shortId}] ${node.label}: (empty)`)
    }
  }

  for (let i = 0; i < tree.length; i++) {
    formatNode(tree[i], '  ', i === tree.length - 1, true)
  }

  return lines.join('\n')
}

/**
 * Format expanded node content for follow-up turns.
 */
export function formatExpandedNode(
  children: KnowledgeNode[],
  idMap: ShortIdMap
): string {
  const lines: string[] = ['\n--- Expanded Node ---']
  for (const child of children) {
    const shortId = addMapping(idMap, child.id, 'n')
    const content = child.content ?? child.summary ?? '(empty)'
    lines.push(`[${shortId}] ${child.label}: "${content}"`)
  }
  return lines.join('\n')
}

/**
 * Format search results for follow-up turns.
 */
export function formatSearchResults(
  results: KnowledgeNode[],
  idMap: ShortIdMap
): string {
  if (results.length === 0) return '\n--- Search Results ---\nNo matching nodes found.'

  const lines: string[] = ['\n--- Search Results ---']
  for (const node of results.slice(0, 10)) {
    const shortId = addMapping(idMap, node.id, 'n')
    const content = node.summary ?? node.content?.slice(0, 100) ?? '(empty)'
    lines.push(`[${shortId}] ${node.label} (entity: ${node.entityId}): "${content}"`)
  }
  return lines.join('\n')
}
