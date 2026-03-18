/**
 * useOntologyData — Ontology Browser React Hook
 *
 * Loads the full package→concept→slot tree from DuckDB via ontologyStore,
 * groups flat rows into a hierarchical view.
 * Re-fetches when ontology tables change via graphEventBus.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { graphEventBus } from '../../../graph/events'
import type { PackageTreeRow } from '../../../graph/stores/ontologyStore'

// ── View types (consumed by OntologyBrowser) ───────────────────────

export interface SlotView {
  id: string
  name: string
  description: string
}

export interface ConceptView {
  id: string
  name: string
  description: string
  priority: number
  slots: SlotView[]
}

export interface PackageView {
  id: string
  name: string
  status: string
  concepts: ConceptView[]
}

// ── Grouping logic ─────────────────────────────────────────────────

function groupRowsIntoTree(rows: PackageTreeRow[]): PackageView[] {
  const packageMap = new Map<string, PackageView>()
  const conceptMap = new Map<string, ConceptView>()
  const seenSlots = new Set<string>()

  for (const row of rows) {
    // Package
    if (!packageMap.has(row.package_id)) {
      packageMap.set(row.package_id, {
        id: row.package_id,
        name: row.package_name,
        status: row.package_status,
        concepts: [],
      })
    }

    // Concept
    const conceptKey = `${row.package_id}::${row.concept_id}`
    if (!conceptMap.has(conceptKey)) {
      const props = typeof row.concept_props === 'string'
        ? JSON.parse(row.concept_props)
        : row.concept_props
      const concept: ConceptView = {
        id: row.concept_id,
        name: props.name ?? row.concept_id,
        description: props.description ?? '',
        priority: props.priority ?? 0,
        slots: [],
      }
      conceptMap.set(conceptKey, concept)
      packageMap.get(row.package_id)!.concepts.push(concept)
    }

    // Slot (deduplicate — a slot could appear if there are multiple edges)
    const slotKey = `${conceptKey}::${row.slot_id}`
    if (!seenSlots.has(slotKey)) {
      seenSlots.add(slotKey)
      const slotProps = typeof row.slot_props === 'string'
        ? JSON.parse(row.slot_props)
        : row.slot_props
      const slot: SlotView = {
        id: row.slot_id,
        name: slotProps.name ?? row.slot_id,
        description: slotProps.description ?? '',
      }

      const concept = conceptMap.get(conceptKey)!
      concept.slots.push(slot)
    }
  }

  return Array.from(packageMap.values())
}

// ── Hook ───────────────────────────────────────────────────────────

interface UseOntologyDataResult {
  packages: PackageView[]
  isLoading: boolean
}

export function useOntologyData(): UseOntologyDataResult {
  const [packages, setPackages] = useState<PackageView[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const mountedRef = useRef(true)

  const fetchTree = useCallback(async () => {
    try {
      const { ontologyStore } = await import('../../../graph/stores/ontologyStore')
      const rows = await ontologyStore.getFullPackageTree()
      if (mountedRef.current) {
        setPackages(groupRowsIntoTree(rows))
      }
    } catch (err) {
      console.warn('[OntologyBrowser] Failed to load package tree:', err)
    } finally {
      if (mountedRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  // Initial load
  useEffect(() => {
    mountedRef.current = true
    fetchTree()
    return () => { mountedRef.current = false }
  }, [fetchTree])

  // Re-fetch when ontology tables change
  useEffect(() => {
    const ONTOLOGY_TABLES = [
      'ontology_packages', 'ontology_nodes', 'ontology_edges',
    ]
    const unsub = graphEventBus.on('graph:tables:changed', ({ tables }) => {
      if (tables.some((t: string) => ONTOLOGY_TABLES.includes(t))) {
        fetchTree()
      }
    })
    return unsub
  }, [fetchTree])

  return { packages, isLoading }
}
