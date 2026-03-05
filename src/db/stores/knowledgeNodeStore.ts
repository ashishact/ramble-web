import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import KnowledgeNode from '../models/KnowledgeNode'
import type { NodeType, NodeSource, NodeVerification } from '../models/KnowledgeNode'
import type { TreeTemplate, TemplateNode } from '../../program/knowledgeTree/types'

const knowledgeNodes = database.get<KnowledgeNode>('knowledge_nodes')

export interface NodeOutline {
  id: string
  label: string
  summary: string | null
  childCount: number
  depth: number
}

export const knowledgeNodeStore = {
  async getByEntity(entityId: string): Promise<KnowledgeNode[]> {
    return await knowledgeNodes
      .query(
        Q.where('entityId', entityId),
        Q.sortBy('depth', Q.asc),
        Q.sortBy('sortOrder', Q.asc)
      )
      .fetch()
  },

  async getChildren(parentId: string): Promise<KnowledgeNode[]> {
    return await knowledgeNodes
      .query(
        Q.where('parentId', parentId),
        Q.sortBy('sortOrder', Q.asc)
      )
      .fetch()
  },

  async getSubtree(nodeId: string): Promise<KnowledgeNode[]> {
    // Get the node itself + all descendants by walking the tree
    const node = await this.getById(nodeId)
    if (!node) return []

    const result: KnowledgeNode[] = [node]
    const queue = [nodeId]

    while (queue.length > 0) {
      const parentId = queue.shift()!
      const children = await this.getChildren(parentId)
      for (const child of children) {
        result.push(child)
        queue.push(child.id)
      }
    }

    return result
  },

  async getRoots(): Promise<KnowledgeNode[]> {
    return await knowledgeNodes
      .query(
        Q.where('parentId', null),
        Q.sortBy('sortOrder', Q.asc)
      )
      .fetch()
  },

  async getById(id: string): Promise<KnowledgeNode | null> {
    try {
      return await knowledgeNodes.find(id)
    } catch {
      return null
    }
  },

  async create(data: {
    entityId: string
    parentId?: string | null
    depth: number
    sortOrder: number
    label: string
    summary?: string | null
    content?: string | null
    nodeType: NodeType
    source?: NodeSource
    verification?: NodeVerification
    memoryIds?: string[]
    templateKey?: string | null
    metadata?: Record<string, unknown>
  }): Promise<KnowledgeNode> {
    const now = Date.now()
    return await database.write(async () => {
      return await knowledgeNodes.create((n) => {
        n.entityId = data.entityId
        n.parentId = data.parentId ?? null
        n.depth = data.depth
        n.sortOrder = data.sortOrder
        n.label = data.label
        n.summary = data.summary ?? null
        n.content = data.content ?? null
        n.nodeType = data.nodeType
        n.source = data.source ?? 'inferred'
        n.verification = data.verification ?? 'unverified'
        n.memoryIds = JSON.stringify(data.memoryIds ?? [])
        n.templateKey = data.templateKey ?? null
        n.childCount = 0
        n.metadata = JSON.stringify(data.metadata ?? {})
        n.createdAt = now
        n.modifiedAt = now
      })
    })
  },

  async update(id: string, data: {
    label?: string
    summary?: string | null
    content?: string | null
    nodeType?: NodeType
    source?: NodeSource
    verification?: NodeVerification
    memoryIds?: string[]
    parentId?: string | null
    depth?: number
    sortOrder?: number
    childCount?: number
    metadata?: Record<string, unknown>
  }): Promise<void> {
    try {
      const node = await knowledgeNodes.find(id)
      await database.write(async () => {
        await node.update((n) => {
          if (data.label !== undefined) n.label = data.label
          if (data.summary !== undefined) n.summary = data.summary
          if (data.content !== undefined) n.content = data.content
          if (data.nodeType !== undefined) n.nodeType = data.nodeType
          if (data.source !== undefined) n.source = data.source
          if (data.verification !== undefined) n.verification = data.verification
          if (data.memoryIds !== undefined) n.memoryIds = JSON.stringify(data.memoryIds)
          if (data.parentId !== undefined) n.parentId = data.parentId
          if (data.depth !== undefined) n.depth = data.depth
          if (data.sortOrder !== undefined) n.sortOrder = data.sortOrder
          if (data.childCount !== undefined) n.childCount = data.childCount
          if (data.metadata !== undefined) n.metadata = JSON.stringify(data.metadata)
          n.modifiedAt = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },

  async softDelete(id: string): Promise<void> {
    try {
      const node = await knowledgeNodes.find(id)
      const meta = node.metadataParsed
      await database.write(async () => {
        await node.update((n) => {
          n.metadata = JSON.stringify({ ...meta, deleted: true })
          n.modifiedAt = Date.now()
        })
      })
    } catch {
      // Not found
    }
  },

  async reparentChildren(fromId: string, toId: string | null): Promise<void> {
    const children = await this.getChildren(fromId)
    // Determine new depth: if toId is null (reparent to root), depth = 0
    // Otherwise, get the target node's depth + 1
    let newDepth = 0
    if (toId) {
      const target = await this.getById(toId)
      if (target) newDepth = target.depth + 1
    }

    for (const child of children) {
      const depthDiff = newDepth - child.depth
      await this.update(child.id, { parentId: toId, depth: newDepth })
      // Recursively update descendant depths
      await this._updateDescendantDepths(child.id, depthDiff)
    }
  },

  async _updateDescendantDepths(parentId: string, depthDiff: number): Promise<void> {
    if (depthDiff === 0) return
    const children = await this.getChildren(parentId)
    for (const child of children) {
      await this.update(child.id, { depth: child.depth + depthDiff })
      await this._updateDescendantDepths(child.id, depthDiff)
    }
  },

  async refreshChildCounts(entityId: string): Promise<void> {
    const allNodes = await this.getByEntity(entityId)
    const countMap = new Map<string, number>()

    // Count children per parent
    for (const node of allNodes) {
      if (node.isDeleted) continue
      if (node.parentId) {
        countMap.set(node.parentId, (countMap.get(node.parentId) ?? 0) + 1)
      }
    }

    // Update all nodes whose childCount is stale
    for (const node of allNodes) {
      const expected = countMap.get(node.id) ?? 0
      if (node.childCount !== expected) {
        await this.update(node.id, { childCount: expected })
      }
    }
  },

  async createTreeFromTemplate(entityId: string, template: TreeTemplate): Promise<KnowledgeNode[]> {
    const created: KnowledgeNode[] = []

    const createFromNodes = async (
      nodes: TemplateNode[],
      parentId: string | null,
      depth: number
    ) => {
      for (let i = 0; i < nodes.length; i++) {
        const tNode = nodes[i]
        const node = await this.create({
          entityId,
          parentId,
          depth,
          sortOrder: i,
          label: tNode.label,
          nodeType: tNode.nodeType as NodeType,
          templateKey: tNode.key,
          source: 'inferred',
          verification: 'unverified',
        })
        created.push(node)

        if (tNode.children && tNode.children.length > 0) {
          await createFromNodes(tNode.children, node.id, depth + 1)
        }
      }
    }

    await createFromNodes(template.nodes, null, 0)

    // Update child counts after creation
    await this.refreshChildCounts(entityId)

    return created
  },

  async getOutline(entityId: string): Promise<NodeOutline[]> {
    const nodes = await this.getByEntity(entityId)
    return nodes
      .filter(n => !n.isDeleted)
      .map(n => ({
        id: n.id,
        label: n.label,
        summary: n.summary,
        childCount: n.childCount,
        depth: n.depth,
      }))
  },

  async searchNodes(terms: string[], entityIds?: string[]): Promise<KnowledgeNode[]> {
    let candidates: KnowledgeNode[]

    if (entityIds && entityIds.length > 0) {
      // Search within specific entity trees
      const allResults: KnowledgeNode[] = []
      for (const eid of entityIds) {
        const nodes = await this.getByEntity(eid)
        allResults.push(...nodes)
      }
      candidates = allResults
    } else {
      // Search across all nodes
      candidates = await knowledgeNodes.query().fetch()
    }

    const lowerTerms = terms.map(t => t.toLowerCase())

    return candidates.filter(node => {
      if (node.isDeleted) return false
      const labelLower = node.label.toLowerCase()
      const summaryLower = (node.summary ?? '').toLowerCase()
      const contentLower = (node.content ?? '').toLowerCase()
      return lowerTerms.some(term =>
        labelLower.includes(term) ||
        summaryLower.includes(term) ||
        contentLower.includes(term)
      )
    })
  },

  async getAll(): Promise<KnowledgeNode[]> {
    return await knowledgeNodes.query().fetch()
  },

  async delete(id: string): Promise<boolean> {
    try {
      const node = await knowledgeNodes.find(id)
      await database.write(async () => {
        await node.destroyPermanently()
      })
      return true
    } catch {
      return false
    }
  },
}
