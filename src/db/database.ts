/**
 * WatermelonDB Database Initialization
 *
 * Minimal skeleton — kept for future use.
 * Data lives in DuckDB; WatermelonDB is initialized with
 * a single placeholder table so the library stays functional.
 */

import { Database } from '@nozbe/watermelondb'
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs'
import { appSchema, tableSchema } from '@nozbe/watermelondb'
import { getCurrentProfile, getDatabaseName } from '../lib/profile'

// Minimal schema — one placeholder table
const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: '_placeholder',
      columns: [
        { name: 'created_at', type: 'number' },
      ],
    }),
  ],
})

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
    useWebWorker: false,
    useIncrementalIndexedDB: true,
    dbName,
  })

  currentDatabase = new Database({
    adapter,
    modelClasses: [],
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
