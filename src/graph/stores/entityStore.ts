/**
 * EntityStore — DuckDB Graph-Backed Entity Operations
 *
 * Entities are stored as nodes with label 'entity' in the graph.
 * This store provides a familiar CRUD API on top of graph queries.
 */

import type { GraphNode, EntityProperties } from '../types'
import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import { nid } from '../../program/utils/id'

export class EntityStore {
  private graph: ReactiveGraphService

  constructor(graph: ReactiveGraphService) {
    this.graph = graph
  }

  async create(data: {
    name: string
    type: string
    aliases?: string[]
    description?: string
  }): Promise<{ id: string } & EntityProperties> {
    const id = nid.entity()
    const now = Date.now()
    const props: EntityProperties = {
      name: data.name,
      type: data.type,
      description: data.description,
      aliases: data.aliases ?? [],
      mentionCount: 1,
      firstMentioned: now,
      lastMentioned: now,
    }

    await this.graph.createNode({
      id,
      labels: ['entity', data.type],
      properties: props as unknown as Record<string, unknown>,
    })

    return { id, ...props }
  }

  async getById(id: string): Promise<({ id: string } & EntityProperties) | null> {
    const node = await this.graph.getNode(id)
    if (!node || !node.labels.includes('entity')) return null
    return { id: node.id, ...(node.properties as unknown as EntityProperties) }
  }

  async getByName(name: string): Promise<({ id: string } & EntityProperties) | null> {
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'entity')
       AND json_extract_string(properties, '$.name') = $1 LIMIT 1`,
      [name]
    )
    if (rows.length === 0) return null
    return { id: rows[0].id, ...(rows[0].properties as unknown as EntityProperties) }
  }

  async getAll(): Promise<Array<{ id: string } & EntityProperties>> {
    const rows = await this.graph.findNodesByLabel('entity')
    return rows.map(r => ({ id: r.id, ...(r.properties as unknown as EntityProperties) }))
  }

  async recordMention(id: string): Promise<void> {
    const node = await this.graph.getNode(id)
    if (!node) return
    const props = node.properties as unknown as EntityProperties
    await this.graph.updateNode(id, {
      properties: {
        ...node.properties,
        mentionCount: (props.mentionCount ?? 0) + 1,
        lastMentioned: Date.now(),
      },
    })
  }

  async findOrCreate(data: { name: string; type: string }): Promise<{ id: string } & EntityProperties> {
    const existing = await this.getByName(data.name)
    if (existing) {
      await this.recordMention(existing.id)
      return existing
    }
    return this.create(data)
  }
}
