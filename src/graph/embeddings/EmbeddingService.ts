/**
 * EmbeddingService — In-Browser Text Embeddings
 *
 * Loads a lightweight ONNX model (BGE-small-en-v1.5) in the browser
 * using @huggingface/transformers (already installed via kokoro-js).
 *
 * Provides:
 *   embed(text) → float[]    — raw text → vector
 *   embedNode(nodeId)        — generates embedding from node content + relationships,
 *                               stores in the dedicated 'embeddings' table
 *
 * WHY BGE-SMALL:
 *   - 384-dim vectors (small footprint in DuckDB FLOAT[] columns)
 *   - ONNX quantized (q8) — ~33MB download, cached in OPFS after first load
 *   - Good English semantic similarity for the cost
 *   - Loaded lazily on first use — initial load ~2-3 seconds
 *
 * EMBEDDING STORAGE:
 *   Previously, embeddings were stored in the nodes.embedding column.
 *   Now they go to the dedicated 'embeddings' table (schema v2), which
 *   supports multiple entity types (nodes, edges, ontology nodes) and
 *   tracks the model + source text for re-embedding.
 */

import type { GraphService } from '../GraphService'

// ============================================================================
// Constants
// ============================================================================

/**
 * The BGE-small-en model from BAAI, served via Xenova's ONNX conversion.
 * This is the production model — do not change without re-embedding all vectors.
 */
export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5'

/** Short model name for storage (without the Xenova/ prefix) */
export const EMBEDDING_MODEL_SHORT = 'bge-small-en-v1.5'

// ============================================================================
// Types
// ============================================================================

/** A pipeline function from @huggingface/transformers */
type FeatureExtractionPipeline = (
  texts: string | string[],
  options?: Record<string, unknown>
) => Promise<{ tolist: () => number[][] }>

// ============================================================================
// EmbeddingService
// ============================================================================

export class EmbeddingService {
  private graph: GraphService
  private pipe: FeatureExtractionPipeline | null = null
  private loading: Promise<FeatureExtractionPipeline> | null = null
  private modelName: string

  constructor(graph: GraphService, modelName = EMBEDDING_MODEL) {
    this.graph = graph
    this.modelName = modelName
  }

  /**
   * Lazily load the ONNX model. Cached in OPFS after first download.
   */
  private async loadPipeline(): Promise<FeatureExtractionPipeline> {
    if (this.pipe) return this.pipe
    if (this.loading) return this.loading

    this.loading = (async () => {
      try {
        const { pipeline } = await import('@huggingface/transformers')
        const p = await pipeline('feature-extraction', this.modelName, {
          dtype: 'q8',
        })
        this.pipe = p as unknown as FeatureExtractionPipeline
        console.log(`[EmbeddingService] Model loaded: ${this.modelName}`)
        return this.pipe
      } catch (err) {
        this.loading = null
        console.warn('[EmbeddingService] Failed to load ONNX model:', err)
        throw err
      }
    })()

    return this.loading
  }

  /**
   * Embed a text string into a float vector.
   */
  async embed(text: string): Promise<number[]> {
    const p = await this.loadPipeline()
    const output = await p(text, { pooling: 'mean', normalize: true })
    return output.tolist()[0]
  }

  /**
   * Embed a node's content + relationship labels.
   *
   * Writes to the 'embeddings' table (not the legacy nodes.embedding column).
   * Uses UPSERT pattern: if an embedding for this node already exists,
   * it gets replaced with the new vector + source text.
   *
   * The source text is stored so we can re-embed later if the model changes.
   * It's composed of: node name/content/description + labels + connected edge types.
   */
  async embedNode(nodeId: string): Promise<void> {
    const node = await this.graph.query<{
      id: string
      labels: string[]
      properties: string | Record<string, unknown>
    }>(
      `SELECT id, labels, properties FROM nodes WHERE id = $1`,
      [nodeId]
    )

    if (node.length === 0) return

    const raw = node[0].properties
    const props = typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})
    const parts: string[] = []

    // Include name/content/description — the primary semantic content
    if (typeof props.name === 'string') parts.push(props.name)
    if (typeof props.content === 'string') parts.push(props.content)
    if (typeof props.description === 'string') parts.push(props.description)
    if (typeof props.statement === 'string') parts.push(props.statement)

    // Include labels for richer embedding (e.g., "entity", "memory", "goal")
    parts.push(...node[0].labels)

    // Get connected edge types for relationship context
    const edges = await this.graph.query<{ type: string }>(
      `SELECT DISTINCT type FROM edges WHERE start_id = $1 OR end_id = $1`,
      [nodeId]
    )
    parts.push(...edges.map(e => e.type))

    const sourceText = parts.filter(Boolean).join(' ')
    if (!sourceText.trim()) return

    const vector = await this.embed(sourceText)
    const now = Date.now()

    // UPSERT: delete existing embedding for this node, then insert new one.
    // DuckDB WASM doesn't support ON CONFLICT for all cases, so we use
    // DELETE + INSERT which is safe within a single-threaded worker.
    await this.graph.exec(
      `DELETE FROM embeddings WHERE target_id = $1 AND target_kind = 'node'`,
      [nodeId]
    )

    // DuckDB can't bind arrays via prepared statements — inline the literal
    const vecLiteral = `[${vector.join(', ')}]::FLOAT[]`
    await this.graph.exec(
      `INSERT INTO embeddings (id, target_id, target_kind, vector, model, source_text, created_at)
       VALUES ($1, $2, 'node', ${vecLiteral}, $3, $4, $5)`,
      [crypto.randomUUID(), nodeId, EMBEDDING_MODEL_SHORT, sourceText, now]
    )

    // Also write to legacy nodes.embedding column for backward compatibility.
    // Existing code (VectorSearch, WorkingMemory) may still read from it
    // during the migration period. This dual-write is temporary.
    await this.graph.exec(
      `UPDATE nodes SET embedding = ${vecLiteral} WHERE id = $1`,
      [nodeId]
    )
  }

  /**
   * Batch embed multiple nodes. Returns count of nodes actually embedded.
   */
  async embedNodes(nodeIds: string[]): Promise<number> {
    let count = 0
    for (const id of nodeIds) {
      try {
        await this.embedNode(id)
        count++
      } catch (err) {
        console.warn(`[EmbeddingService] Failed to embed node ${id}:`, err)
      }
    }
    return count
  }

  /**
   * Check if the embedding model is available (loads it if needed).
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.loadPipeline()
      return true
    } catch {
      return false
    }
  }
}
