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
  dbName: 'ramble_watermelon', // New DB name (parallel to TinyBase)
})

export const database = new Database({
  adapter,
  modelClasses: Object.values(models),
})

// Export collections for easy access
export const collections = {
  sessions: database.get('sessions'),
  conversations: database.get('conversations'),
  claims: database.get('claims'),
  sourceTracking: database.get('source_tracking'),
  claimSources: database.get('claim_sources'),
  entities: database.get('entities'),
  goals: database.get('goals'),
  observerOutputs: database.get('observer_outputs'),
  contradictions: database.get('contradictions'),
  patterns: database.get('patterns'),
  values: database.get('values'),
  extractionPrograms: database.get('extraction_programs'),
  observerPrograms: database.get('observer_programs'),
  extensions: database.get('extensions'),
  synthesisCache: database.get('synthesis_cache'),
  corrections: database.get('corrections'),
  tasks: database.get('tasks'),
}
