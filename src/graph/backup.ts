/**
 * Graph Backup — File System Access API
 *
 * Exports the DuckDB database file to a user-chosen directory.
 * Uses the File System Access API (Chrome 86+) for native file writes.
 *
 * Also supports periodic automatic backups to OPFS (no permission prompt).
 */

import type { GraphService } from './GraphService'

/**
 * Let the user pick a directory, then write the database export there.
 * Returns the file name written.
 */
export async function backupToDirectory(graph: GraphService): Promise<string> {
  // Check for File System Access API support
  if (!('showDirectoryPicker' in window)) {
    throw new Error('File System Access API not supported in this browser')
  }

  // @ts-expect-error — File System Access API types not in default lib
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }) as FileSystemDirectoryHandle
  const bytes = await graph.exportBytes()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `ramble-graph-${timestamp}.duckdb`

  const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(bytes)
  await writable.close()

  return fileName
}

/**
 * Automatic periodic backup to OPFS (no permission prompt).
 * Creates timestamped snapshots in /ramble/{profileName}/backups/
 * Keeps the last N backups, deletes older ones.
 */
export async function backupToOPFS(
  graph: GraphService,
  profileName: string,
  maxBackups = 5
): Promise<void> {
  const bytes = await graph.exportBytes()
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fileName = `graph-${timestamp}.duckdb`

  const root = await navigator.storage.getDirectory()
  const rambleDir = await root.getDirectoryHandle('ramble', { create: true })
  const profileDir = await rambleDir.getDirectoryHandle(profileName, { create: true })
  const backupsDir = await profileDir.getDirectoryHandle('backups', { create: true })

  // Write new backup
  const fileHandle = await backupsDir.getFileHandle(fileName, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(bytes)
  await writable.close()

  // Prune old backups (keep newest N)
  const entries: string[] = []
  // @ts-expect-error — OPFS directory entries() async iterator not in default lib
  for await (const [name] of backupsDir) {
    if (typeof name === 'string' && name.endsWith('.duckdb')) {
      entries.push(name)
    }
  }

  if (entries.length > maxBackups) {
    entries.sort() // ISO timestamps sort chronologically
    const toDelete = entries.slice(0, entries.length - maxBackups)
    for (const name of toDelete) {
      await backupsDir.removeEntry(name)
    }
  }
}

/**
 * Start periodic automatic backups to OPFS.
 * Runs every `intervalMs` (default: 30 minutes).
 * Returns a cleanup function to stop the timer.
 */
export function startPeriodicBackup(
  graph: GraphService,
  profileName: string,
  intervalMs = 30 * 60 * 1000
): () => void {
  const timer = setInterval(async () => {
    try {
      await backupToOPFS(graph, profileName)
    } catch (err) {
      console.warn('[GraphBackup] Periodic backup failed:', err)
    }
  }, intervalMs)

  return () => clearInterval(timer)
}
