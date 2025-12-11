/**
 * TinyBase Data Export Utility
 *
 * Exports all TinyBase data to JSON for backup and import into WatermelonDB
 */

import type { Store } from 'tinybase'
import { createLogger } from '../../program/utils/logger'

const logger = createLogger('TinyBaseExport')

export interface TinyBaseExport {
  version: number
  exportedAt: number
  tables: {
    [tableName: string]: Record<string, any>
  }
}

/**
 * Export all TinyBase data to JSON format
 */
export async function exportTinyBaseToJSON(store: Store): Promise<TinyBaseExport> {
  logger.info('Exporting TinyBase data to JSON')

  const tables: Record<string, Record<string, any>> = {}

  // Export all 17 tables
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
    const table = store.getTable(tableName)
    if (table) {
      tables[tableName] = table
      const count = Object.keys(table).length
      logger.info(`Exported ${count} records from ${tableName}`)
    } else {
      logger.warn(`Table ${tableName} not found in store`)
      tables[tableName] = {}
    }
  }

  const exportData: TinyBaseExport = {
    version: 1,
    exportedAt: Date.now(),
    tables,
  }

  logger.info('Export complete')
  return exportData
}

/**
 * Download JSON data as file in browser
 */
export function downloadJSON(data: TinyBaseExport, filename = 'ramble_export.json'): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)

  logger.info(`Downloaded export to ${filename}`)
}

/**
 * Get export statistics
 */
export function getExportStats(exportData: TinyBaseExport): {
  totalRecords: number
  tableStats: Record<string, number>
} {
  const tableStats: Record<string, number> = {}
  let totalRecords = 0

  for (const [tableName, table] of Object.entries(exportData.tables)) {
    const count = Object.keys(table).length
    tableStats[tableName] = count
    totalRecords += count
  }

  return { totalRecords, tableStats }
}
