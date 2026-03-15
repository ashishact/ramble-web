/**
 * EmbeddingService — In-Browser Text Embeddings
 *
 * Loads a lightweight ONNX model in the browser using @huggingface/transformers
 * (already installed via kokoro-js).
 *
 * Provides embed() for text → float[] and embedNode() for
 * generating embeddings from node content + relationships.
 *
 * The ONNX model is loaded lazily on first use. The initial load
 * takes ~2-3 seconds but is cached in OPFS for subsequent loads.
 */

import type { GraphService } from '../GraphService'

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

  constructor(graph: GraphService, modelName = 'Xenova/bge-small-en-v1.5') {
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
   * Stores the embedding in the node's `embedding` column.
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

    // Include name/content/description
    if (typeof props.name === 'string') parts.push(props.name)
    if (typeof props.content === 'string') parts.push(props.content)
    if (typeof props.description === 'string') parts.push(props.description)
    if (typeof props.statement === 'string') parts.push(props.statement)

    // Include labels for richer embedding
    parts.push(...node[0].labels)

    // Get connected edge types
    const edges = await this.graph.query<{ type: string }>(
      `SELECT DISTINCT type FROM edges WHERE start_id = $1 OR end_id = $1`,
      [nodeId]
    )
    parts.push(...edges.map(e => e.type))

    const text = parts.filter(Boolean).join(' ')
    if (!text.trim()) return

    const vector = await this.embed(text)

    // DuckDB can't bind arrays via prepared statements — inline the literal
    const literal = `[${vector.join(', ')}]::FLOAT[]`
    await this.graph.exec(
      `UPDATE nodes SET embedding = ${literal} WHERE id = $1`,
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
