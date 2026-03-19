/**
 * PackageInstaller — JSON → DB Loader for Ontology Packages
 *
 * Takes a PackageDefinition (parsed from JSON) and inserts all nodes
 * and edges into DuckDB. Computes embeddings for slot descriptions.
 *
 * Idempotent: skips if the package ID already exists in the database.
 */

import { ontologyStore } from '../../graph/stores/ontologyStore'
import { EmbeddingService, EMBEDDING_MODEL_SHORT } from '../../graph/embeddings/EmbeddingService'
import { getGraphService } from '../../graph'
import { createLogger } from '../../program/utils/logger'
import { nid } from '../../program/utils/id'
import type {
  OntologyNode,
  OntologyEdge,
} from '../../graph/types'

const log = createLogger('OntologyInstaller')

// ============================================================================
// PackageDefinition — shape of the JSON files in src/data/ontology-packages/
// ============================================================================

export interface PackageDefinition {
  id: string
  name: string
  version: string
  description: string
  concepts: Array<{
    id: string
    name: string
    description: string
    priority: number
    requires?: string[]
    slots: Array<{
      id: string
      name: string
      description: string
      value_type: 'text' | 'number' | 'boolean' | 'date' | 'list'
      required: boolean
      constraints?: Record<string, unknown>
      examples?: string[]
      depends_on?: string[]
      probes: Array<{
        id: string
        question: string
        style: 'casual' | 'direct' | 'reflective'
      }>
    }>
  }>
}

// ============================================================================
// PackageInstaller
// ============================================================================

export class PackageInstaller {
  /**
   * Install a package from a JSON definition into DuckDB.
   *
   * Idempotent: if the package ID already exists, this is a no-op.
   * On fresh install:
   *   1. Insert package row
   *   2. Insert concept, slot, and probe nodes
   *   3. Insert HAS_SLOT, HAS_PROBE, REQUIRES, DEPENDS_ON edges
   *   4. Compute embeddings for slot descriptions
   */
  async installPackage(definition: PackageDefinition): Promise<void> {
    // Idempotency check
    const existing = await ontologyStore.getPackageById(definition.id)
    if (existing) {
      log.debug(`Package "${definition.name}" already installed, skipping`)
      return
    }

    log.info(`Installing package "${definition.name}" v${definition.version}...`)
    const now = Date.now()

    // 1. Insert package
    await ontologyStore.insertPackage({
      id: definition.id,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      status: 'active',
      installed_at: now,
    })

    const nodes: OntologyNode[] = []
    const edges: OntologyEdge[] = []
    const slotTextsForEmbedding: Array<{ slotId: string; text: string }> = []

    for (const concept of definition.concepts) {
      // 2a. Concept node
      nodes.push({
        id: concept.id,
        package_id: definition.id,
        kind: 'concept',
        properties: {
          name: concept.name,
          description: concept.description,
          priority: concept.priority,
        } as Record<string, unknown>,
        created_at: now,
      })

      // 2b. REQUIRES edges (concept → required concept)
      if (concept.requires) {
        for (const reqId of concept.requires) {
          edges.push({
            id: `edge_${concept.id}_requires_${reqId}`,
            package_id: definition.id,
            start_id: concept.id,
            end_id: reqId,
            type: 'REQUIRES',
            properties: {},
            created_at: now,
          })
        }
      }

      for (const slot of concept.slots) {
        // 2c. Slot node
        const slotProps: Record<string, unknown> = {
          name: slot.name,
          description: slot.description,
          value_type: slot.value_type,
          required: slot.required,
        }
        if (slot.constraints) slotProps.constraints = slot.constraints
        if (slot.examples) slotProps.examples = slot.examples

        nodes.push({
          id: slot.id,
          package_id: definition.id,
          kind: 'slot',
          properties: slotProps,
          created_at: now,
        })

        // HAS_SLOT edge (concept → slot)
        edges.push({
          id: `edge_${concept.id}_has_${slot.id}`,
          package_id: definition.id,
          start_id: concept.id,
          end_id: slot.id,
          type: 'HAS_SLOT',
          properties: {},
          created_at: now,
        })

        // DEPENDS_ON edges (slot → dependency slot)
        if (slot.depends_on) {
          for (const depId of slot.depends_on) {
            edges.push({
              id: `edge_${slot.id}_depends_${depId}`,
              package_id: definition.id,
              start_id: slot.id,
              end_id: depId,
              type: 'DEPENDS_ON',
              properties: {},
              created_at: now,
            })
          }
        }

        // Track for embedding
        slotTextsForEmbedding.push({
          slotId: slot.id,
          text: `${slot.name}: ${slot.description}`,
        })

        // 2d. Probe nodes + HAS_PROBE edges
        for (const probe of slot.probes) {
          nodes.push({
            id: probe.id,
            package_id: definition.id,
            kind: 'probe',
            properties: {
              question: probe.question,
              style: probe.style,
            } as Record<string, unknown>,
            created_at: now,
          })

          edges.push({
            id: `edge_${slot.id}_has_${probe.id}`,
            package_id: definition.id,
            start_id: slot.id,
            end_id: probe.id,
            type: 'HAS_PROBE',
            properties: {},
            created_at: now,
          })
        }
      }
    }

    // 3. Batch insert all nodes, edges
    await ontologyStore.insertNodes(nodes)
    await ontologyStore.insertEdges(edges)

    log.info(
      `Package "${definition.name}" installed: ${nodes.length} nodes, ${edges.length} edges`
    )

    // 4. Compute embeddings for slot descriptions (async, non-blocking on failure)
    try {
      const graph = await getGraphService()
      const embeddingService = new EmbeddingService(graph)
      let embeddedCount = 0

      for (const { slotId, text } of slotTextsForEmbedding) {
        try {
          const vector = await embeddingService.embed(text)
          const vecLiteral = `[${vector.join(', ')}]::FLOAT[]`
          await graph.exec(
            `DELETE FROM embeddings WHERE target_id = $1 AND target_kind = 'ontology_node'`,
            [slotId]
          )
          await graph.exec(
            `INSERT INTO embeddings (id, target_id, target_kind, vector, model, source_text, created_at)
             VALUES ($1, $2, 'ontology_node', ${vecLiteral}, $3, $4, $5)`,
            [nid.embedding(), slotId, EMBEDDING_MODEL_SHORT, text, now]
          )
          embeddedCount++
        } catch (err) {
          log.warn(`Failed to embed slot ${slotId}:`, err)
        }
      }

      log.info(`Embedded ${embeddedCount}/${slotTextsForEmbedding.length} slots`)
    } catch (err) {
      log.warn('Embedding failed (non-fatal, navigator still works without it):', err)
    }
  }

  /**
   * Install all three default packages if the ontology_packages table is empty.
   * Uses dynamic imports so the JSON files are only loaded when needed.
   */
  async installDefaultsIfNeeded(): Promise<void> {
    const packages = await ontologyStore.getInstalledPackages()
    if (packages.length > 0) {
      log.debug(`${packages.length} packages already installed, skipping defaults`)
      return
    }

    log.info('No packages installed, loading defaults...')

    const [aboutMe, workCareer, familyHome] = await Promise.all([
      import('../../data/ontology-packages/about-me.json'),
      import('../../data/ontology-packages/work-career.json'),
      import('../../data/ontology-packages/family-home.json'),
    ])

    await this.installPackage(aboutMe.default as PackageDefinition)
    await this.installPackage(workCareer.default as PackageDefinition)
    await this.installPackage(familyHome.default as PackageDefinition)

    log.info('Default packages installed')
  }
}
