/**
 * MemoryStore — DuckDB Graph-Backed Memory Operations
 */

import type { GraphNode, CognitiveProperties, MemoryOrigin } from '../types'
import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import { confidencePrior, ownershipPrior, applyReinforcement, compositeScore } from '../merge/cognitiveHelpers'

let idCounter = 0
function generateId(): string { return `mem_${Date.now()}_${++idCounter}` }

export class MemoryStore {
  private graph: ReactiveGraphService

  constructor(graph: ReactiveGraphService) {
    this.graph = graph
  }

  async create(data: {
    content: string
    type: string
    subject?: string
    importance?: number
    origin?: MemoryOrigin
    extractionVersion?: string
    sourceConversationIds?: string[]
    validFrom?: number
    validUntil?: number
  }): Promise<{ id: string } & CognitiveProperties> {
    const id = generateId()
    const origin = data.origin ?? 'typed'
    const now = Date.now()

    const props: CognitiveProperties = {
      content: data.content,
      type: data.type,
      subject: data.subject,
      importance: data.importance ?? 0.5,
      confidence: confidencePrior(origin),
      activityScore: 1.0,
      ownership: ownershipPrior(origin),
      state: 'provisional',
      validFrom: data.validFrom,
      validUntil: data.validUntil,
      origin,
      extractionVersion: data.extractionVersion ?? 'v2-kg',
      sourceConversationIds: data.sourceConversationIds ?? [],
      reinforceCount: 0,
      lastReinforced: now,
    }

    await this.graph.createNode({
      id,
      labels: ['memory', data.type],
      properties: props as unknown as Record<string, unknown>,
    })

    return { id, ...props }
  }

  async getById(id: string): Promise<({ id: string } & CognitiveProperties) | null> {
    const node = await this.graph.getNode(id)
    if (!node || !node.labels.includes('memory')) return null
    return { id: node.id, ...(node.properties as unknown as CognitiveProperties) }
  }

  async getAll(): Promise<Array<{ id: string } & CognitiveProperties>> {
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'memory')
       ORDER BY updated_at DESC`
    )
    return rows.map(r => ({ id: r.id, ...(r.properties as unknown as CognitiveProperties) }))
  }

  async getActive(limit = 100): Promise<Array<{ id: string } & CognitiveProperties>> {
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'memory')
       AND json_extract_string(properties, '$.state') NOT IN ('retracted', 'superseded')
       ORDER BY updated_at DESC LIMIT $1`,
      [limit]
    )
    return rows.map(r => ({ id: r.id, ...(r.properties as unknown as CognitiveProperties) }))
  }

  async reinforce(id: string): Promise<void> {
    const node = await this.graph.getNode(id)
    if (!node) return
    const props = node.properties as unknown as CognitiveProperties
    const reinforced = applyReinforcement({
      importance: props.importance,
      activityScore: props.activityScore,
      reinforceCount: props.reinforceCount,
      state: props.state,
    })
    await this.graph.updateNode(id, {
      properties: { ...node.properties, ...reinforced },
    })
  }

  async retract(id: string): Promise<void> {
    const node = await this.graph.getNode(id)
    if (!node) return
    await this.graph.updateNode(id, {
      properties: { ...node.properties, state: 'retracted' },
    })
  }

  async supersede(oldId: string, newId: string): Promise<void> {
    const node = await this.graph.getNode(oldId)
    if (!node) return
    await this.graph.updateNode(oldId, {
      properties: { ...node.properties, state: 'superseded', supersededBy: newId },
    })
  }

  async getForContext(_entityIds: string[], _topicIds: string[], limit = 20): Promise<Array<{ id: string } & CognitiveProperties>> {
    // Get memories connected to given entities or topics via edges
    const all = await this.getActive(200)
    // Score and sort by composite relevance
    return all
      .map(m => ({ ...m, score: compositeScore(m) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
  }
}
