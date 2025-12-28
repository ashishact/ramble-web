/**
 * WatermelonDB Database Initialization
 */

import { Database } from '@nozbe/watermelondb'
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs'
import { schema } from './schema'
import { migrations } from './migrations'
import * as models from './models'

const adapter = new LokiJSAdapter({
  schema,
  migrations,
  useWebWorker: false,
  useIncrementalIndexedDB: true, // Only persist changes, not entire DB
  dbName: 'DEFAULT', // Fresh database with consolidated schema
})

export const database = new Database({
  adapter,
  modelClasses: Object.values(models),
})

// Export collections for easy access
export const collections = {
  // Support
  sessions: database.get('sessions'),
  tasks: database.get('tasks'),

  // Layer 0: Stream
  conversations: database.get('conversations'),

  // Layer 1: Primitives
  propositions: database.get('propositions'),
  stances: database.get('stances'),
  relations: database.get('relations'),
  spans: database.get('spans'),
  primitiveEntities: database.get('primitive_entities'),
  entities: database.get('entities'),

  // Layer 2: Derived
  derived: database.get('derived'),
  claims: database.get('claims'),
  goals: database.get('goals'),
  patterns: database.get('patterns'),
  values: database.get('values'),
  contradictions: database.get('contradictions'),

  // Provenance
  claimSources: database.get('claim_sources'),

  // Observers & Extractors
  observerOutputs: database.get('observer_outputs'),
  extractionPrograms: database.get('extraction_programs'),
  observerPrograms: database.get('observer_programs'),

  // Support
  extensions: database.get('extensions'),
  synthesisCache: database.get('synthesis_cache'),
  corrections: database.get('corrections'),
}
