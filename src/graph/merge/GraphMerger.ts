/**
 * GraphMerger — KG Subset → DuckDB Graph
 *
 * The full merge pipeline:
 * 1. Resolve entities (EntityResolver)
 * 2. Create/merge entity nodes
 * 3. Create memory nodes with cognitive properties
 * 4. Create edges (MENTIONS, ABOUT, CONTRADICTS, SUPERSEDES)
 * 5. Handle contradictions (bidirectional edges, both preserved)
 * 6. Handle supersession (directed edge, old state='superseded')
 * 7. Apply temporal validity
 * 8. Reinforcement on re-mention
 */

import { ReactiveGraphService } from '../reactive/ReactiveGraphService'
import { EntityResolver } from '../resolution/EntityResolver'
import {
  confidencePrior,
  ownershipPrior,
  applyReinforcement,
} from './cognitiveHelpers'
import type { KGSubset, MemoryOrigin, CognitiveProperties, EntityProperties } from '../types'
// graphEventBus available via ReactiveGraphService mutations

// ============================================================================
// ID Generation
// ============================================================================

let idCounter = 0

function generateId(prefix: string): string {
  idCounter++
  return `${prefix}_${Date.now()}_${idCounter}`
}

// ============================================================================
// Source → Origin Mapping
// ============================================================================

function sourceToOrigin(source: string): MemoryOrigin {
  switch (source) {
    case 'speech': return 'speech'
    case 'meeting': return 'meeting'
    case 'pasted': return 'pasted'
    case 'document': return 'document'
    case 'typed':
    case 'text':
    default:
      return 'typed'
  }
}

// ============================================================================
// GraphMerger
// ============================================================================

export class GraphMerger {
  private reactive: ReactiveGraphService
  private resolver: EntityResolver

  constructor(reactive: ReactiveGraphService) {
    this.reactive = reactive
    // EntityResolver needs raw GraphService for read queries
    this.resolver = new EntityResolver(reactive as unknown as import('../GraphService').GraphService)
  }

  /**
   * Merge a KG subset into the graph.
   *
   * @param subset - Extracted KG subset from SinglePassProcessor
   * @param branchId - Target branch (default: 'global')
   * @param source - How the input arrived (speech, typed, etc.)
   * @param recordingId - For provenance tracking
   */
  async merge(
    subset: KGSubset,
    branchId = 'global',
    source = 'typed',
    recordingId?: string
  ): Promise<MergeResult> {
    const origin = sourceToOrigin(source)
    const result: MergeResult = {
      entities: [],
      memories: [],
      edges: [],
      topics: subset.topics,
    }

    // Temp ID → real ID mapping (for resolving edges after nodes are created)
    const idMap = new Map<string, string>()

    // ────────────────────────────────────────────────────────────────────
    // Step 1: Resolve entities
    // ────────────────────────────────────────────────────────────────────
    const entityNodes = subset.nodes.filter(n => n.labels.includes('entity'))
    const memoryNodes = subset.nodes.filter(n => n.labels.includes('memory'))

    const entityInputs = entityNodes.map(n => ({
      tempId: n.tempId,
      name: (n.properties.name as string) ?? n.tempId,
      type: (n.properties.type as string) ?? 'other',
    }))

    const resolutions = await this.resolver.resolveAll(entityInputs)

    // ────────────────────────────────────────────────────────────────────
    // Step 2: Create/merge entity nodes
    // ────────────────────────────────────────────────────────────────────
    await this.reactive.batchMutations(async () => {
      for (const resolution of resolutions) {
        if (resolution.action === 'merge' && resolution.existingId) {
          // Merge into existing entity — reinforce
          idMap.set(resolution.tempId, resolution.existingId)

          const existingNode = await this.reactive.getNode(resolution.existingId)
          if (existingNode) {
            const props = existingNode.properties as unknown as EntityProperties
            const reinforced = applyReinforcement({
              importance: 0.5,
              activityScore: 0.5,
              reinforceCount: props.mentionCount ?? 0,
              state: 'stable',
            })

            await this.reactive.updateNode(resolution.existingId, {
              properties: {
                ...existingNode.properties,
                mentionCount: (props.mentionCount ?? 0) + 1,
                lastMentioned: Date.now(),
                activityScore: reinforced.activityScore,
              },
            })
          }

          result.entities.push({
            id: resolution.existingId,
            name: resolution.name,
            type: resolution.type,
            isNew: false,
          })
        } else {
          // Create new entity node
          const realId = generateId('ent')
          idMap.set(resolution.tempId, realId)

          const originalNode = entityNodes.find(n => n.tempId === resolution.tempId)
          const entityProps: EntityProperties = {
            name: resolution.name,
            type: resolution.type,
            description: (originalNode?.properties.description as string) ?? undefined,
            aliases: [],
            mentionCount: 1,
            firstMentioned: Date.now(),
            lastMentioned: Date.now(),
          }

          await this.reactive.createNode({
            id: realId,
            branchId,
            labels: ['entity', resolution.type],
            properties: entityProps as unknown as Record<string, unknown>,
          })

          result.entities.push({
            id: realId,
            name: resolution.name,
            type: resolution.type,
            isNew: true,
          })
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // Step 3: Create memory nodes with cognitive properties
      // ──────────────────────────────────────────────────────────────────
      for (const memNode of memoryNodes) {
        const realId = generateId('mem')
        idMap.set(memNode.tempId, realId)

        const cogProps: CognitiveProperties = {
          content: (memNode.properties.content as string) ?? '',
          type: (memNode.properties.type as string) ?? 'fact',
          subject: (memNode.properties.subject as string) ?? undefined,
          importance: (memNode.properties.importance as number) ?? 0.5,
          confidence: confidencePrior(origin),
          activityScore: 1.0,
          ownership: ownershipPrior(origin),
          state: 'provisional',
          validFrom: memNode.properties.validFrom as number | undefined,
          validUntil: memNode.properties.validUntil as number | undefined,
          origin,
          extractionVersion: 'v2-kg',
          sourceConversationIds: recordingId ? [recordingId] : [],
          reinforceCount: 0,
          lastReinforced: Date.now(),
        }

        await this.reactive.createNode({
          id: realId,
          branchId,
          labels: ['memory', cogProps.type],
          properties: cogProps as unknown as Record<string, unknown>,
        })

        result.memories.push({
          id: realId,
          content: cogProps.content,
          type: cogProps.type,
        })
      }

      // ──────────────────────────────────────────────────────────────────
      // Step 4: Create edges
      // ──────────────────────────────────────────────────────────────────
      for (const edge of subset.edges) {
        const startId = idMap.get(edge.startTempId) ?? edge.startTempId
        const endId = idMap.get(edge.endTempId) ?? edge.endTempId

        const edgeId = generateId('edge')
        await this.reactive.createEdge({
          id: edgeId,
          branchId,
          startId,
          endId,
          type: edge.type,
          properties: edge.properties,
        })

        result.edges.push({
          id: edgeId,
          type: edge.type,
          startId,
          endId,
        })

        // Step 5: Handle contradictions (make bidirectional)
        if (edge.type === 'CONTRADICTS') {
          const reverseId = generateId('edge')
          await this.reactive.createEdge({
            id: reverseId,
            branchId,
            startId: endId,
            endId: startId,
            type: 'CONTRADICTS',
            properties: edge.properties,
          })

          // Mark both memories as 'contested'
          await this.setMemoryState(startId, 'contested')
          await this.setMemoryState(endId, 'contested')
        }

        // Step 6: Handle supersession
        if (edge.type === 'SUPERSEDES') {
          await this.setMemoryState(endId, 'superseded')

          // Set supersededBy reference on the old memory
          const oldNode = await this.reactive.getNode(endId)
          if (oldNode) {
            const props = oldNode.properties as Record<string, unknown>
            await this.reactive.updateNode(endId, {
              properties: {
                ...props,
                supersededBy: startId,
              },
            })
          }
        }
      }
    })

    return result
  }

  /**
   * Set the state of a memory node (if it exists and is a memory).
   */
  private async setMemoryState(nodeId: string, state: string): Promise<void> {
    const node = await this.reactive.getNode(nodeId)
    if (node && node.labels.includes('memory')) {
      const props = node.properties as Record<string, unknown>
      await this.reactive.updateNode(nodeId, {
        properties: { ...props, state },
      })
    }
  }
}

// ============================================================================
// Types
// ============================================================================

export interface MergeResult {
  entities: Array<{
    id: string
    name: string
    type: string
    isNew: boolean
  }>
  memories: Array<{
    id: string
    content: string
    type: string
  }>
  edges: Array<{
    id: string
    type: string
    startId: string
    endId: string
  }>
  topics: string[]
}
