/**
 * WatermelonDB Data Import Utility
 *
 * Imports JSON data from TinyBase export into WatermelonDB
 */

import type { Database } from '@nozbe/watermelondb'
import type { TinyBaseExport } from './exportTinyBase'
import { createLogger } from '../../program/utils/logger'

const logger = createLogger('WatermelonImport')

/**
 * Import JSON data into WatermelonDB
 */
export async function importJSONToWatermelon(
  jsonData: TinyBaseExport,
  db: Database
): Promise<void> {
  logger.info('Starting import to WatermelonDB')
  logger.info(`Import version: ${jsonData.version}, exported at: ${new Date(jsonData.exportedAt).toISOString()}`)

  const { tables } = jsonData

  // Import in dependency order to respect foreign keys
  await importTable(db, 'extraction_programs', tables.extractionPrograms)
  await importTable(db, 'observer_programs', tables.observerPrograms)
  await importTable(db, 'extensions', tables.extensions)

  await importTable(db, 'sessions', tables.sessions)
  await importTable(db, 'conversations', tables.conversations)

  await importTable(db, 'claims', tables.claims)
  await importTable(db, 'source_tracking', tables.sourceTracking)
  await importTable(db, 'claim_sources', tables.claimSources)

  await importTable(db, 'entities', tables.entities)
  await importTable(db, 'goals', tables.goals)
  await importTable(db, 'observer_outputs', tables.observer_outputs)
  await importTable(db, 'contradictions', tables.contradictions)
  await importTable(db, 'patterns', tables.patterns)
  await importTable(db, 'values', tables.values)

  await importTable(db, 'corrections', tables.corrections)
  await importTable(db, 'tasks', tables.tasks)
  await importTable(db, 'synthesis_cache', tables.synthesisCache)

  logger.info('Import complete')
}

/**
 * Import a single table with batching
 */
async function importTable(
  db: Database,
  tableName: string,
  data: Record<string, any> | undefined
): Promise<void> {
  if (!data) {
    logger.warn(`No data for table: ${tableName}`)
    return
  }

  const entries = Object.entries(data)
  logger.info(`Importing ${entries.length} records into ${tableName}`)

  if (entries.length === 0) {
    return
  }

  const BATCH_SIZE = 500

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)

    await db.write(async () => {
      const collection = db.get(tableName)

      for (const [id, row] of batch) {
        try {
          await collection.create((record: any) => {
            record._raw.id = id // Preserve original IDs
            // Map all fields from row to record
            mapFieldsToModel(record, row, tableName)
          })
        } catch (error) {
          logger.error(`Failed to import record ${id} in ${tableName}:`, error)
        }
      }
    })

    const imported = Math.min(i + BATCH_SIZE, entries.length)
    logger.info(`Imported ${imported} / ${entries.length} records in ${tableName}`)
  }
}

/**
 * Map TinyBase row data to WatermelonDB model
 * Handles field name conversions (snake_case to camelCase)
 */
function mapFieldsToModel(record: any, row: any, tableName: string): void {
  // Copy all fields from row to record
  // Since we're using camelCase in both TinyBase and WatermelonDB now,
  // we can do a direct copy for most fields
  for (const [key, value] of Object.entries(row)) {
    if (key !== 'id') {
      // Skip 'id' as it's handled separately
      try {
        record[key] = value
      } catch (error) {
        logger.warn(`Failed to map field ${key} in table ${tableName}:`, error)
      }
    }
  }
}

/**
 * Clear all data from WatermelonDB (for testing/reset)
 */
export async function clearAllData(db: Database): Promise<void> {
  logger.warn('Clearing all data from WatermelonDB')

  const tableNames = [
    'sessions',
    'conversations',
    'claims',
    'source_tracking',
    'claim_sources',
    'entities',
    'goals',
    'observer_outputs',
    'contradictions',
    'patterns',
    'values',
    'extraction_programs',
    'observer_programs',
    'extensions',
    'synthesis_cache',
    'corrections',
    'tasks',
  ]

  for (const tableName of tableNames) {
    await db.write(async () => {
      const collection = db.get(tableName)
      const allRecords = await collection.query().fetch()

      for (const record of allRecords) {
        await record.destroyPermanently()
      }
    })

    logger.info(`Cleared table: ${tableName}`)
  }

  logger.info('All data cleared')
}

/**
 * Get import statistics
 */
export async function getImportStats(db: Database): Promise<{
  totalRecords: number
  tableStats: Record<string, number>
}> {
  const tableNames = [
    'sessions',
    'conversations',
    'claims',
    'source_tracking',
    'claim_sources',
    'entities',
    'goals',
    'observer_outputs',
    'contradictions',
    'patterns',
    'values',
    'extraction_programs',
    'observer_programs',
    'extensions',
    'synthesis_cache',
    'corrections',
    'tasks',
  ]

  const tableStats: Record<string, number> = {}
  let totalRecords = 0

  for (const tableName of tableNames) {
    const collection = db.get(tableName)
    const count = await collection.query().fetchCount()
    tableStats[tableName] = count
    totalRecords += count
  }

  return { totalRecords, tableStats }
}
