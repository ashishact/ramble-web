/**
 * WatermelonDB Database Initialization
 *
 * Core Loop Architecture - Fresh database: ramble_v3
 */

import { Database } from '@nozbe/watermelondb'
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs'
import { schema, DATABASE_NAME } from './schema'
import * as models from './models'

const adapter = new LokiJSAdapter({
  schema,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  dbName: DATABASE_NAME,
})

export const database = new Database({
  adapter,
  modelClasses: Object.values(models),
})

// Export collections for easy access
export const collections = {
  // Core
  sessions: database.get('sessions'),
  conversations: database.get('conversations'),
  tasks: database.get('tasks'),

  // Knowledge
  entities: database.get('entities'),
  topics: database.get('topics'),
  memories: database.get('memories'),
  goals: database.get('goals'),

  // System
  plugins: database.get('plugins'),
  corrections: database.get('corrections'),
  extractionLogs: database.get('extraction_logs'),
}

// Type-safe collection getters
export function getCollection<T extends keyof typeof collections>(name: T) {
  return collections[name]
}
