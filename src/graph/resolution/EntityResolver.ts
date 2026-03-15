/**
 * EntityResolver — 3-Stage Entity Resolution for DuckDB Graph
 *
 * Stage 1 (deterministic): Jaro-Winkler name similarity, Soundex blocking, alias matching
 * Stage 2 (embedding): Cosine similarity on node vectors (deferred to Phase 10)
 * Stage 3 (LLM): Only for ambiguous cases with multiple close-scoring candidates
 *
 * Reuses algorithms from src/program/entityResolution/ (jaroWinkler, entityScorer).
 */

import { jaroWinklerSimilarity } from '../../program/entityResolution/jaroWinkler'
import { soundex } from '../../program/services/phoneticMatcher'
import type { GraphService } from '../GraphService'
import type { GraphNode } from '../types'
import type { EntityProperties } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface ResolutionResult {
  action: 'create' | 'merge'
  existingId?: string
  tempId: string
  name: string
  type: string
  score: number
  decision: 'exact' | 'fuzzy' | 'alias' | 'soundex' | 'new'
}

interface CandidateScore {
  nodeId: string
  name: string
  type: string
  score: number
  decision: string
}

// ============================================================================
// Thresholds (same as existing entityResolver)
// ============================================================================

const EXACT_MATCH = 1.0
const AUTO_MERGE_THRESHOLD = 0.85
const MAYBE_MERGE_THRESHOLD = 0.70

// ============================================================================
// EntityResolver
// ============================================================================

export class EntityResolver {
  private graph: GraphService

  constructor(graph: GraphService) {
    this.graph = graph
  }

  /**
   * Resolve a batch of entities from a KG subset.
   * Returns a resolution result for each entity tempId.
   */
  async resolveAll(
    entities: Array<{ tempId: string; name: string; type: string }>
  ): Promise<ResolutionResult[]> {
    // Fetch all existing entity nodes once
    const existingNodes = await this.graph.findNodesByLabel('entity')
    const results: ResolutionResult[] = []

    for (const entity of entities) {
      const result = await this.resolveOne(entity, existingNodes)
      results.push(result)
    }

    return results
  }

  /**
   * Resolve a single entity against existing nodes.
   */
  private async resolveOne(
    incoming: { tempId: string; name: string; type: string },
    existingNodes: GraphNode[]
  ): Promise<ResolutionResult> {
    if (existingNodes.length === 0) {
      return {
        action: 'create',
        tempId: incoming.tempId,
        name: incoming.name,
        type: incoming.type,
        score: 0,
        decision: 'new',
      }
    }

    const candidates: CandidateScore[] = []
    const incomingNorm = incoming.name.toLowerCase().trim()
    const incomingSoundex = incoming.name.split(/\s+/)
      .filter(w => w.length > 1)
      .map(w => soundex(w))
      .filter(Boolean)

    for (const node of existingNodes) {
      const props = node.properties as unknown as EntityProperties
      if (!props.name) continue

      const candidateNorm = props.name.toLowerCase().trim()

      // Stage 1a: Exact match
      if (incomingNorm === candidateNorm) {
        candidates.push({
          nodeId: node.id,
          name: props.name,
          type: props.type,
          score: EXACT_MATCH,
          decision: 'exact',
        })
        continue
      }

      // Stage 1b: Alias match
      const aliases = props.aliases ?? []
      const aliasMatch = aliases.some(a => a.toLowerCase().trim() === incomingNorm)
      if (aliasMatch) {
        candidates.push({
          nodeId: node.id,
          name: props.name,
          type: props.type,
          score: 0.95,
          decision: 'alias',
        })
        continue
      }

      // Stage 1c: Jaro-Winkler similarity
      let bestSim = jaroWinklerSimilarity(incomingNorm, candidateNorm)

      // Also check against aliases
      for (const alias of aliases) {
        const sim = jaroWinklerSimilarity(incomingNorm, alias.toLowerCase())
        if (sim > bestSim) bestSim = sim
      }

      // Check concatenated words (e.g. "Charan Tandi" vs "Charanthandi")
      const incomingWords = incomingNorm.split(/\s+/)
      const candidateWords = candidateNorm.split(/\s+/)
      if (incomingWords.length > 1 || candidateWords.length > 1) {
        const concatSim = jaroWinklerSimilarity(
          incomingWords.join(''),
          candidateWords.join('')
        )
        if (concatSim > bestSim) bestSim = concatSim
      }

      // Stage 1d: Soundex blocking (boost if phonetically similar)
      if (incomingSoundex.length > 0) {
        const candidateSoundex = props.name.split(/\s+/)
          .filter(w => w.length > 1)
          .map(w => soundex(w))
          .filter(Boolean)

        const soundexOverlap = incomingSoundex.filter(s =>
          candidateSoundex.includes(s)
        ).length

        if (soundexOverlap > 0) {
          // Boost Jaro-Winkler by 0.05 per overlapping soundex code
          bestSim = Math.min(1.0, bestSim + soundexOverlap * 0.05)
        }
      }

      // Type agreement check — different types veto
      if (incoming.type !== 'unknown' && props.type !== 'unknown' && incoming.type !== props.type) {
        bestSim = Math.min(bestSim, MAYBE_MERGE_THRESHOLD - 0.01)
      }

      if (bestSim >= MAYBE_MERGE_THRESHOLD) {
        candidates.push({
          nodeId: node.id,
          name: props.name,
          type: props.type,
          score: bestSim,
          decision: bestSim >= AUTO_MERGE_THRESHOLD ? 'fuzzy' : 'soundex',
        })
      }
    }

    // No candidates found — create new
    if (candidates.length === 0) {
      return {
        action: 'create',
        tempId: incoming.tempId,
        name: incoming.name,
        type: incoming.type,
        score: 0,
        decision: 'new',
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)
    const best = candidates[0]

    // Stage 3: LLM disambiguation (deferred — for now, use best deterministic match)
    // TODO: When multiple candidates have similar scores (within 0.05), use LLM to disambiguate

    return {
      action: 'merge',
      existingId: best.nodeId,
      tempId: incoming.tempId,
      name: best.name,
      type: best.type,
      score: best.score,
      decision: best.decision as ResolutionResult['decision'],
    }
  }
}
