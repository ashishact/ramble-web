/**
 * TopicStore — DuckDB Graph-Backed Topic Operations
 */

import type { GraphNode, TopicProperties } from '../types'
import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'

let idCounter = 0
function generateId(): string { return `topic_${Date.now()}_${++idCounter}` }

export class TopicStore {
  private graph: ReactiveGraphService

  constructor(graph: ReactiveGraphService) {
    this.graph = graph
  }

  async create(data: { name: string; category?: string }): Promise<{ id: string } & TopicProperties> {
    const id = generateId()
    const now = Date.now()
    const props: TopicProperties = {
      name: data.name,
      category: data.category,
      mentionCount: 1,
      firstMentioned: now,
      lastMentioned: now,
    }

    await this.graph.createNode({
      id,
      labels: ['topic'],
      properties: props as unknown as Record<string, unknown>,
    })

    return { id, ...props }
  }

  async getByName(name: string): Promise<({ id: string } & TopicProperties) | null> {
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'topic')
       AND json_extract_string(properties, '$.name') = $1 LIMIT 1`,
      [name]
    )
    if (rows.length === 0) return null
    return { id: rows[0].id, ...(rows[0].properties as unknown as TopicProperties) }
  }

  async findOrCreate(data: { name: string; category?: string }): Promise<{ id: string } & TopicProperties> {
    const existing = await this.getByName(data.name)
    if (existing) {
      const node = await this.graph.getNode(existing.id)
      if (node) {
        await this.graph.updateNode(existing.id, {
          properties: { ...node.properties, mentionCount: (existing.mentionCount ?? 0) + 1, lastMentioned: Date.now() },
        })
      }
      return existing
    }
    return this.create(data)
  }

  async getAll(): Promise<Array<{ id: string } & TopicProperties>> {
    const rows = await this.graph.findNodesByLabel('topic')
    return rows.map(r => ({ id: r.id, ...(r.properties as unknown as TopicProperties) }))
  }
}
