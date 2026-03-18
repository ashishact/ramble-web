/**
 * OntologyNavigator — Deterministic Question Picker
 *
 * Walks the ontology graph to find the next unfilled slot and returns
 * a suggestion (question text, style, slot/concept/package metadata).
 *
 * Algorithm is fully deterministic — no LLM, no randomness:
 *   1. Get active packages
 *   2. For each package, get concepts sorted by priority DESC
 *   3. For each concept, check REQUIRES (skip if dependency concept has unfilled required slots)
 *   4. Get unfilled slots sorted by probe_count ASC (least-probed first)
 *   5. For each slot, check DEPENDS_ON (skip if dependency slots unfilled)
 *   6. Load probes, pick first
 *   7. Increment probe_count, return suggestion
 *
 * Same coverage state → same suggestion every time.
 */

import { ontologyStore } from '../../graph/stores/ontologyStore'
import { createLogger } from '../../program/utils/logger'
import type { ConceptProperties, ProbeProperties, SlotProperties } from '../../graph/types'

const log = createLogger('OntologyNavigator')

// ============================================================================
// Types
// ============================================================================

export interface OntologySuggestion {
  questionText: string
  style: 'casual' | 'direct' | 'reflective'
  slotId: string
  slotName: string
  conceptName: string
  packageName: string
}

// ============================================================================
// OntologyNavigator
// ============================================================================

export class OntologyNavigator {
  /**
   * Find the next question to ask the user.
   *
   * Returns null if all slots across all active packages are filled.
   */
  async getNextQuestion(): Promise<OntologySuggestion | null> {
    const packages = await ontologyStore.getInstalledPackages()
    const activePackages = packages.filter(p => p.status === 'active')

    if (activePackages.length === 0) {
      log.debug('No active packages')
      return null
    }

    for (const pkg of activePackages) {
      const concepts = await ontologyStore.getActiveConceptsByPriority(pkg.id)

      for (const concept of concepts) {
        const conceptProps = (
          typeof concept.properties === 'string'
            ? JSON.parse(concept.properties)
            : concept.properties
        ) as ConceptProperties

        // Check REQUIRES: skip if required concept has unfilled required slots
        const requirements = await ontologyStore.getConceptRequirements(concept.id)
        let requirementsMet = true

        for (const reqConceptId of requirements) {
          const reqMet = await ontologyStore.areConceptRequiredSlotsFilled(reqConceptId)
          if (!reqMet) {
            requirementsMet = false
            break
          }
        }

        if (!requirementsMet) {
          log.debug(`Skipping concept "${conceptProps.name}" — requirements not met`)
          continue
        }

        // Get unfilled slots for this concept, sorted by probe_count ASC
        const unfilledSlots = await ontologyStore.getUnfilledSlotsForConcept(concept.id)

        for (const slot of unfilledSlots) {
          const slotProps = (
            typeof slot.properties === 'string'
              ? JSON.parse(slot.properties)
              : slot.properties
          ) as SlotProperties

          // Check DEPENDS_ON: skip if dependency slots are unfilled
          const deps = await ontologyStore.getSlotDependencies(slot.id)
          if (deps.length > 0) {
            const depsMet = await ontologyStore.areSlotsFilled(deps)
            if (!depsMet) {
              log.debug(`Skipping slot "${slotProps.name}" — dependencies not met`)
              continue
            }
          }

          // Load probes for this slot
          const probes = await ontologyStore.getProbesForSlot(slot.id)
          if (probes.length === 0) {
            log.warn(`Slot "${slotProps.name}" has no probes, skipping`)
            continue
          }

          // Pick first probe (they're ordered by id for determinism)
          const probe = probes[0]
          const probeProps = (
            typeof probe.properties === 'string'
              ? JSON.parse(probe.properties)
              : probe.properties
          ) as ProbeProperties

          // Increment probe count
          await ontologyStore.incrementProbeCount(slot.id)

          const suggestion: OntologySuggestion = {
            questionText: probeProps.question,
            style: probeProps.style,
            slotId: slot.id,
            slotName: slotProps.name,
            conceptName: conceptProps.name,
            packageName: pkg.name,
          }

          log.debug(`Next question: "${probeProps.question}" (${slotProps.name} / ${conceptProps.name} / ${pkg.name})`)
          return suggestion
        }
      }
    }

    log.info('All slots filled across all packages')
    return null
  }
}
