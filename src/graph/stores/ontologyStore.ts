/**
 * OntologyStore — DuckDB-backed ontology template storage
 *
 * CRUD for ontology_packages, ontology_nodes, ontology_edges, ontology_coverage.
 * Follows conversationStore pattern: object literal, lazy getGraphService(),
 * graphEventBus.emitTableChange on writes.
 *
 * Used by:
 *   - PackageInstaller (bulk inserts on install)
 *   - OntologyNavigator (read unfilled slots, probes, dependencies)
 */

import { getGraphService } from '../index'
import { graphEventBus } from '../events'
import type {
  OntologyPackage,
  OntologyNode,
  OntologyEdge,
  OntologyNodeKind,
  ConceptProperties,
  ProbeProperties,
} from '../types'

/** Flat row returned by getFullPackageTree() — grouped into a tree by the hook */
export interface PackageTreeRow {
  package_id: string
  package_name: string
  package_status: string
  concept_id: string
  concept_props: string  // JSON string — parsed by hook
  slot_id: string
  slot_props: string     // JSON string — parsed by hook
}

async function getGraph() {
  return getGraphService()
}

function emitChange() {
  graphEventBus.emitTableChange(['ontology_packages', 'ontology_nodes', 'ontology_edges'])
}

export const ontologyStore = {
  // ── Full tree query (for Ontology Browser) ─────────────────────────

  /**
   * Returns a flat list of package→concept→slot rows.
   * The UI hook groups these into a tree structure.
   */
  async getFullPackageTree(): Promise<PackageTreeRow[]> {
    const graph = await getGraph()
    return graph.query<PackageTreeRow>(
      `SELECT
        p.id AS package_id, p.name AS package_name, p.status AS package_status,
        concept.id AS concept_id, concept.properties AS concept_props,
        slot.id AS slot_id, slot.properties AS slot_props
      FROM ontology_packages p
      JOIN ontology_nodes concept ON concept.package_id = p.id AND concept.kind = 'concept'
      JOIN ontology_edges e_slot ON e_slot.start_id = concept.id AND e_slot.type = 'HAS_SLOT'
      JOIN ontology_nodes slot ON slot.id = e_slot.end_id AND slot.kind = 'slot'
      ORDER BY p.installed_at,
        CAST(json_extract_string(concept.properties, '$.priority') AS DOUBLE) DESC,
        slot.id`
    )
  },

  // ── Packages ────────────────────────────────────────────────────────

  async getInstalledPackages(): Promise<OntologyPackage[]> {
    const graph = await getGraph()
    return graph.query<OntologyPackage>(
      `SELECT * FROM ontology_packages ORDER BY installed_at`
    )
  },

  async getPackageById(id: string): Promise<OntologyPackage | null> {
    const graph = await getGraph()
    const rows = await graph.query<OntologyPackage>(
      `SELECT * FROM ontology_packages WHERE id = $1`,
      [id]
    )
    return rows[0] ?? null
  },

  async insertPackage(pkg: OntologyPackage): Promise<void> {
    const graph = await getGraph()
    await graph.exec(
      `INSERT INTO ontology_packages (id, name, version, description, status, installed_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [pkg.id, pkg.name, pkg.version, pkg.description, pkg.status, pkg.installed_at]
    )
    emitChange()
  },

  // ── Nodes ───────────────────────────────────────────────────────────

  async getNodesByPackage(packageId: string, kind?: OntologyNodeKind): Promise<OntologyNode[]> {
    const graph = await getGraph()
    if (kind) {
      return graph.query<OntologyNode>(
        `SELECT * FROM ontology_nodes WHERE package_id = $1 AND kind = $2`,
        [packageId, kind]
      )
    }
    return graph.query<OntologyNode>(
      `SELECT * FROM ontology_nodes WHERE package_id = $1`,
      [packageId]
    )
  },

  /**
   * Get concepts for a package sorted by priority DESC (highest first).
   * Only returns concepts whose package is active.
   */
  async getActiveConceptsByPriority(packageId: string): Promise<Array<OntologyNode & { properties: ConceptProperties }>> {
    const graph = await getGraph()
    const rows = await graph.query<OntologyNode>(
      `SELECT n.* FROM ontology_nodes n
       JOIN ontology_packages p ON n.package_id = p.id
       WHERE n.package_id = $1
         AND n.kind = 'concept'
         AND p.status = 'active'
       ORDER BY CAST(json_extract_string(n.properties, '$.priority') AS DOUBLE) DESC`,
      [packageId]
    )
    return rows as Array<OntologyNode & { properties: ConceptProperties }>
  },

  /**
   * Get unfilled slots for a package.
   * LEFT JOINs coverage to find slots where filled IS NULL or false.
   */
  async getUnfilledSlots(packageId: string): Promise<OntologyNode[]> {
    const graph = await getGraph()
    return graph.query<OntologyNode>(
      `SELECT n.* FROM ontology_nodes n
       LEFT JOIN ontology_coverage c ON c.slot_id = n.id
       WHERE n.package_id = $1
         AND n.kind = 'slot'
         AND (c.filled IS NULL OR c.filled = false)`,
      [packageId]
    )
  },

  /**
   * Get slots belonging to a concept (via HAS_SLOT edges).
   */
  async getSlotsForConcept(conceptId: string): Promise<OntologyNode[]> {
    const graph = await getGraph()
    return graph.query<OntologyNode>(
      `SELECT n.* FROM ontology_nodes n
       JOIN ontology_edges e ON e.end_id = n.id
       WHERE e.start_id = $1
         AND e.type = 'HAS_SLOT'
         AND n.kind = 'slot'`,
      [conceptId]
    )
  },

  /**
   * Get unfilled slots for a specific concept (via HAS_SLOT edges + coverage LEFT JOIN).
   * Returns slots sorted by probe_count ASC (least-probed first).
   */
  async getUnfilledSlotsForConcept(conceptId: string): Promise<Array<OntologyNode & { probe_count: number }>> {
    const graph = await getGraph()
    return graph.query<OntologyNode & { probe_count: number }>(
      `SELECT n.*, COALESCE(c.probe_count, 0) AS probe_count
       FROM ontology_nodes n
       JOIN ontology_edges e ON e.end_id = n.id
       LEFT JOIN ontology_coverage c ON c.slot_id = n.id
       WHERE e.start_id = $1
         AND e.type = 'HAS_SLOT'
         AND n.kind = 'slot'
         AND (c.filled IS NULL OR c.filled = false)
       ORDER BY COALESCE(c.probe_count, 0) ASC`,
      [conceptId]
    )
  },

  /**
   * Get probes for a slot (via HAS_PROBE edges).
   * Ordered by probe's id for determinism.
   */
  async getProbesForSlot(slotId: string): Promise<Array<OntologyNode & { properties: ProbeProperties }>> {
    const graph = await getGraph()
    const rows = await graph.query<OntologyNode>(
      `SELECT n.* FROM ontology_nodes n
       JOIN ontology_edges e ON e.end_id = n.id
       WHERE e.start_id = $1
         AND e.type = 'HAS_PROBE'
         AND n.kind = 'probe'
       ORDER BY n.id`,
      [slotId]
    )
    return rows as Array<OntologyNode & { properties: ProbeProperties }>
  },

  /**
   * Get slot IDs that this slot depends on (DEPENDS_ON edges where start_id = slotId).
   */
  async getSlotDependencies(slotId: string): Promise<string[]> {
    const graph = await getGraph()
    const rows = await graph.query<{ end_id: string }>(
      `SELECT end_id FROM ontology_edges WHERE start_id = $1 AND type = 'DEPENDS_ON'`,
      [slotId]
    )
    return rows.map(r => r.end_id)
  },

  /**
   * Get concept IDs that this concept requires (REQUIRES edges where start_id = conceptId).
   */
  async getConceptRequirements(conceptId: string): Promise<string[]> {
    const graph = await getGraph()
    const rows = await graph.query<{ end_id: string }>(
      `SELECT end_id FROM ontology_edges WHERE start_id = $1 AND type = 'REQUIRES'`,
      [conceptId]
    )
    return rows.map(r => r.end_id)
  },

  /**
   * Check if all given slot IDs are filled in coverage.
   */
  async areSlotsFilled(slotIds: string[]): Promise<boolean> {
    if (slotIds.length === 0) return true
    const graph = await getGraph()
    // Build an IN clause — DuckDB can't bind arrays in prepared stmts
    const placeholders = slotIds.map(id => `'${id.replace(/'/g, "''")}'`).join(', ')
    const rows = await graph.query<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM ontology_coverage
       WHERE slot_id IN (${placeholders}) AND filled = true`
    )
    return (rows[0]?.cnt ?? 0) >= slotIds.length
  },

  /**
   * Check if a concept has all its required slots filled.
   * "Required" here means slots with required=true in their properties.
   */
  async areConceptRequiredSlotsFilled(conceptId: string): Promise<boolean> {
    const graph = await getGraph()
    // Get all required slots for this concept
    const requiredSlots = await graph.query<{ id: string }>(
      `SELECT n.id FROM ontology_nodes n
       JOIN ontology_edges e ON e.end_id = n.id
       WHERE e.start_id = $1
         AND e.type = 'HAS_SLOT'
         AND n.kind = 'slot'
         AND CAST(json_extract_string(n.properties, '$.required') AS BOOLEAN) = true`,
      [conceptId]
    )
    if (requiredSlots.length === 0) return true
    return this.areSlotsFilled(requiredSlots.map(s => s.id))
  },

  /**
   * Check if a concept has ANY unfilled slots (not just required ones).
   */
  async hasUnfilledSlots(conceptId: string): Promise<boolean> {
    const slots = await this.getUnfilledSlotsForConcept(conceptId)
    return slots.length > 0
  },

  // ── Coverage (used by Navigator) ────────────────────────────────────

  async incrementProbeCount(slotId: string): Promise<void> {
    const graph = await getGraph()
    const now = Date.now()
    await graph.exec(
      `UPDATE ontology_coverage SET probe_count = probe_count + 1, last_probed_at = $1, updated_at = $1 WHERE slot_id = $2`,
      [now, slotId]
    )
  },

  // ── Bulk Inserts (for PackageInstaller) ─────────────────────────────

  async insertNode(node: OntologyNode): Promise<void> {
    const graph = await getGraph()
    const propsJson = typeof node.properties === 'string'
      ? node.properties
      : JSON.stringify(node.properties)
    await graph.exec(
      `INSERT INTO ontology_nodes (id, package_id, kind, properties, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [node.id, node.package_id, node.kind, propsJson, node.created_at]
    )
  },

  async insertNodes(nodes: OntologyNode[]): Promise<void> {
    for (const node of nodes) {
      await this.insertNode(node)
    }
  },

  async insertEdge(edge: OntologyEdge): Promise<void> {
    const graph = await getGraph()
    const propsJson = typeof edge.properties === 'string'
      ? edge.properties
      : JSON.stringify(edge.properties)
    await graph.exec(
      `INSERT INTO ontology_edges (id, package_id, start_id, end_id, type, properties, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [edge.id, edge.package_id, edge.start_id, edge.end_id, edge.type, propsJson, edge.created_at]
    )
  },

  async insertEdges(edges: OntologyEdge[]): Promise<void> {
    for (const edge of edges) {
      await this.insertEdge(edge)
    }
  },

}
