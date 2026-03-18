/**
 * Ontology Module — Singleton Management & Init
 *
 * Lazy-initializes the OntologyNavigator and PackageInstaller.
 * Follows the same pattern as src/modules/sys1/index.ts.
 *
 * Called from BentoApp after graph is ready:
 *   const { initOntology } = await import('../modules/ontology')
 *   initOntology()
 */

import { OntologyNavigator } from './OntologyNavigator'
import type { OntologySuggestion } from './OntologyNavigator'
import { PackageInstaller } from './PackageInstaller'
import { eventBus } from '../../lib/eventBus'

let navigator: OntologyNavigator | null = null
let installer: PackageInstaller | null = null

/** Last emitted suggestion — cached so late-mounting widgets can read it */
let lastSuggestion: OntologySuggestion | null = null

export function getOntologyNavigator(): OntologyNavigator {
  if (!navigator) {
    navigator = new OntologyNavigator()
  }
  return navigator
}

export function getPackageInstaller(): PackageInstaller {
  if (!installer) {
    installer = new PackageInstaller()
  }
  return installer
}

/**
 * Get the last emitted suggestion (for late-mounting widgets).
 * Returns null if no suggestion is available.
 */
export function getLastSuggestion(): OntologySuggestion | null {
  return lastSuggestion
}

/**
 * Run the navigator and emit the result as an event.
 * Also caches the result so late-mounting widgets can read it via getLastSuggestion().
 * Called after init and after each slot fill.
 */
export async function emitNextSuggestion(): Promise<void> {
  const nav = getOntologyNavigator()
  const suggestion = await nav.getNextQuestion()

  if (suggestion) {
    lastSuggestion = suggestion
    eventBus.emit('ontology:suggestion', suggestion)
  } else {
    lastSuggestion = null
    eventBus.emit('ontology:suggestion-cleared', {})
  }
}

/**
 * Initialize the ontology system.
 * Called once from BentoApp after graph is ready.
 *
 * 1. Install default packages if needed
 * 2. Emit the first suggestion
 */
export async function initOntology(): Promise<void> {
  const inst = getPackageInstaller()
  await inst.installDefaultsIfNeeded()

  // Emit first suggestion
  await emitNextSuggestion()
}
