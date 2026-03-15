/**
 * VectorSearch — DuckDB Cosine Similarity Search
 *
 * Uses DuckDB's built-in array_cosine_similarity() function
 * for vector similarity search on node embeddings.
 *
 * DuckDB supports FLOAT[] columns natively, so no external
 * vector database is needed.
 */

import type { GraphService } from '../GraphService'
import type { EmbeddingService } from './EmbeddingService'
import type { GraphNode } from '../types'

export interface VectorSearchResult {
  node: GraphNode
  similarity: number
}

export class VectorSearch {
  private graph: GraphService
  private embeddings: EmbeddingService

  constructor(graph: GraphService, embeddings: EmbeddingService) {
    this.graph = graph
    this.embeddings = embeddings
  }

  /**
   * Find nodes most similar to a query vector.
   * Uses DuckDB's array_cosine_similarity() for efficient in-DB computation.
   */
  async findSimilar(
    queryVector: number[],
    limit = 10,
    labelFilter?: string
  ): Promise<VectorSearchResult[]> {
    // DuckDB WASM can't bind arrays via prepared statements — inline the literal
    const dim = queryVector.length
    const vecLiteral = `[${queryVector.join(',')}]::FLOAT[${dim}]`

    let sql = `
      SELECT *,
        array_cosine_similarity(embedding::FLOAT[${dim}], ${vecLiteral}) AS similarity
      FROM nodes
      WHERE embedding IS NOT NULL
    `
    const params: unknown[] = []
    let paramIdx = 1

    if (labelFilter) {
      sql += ` AND list_contains(labels, $${paramIdx})`
      params.push(labelFilter)
      paramIdx++
    }

    sql += ` ORDER BY similarity DESC LIMIT $${paramIdx}`
    params.push(limit)

    const rows = await this.graph.query<GraphNode & { similarity: number }>(sql, params)

    return rows.map(row => ({
      node: {
        id: row.id,
        branch_id: row.branch_id,
        labels: row.labels,
        properties: row.properties,
        embedding: row.embedding,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      similarity: row.similarity,
    }))
  }

  /**
   * Search by text query — embeds the query string, then finds similar nodes.
   */
  async searchByText(
    query: string,
    limit = 10,
    labelFilter?: string
  ): Promise<VectorSearchResult[]> {
    const queryVector = await this.embeddings.embed(query)
    return this.findSimilar(queryVector, limit, labelFilter)
  }

  /**
   * Find nodes similar to a given node.
   */
  async findSimilarTo(
    nodeId: string,
    limit = 10,
    labelFilter?: string
  ): Promise<VectorSearchResult[]> {
    const node = await this.graph.query<{ embedding: number[] }>(
      `SELECT embedding FROM nodes WHERE id = $1`,
      [nodeId]
    )

    if (node.length === 0 || !node[0].embedding) return []

    return this.findSimilar(node[0].embedding, limit + 1, labelFilter)
      .then(results => results.filter(r => r.node.id !== nodeId).slice(0, limit))
  }
}
