/**
 * GoalStore — DuckDB Graph-Backed Goal Operations
 */

import type { GraphNode, GoalProperties } from '../types'
import type { ReactiveGraphService } from '../reactive/ReactiveGraphService'

let idCounter = 0
function generateId(): string { return `goal_${Date.now()}_${++idCounter}` }

export class GoalStore {
  private graph: ReactiveGraphService

  constructor(graph: ReactiveGraphService) {
    this.graph = graph
  }

  async create(data: {
    statement: string
    type: string
    entityIds?: string[]
    topicIds?: string[]
  }): Promise<{ id: string } & GoalProperties> {
    const id = generateId()
    const props: GoalProperties = {
      statement: data.statement,
      type: data.type,
      status: 'active',
      progress: 0,
      entityIds: data.entityIds ?? [],
      topicIds: data.topicIds ?? [],
    }

    await this.graph.createNode({
      id,
      labels: ['goal'],
      properties: props as unknown as Record<string, unknown>,
    })

    return { id, ...props }
  }

  async getAll(): Promise<Array<{ id: string } & GoalProperties>> {
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'goal')
       ORDER BY updated_at DESC`
    )
    return rows.map(r => ({ id: r.id, ...(r.properties as unknown as GoalProperties) }))
  }

  async getActive(): Promise<Array<{ id: string } & GoalProperties>> {
    const rows = await this.graph.query<GraphNode>(
      `SELECT * FROM nodes WHERE list_contains(labels, 'goal')
       AND json_extract_string(properties, '$.status') = 'active'
       ORDER BY updated_at DESC`
    )
    return rows.map(r => ({ id: r.id, ...(r.properties as unknown as GoalProperties) }))
  }

  async updateStatus(id: string, status: 'active' | 'achieved' | 'abandoned'): Promise<void> {
    const node = await this.graph.getNode(id)
    if (!node) return
    await this.graph.updateNode(id, {
      properties: { ...node.properties, status },
    })
  }

  async updateProgress(id: string, progress: number): Promise<void> {
    const node = await this.graph.getNode(id)
    if (!node) return
    await this.graph.updateNode(id, {
      properties: { ...node.properties, progress },
    })
  }
}
