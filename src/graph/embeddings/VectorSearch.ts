/**
 * VectorSearch — DuckDB Cosine Similarity Search
 *
 * Performs semantic similarity search using DuckDB's built-in
 * array_cosine_similarity() function on the embeddings table.
 *
 * WHY IN-DB VECTOR SEARCH:
 *   DuckDB supports FLOAT[] columns and cosine similarity natively.
 *   For our scale (~1000s of nodes, 384-dim vectors), a full scan
 *   with cosine similarity is fast enough (~5-20ms). No need for
 *   approximate nearest neighbor (ANN) indices or external vector DBs.
 *
 * QUERY PATTERN:
 *   The embeddings table is joined with the source table (nodes,
 *   ontology_nodes, etc.) via target_id. This decoupled design means
 *   vector search works across any entity type that has embeddings.
 *
 * DUAL-READ:
 *   During the migration period, findSimilar() reads from BOTH the
 *   new embeddings table AND the legacy nodes.embedding column (UNION).
 *   This ensures no results are lost during the transition. Once all
 *   existing embeddings are migrated, the legacy read can be removed.
 */

import type { GraphService } from '../GraphService'
import type { EmbeddingService } from './EmbeddingService'
import type { GraphNode } from '../types'
import { rerankSearchResults, type RerankOptions } from './rerank'

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
   *
   * Searches the embeddings table for node-type embeddings, then JOINs
   * with the nodes table to return full node data with similarity scores.
   *
   * Also checks legacy nodes.embedding column (UNION) to catch nodes
   * that haven't been migrated to the embeddings table yet.
   */
  async findSimilar(
    queryVector: number[],
    limit = 10,
    labelFilter?: string
  ): Promise<VectorSearchResult[]> {
    const dim = queryVector.length
    // DuckDB WASM can't bind arrays via prepared statements — inline the literal
    const vecLiteral = `[${queryVector.join(',')}]::FLOAT[${dim}]`

    const params: unknown[] = []
    let paramIdx = 1

    // Build WHERE clause for label filter (used in both branches of UNION)
    let labelWhere = ''
    if (labelFilter) {
      labelWhere = ` AND list_contains(n.labels, $${paramIdx})`
      params.push(labelFilter)
      paramIdx++
    }

    // UNION query: embeddings table + legacy nodes.embedding column.
    // The embeddings table is the primary source (target_kind = 'node').
    // The legacy column is a fallback for nodes not yet migrated.
    // Deduplication happens via the outer query's GROUP BY on node id
    // (takes highest similarity if a node appears in both sources).
    const sql = `
      WITH combined AS (
        -- Primary: embeddings table (v2)
        SELECT n.*, array_cosine_similarity(e.vector::FLOAT[${dim}], ${vecLiteral}) AS similarity
        FROM embeddings e
        JOIN nodes n ON n.id = e.target_id
        WHERE e.target_kind = 'node'${labelWhere}

        UNION ALL

        -- Fallback: legacy nodes.embedding column (v1, for un-migrated nodes)
        SELECT n.*, array_cosine_similarity(n.embedding::FLOAT[${dim}], ${vecLiteral}) AS similarity
        FROM nodes n
        WHERE n.embedding IS NOT NULL
          AND n.id NOT IN (SELECT target_id FROM embeddings WHERE target_kind = 'node')
          ${labelWhere}
      )
      SELECT * FROM combined
      ORDER BY similarity DESC
      LIMIT $${paramIdx}
    `
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
   * Search by text query — embeds the query, finds similar nodes, then
   * re-ranks with BM25 to filter out semantic false positives.
   *
   * Over-fetches from the vector index (2x limit) to give the re-ranker
   * enough candidates, then returns the top `limit` after fusion scoring.
   *
   * Pass rerank: false to skip re-ranking (raw semantic order).
   */
  async searchByText(
    query: string,
    limit = 10,
    labelFilter?: string,
    options?: { rerank?: boolean, rerankOptions?: RerankOptions },
  ): Promise<VectorSearchResult[]> {
    const queryVector = await this.embeddings.embed(query)

    if (options?.rerank === false) {
      return this.findSimilar(queryVector, limit, labelFilter)
    }

    // Over-fetch to give re-ranker enough candidates
    const candidates = await this.findSimilar(queryVector, limit * 2, labelFilter)
    const ranked = rerankSearchResults(query, candidates, options?.rerankOptions)
    return ranked.slice(0, limit)
  }

  /**
   * Find nodes similar to a given node.
   * Uses the embeddings table first, falls back to legacy nodes.embedding.
   */
  async findSimilarTo(
    nodeId: string,
    limit = 10,
    labelFilter?: string
  ): Promise<VectorSearchResult[]> {
    // Try embeddings table first (v2)
    const embRow = await this.graph.query<{ vector: number[] }>(
      `SELECT vector FROM embeddings WHERE target_id = $1 AND target_kind = 'node' LIMIT 1`,
      [nodeId]
    )

    let vector: number[] | null = embRow.length > 0 ? embRow[0].vector : null

    // Fallback to legacy nodes.embedding column
    if (!vector) {
      const nodeRow = await this.graph.query<{ embedding: number[] }>(
        `SELECT embedding FROM nodes WHERE id = $1`,
        [nodeId]
      )
      vector = nodeRow.length > 0 ? nodeRow[0].embedding : null
    }

    if (!vector) return []

    return this.findSimilar(vector, limit + 1, labelFilter)
      .then(results => results.filter(r => r.node.id !== nodeId).slice(0, limit))
  }
}
