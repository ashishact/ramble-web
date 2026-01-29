/**
 * WatermelonDB Database Initialization
 *
 * Core Loop Architecture - Profile-based database isolation
 * Each profile gets its own database for complete data isolation.
 */

import { Database } from '@nozbe/watermelondb'
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs'
import { schema, migrations } from './schema'
import * as models from './models'
import { getCurrentProfile, getDatabaseName } from '../lib/profile'

// Current database instance
let currentDatabase: Database | null = null
let currentProfile: string | null = null

/**
 * Initialize or get the database for the current profile
 */
export function initializeDatabase(profile?: string): Database {
  const targetProfile = profile ?? getCurrentProfile()
  const dbName = getDatabaseName(targetProfile)

  // Return existing database if same profile
  if (currentDatabase && currentProfile === targetProfile) {
    return currentDatabase
  }

  // Create new adapter and database for this profile
  const adapter = new LokiJSAdapter({
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    dbName,
  })

  currentDatabase = new Database({
    adapter,
    modelClasses: Object.values(models),
  })

  currentProfile = targetProfile

  console.log(`[Database] Initialized database for profile: ${targetProfile} (${dbName})`)

  return currentDatabase
}

/**
 * Get the current database instance
 * Initializes if not already initialized
 */
export function getDatabase(): Database {
  if (!currentDatabase) {
    return initializeDatabase()
  }
  return currentDatabase
}

/**
 * Get the current profile name
 */
export function getActiveProfile(): string {
  return currentProfile ?? getCurrentProfile()
}

// Export database getter (lazy initialization)
export const database = new Proxy({} as Database, {
  get(_, prop) {
    const db = getDatabase()
    return (db as unknown as Record<string | symbol, unknown>)[prop]
  }
})

// Export collections (lazy, uses current database)
export const collections = {
  get sessions() { return getDatabase().get('sessions') },
  get conversations() { return getDatabase().get('conversations') },
  get tasks() { return getDatabase().get('tasks') },
  get entities() { return getDatabase().get('entities') },
  get topics() { return getDatabase().get('topics') },
  get memories() { return getDatabase().get('memories') },
  get goals() { return getDatabase().get('goals') },
  get plugins() { return getDatabase().get('plugins') },
  get corrections() { return getDatabase().get('corrections') },
  get learnedCorrections() { return getDatabase().get('learned_corrections') },
  get extractionLogs() { return getDatabase().get('extraction_logs') },
  get data() { return getDatabase().get('data') },
}

// Type-safe collection getters
export function getCollection<T extends keyof typeof collections>(name: T) {
  return collections[name]
}
