/**
 * Graph Backup — File System Access API
 *
 * Persists DuckDB database snapshots to a user-chosen directory.
 * Uses the File System Access API (Chrome 86+) for native file writes.
 *
 * Storage layout:
 * - localStorage `ramble_backup`: JSON config with folder name + per-profile timestamps
 * - IndexedDB `ramble-backup-handles`: FileSystemDirectoryHandle (not JSON-serializable)
 *
 * The backup folder is shared across all profiles — one folder, separate timestamps.
 */

import { GraphService } from './GraphService'
import { createLogger } from '../program/utils/logger'

const logger = createLogger('Backup')

// ============================================================================
// Types
// ============================================================================

export interface BackupProfileConfig {
  lastBackupAt: number
}

export interface BackupConfig {
  folderName: string
  profiles: Record<string, BackupProfileConfig>
}

// ============================================================================
// localStorage — JSON config (folder name + per-profile timestamps)
// ============================================================================

const LS_KEY = 'ramble_backup'

export function getBackupConfig(): BackupConfig | null {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return JSON.parse(raw) as BackupConfig
  } catch {
    return null
  }
}

export function saveBackupConfig(config: BackupConfig): void {
  localStorage.setItem(LS_KEY, JSON.stringify(config))
}

// ============================================================================
// IndexedDB — FileSystemDirectoryHandle persistence
// ============================================================================

const IDB_NAME = 'ramble-backup-handles'
const IDB_KEY = 'backup-folder'

export async function saveBackupHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles')
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('handles', 'readwrite')
      tx.objectStore('handles').put(handle, IDB_KEY)
      tx.oncomplete = () => { db.close(); resolve() }
      tx.onerror = () => { db.close(); reject(tx.error) }
    }
    request.onerror = () => reject(request.error)
  })
}

export async function loadBackupHandle(): Promise<FileSystemDirectoryHandle | null> {
  return new Promise((resolve) => {
    const request = indexedDB.open(IDB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('handles')
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('handles', 'readonly')
      const getReq = tx.objectStore('handles').get(IDB_KEY)
      getReq.onsuccess = () => {
        db.close()
        resolve(getReq.result ?? null)
      }
      getReq.onerror = () => { db.close(); resolve(null) }
    }
    request.onerror = () => resolve(null)
  })
}

// ============================================================================
// Folder Picker
// ============================================================================

/**
 * Show directory picker, save handle + update config with folder name.
 * Returns the chosen folder name or null if cancelled.
 */
export async function pickBackupFolder(): Promise<string | null> {
  if (!window.showDirectoryPicker) {
    throw new Error('File System Access API not supported in this browser')
  }

  let dirHandle: FileSystemDirectoryHandle
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch {
    // User cancelled the picker
    return null
  }

  await saveBackupHandle(dirHandle)

  const config = getBackupConfig() ?? { folderName: '', profiles: {} }
  config.folderName = dirHandle.name
  saveBackupConfig(config)

  logger.info('Backup folder set', dirHandle.name)
  return dirHandle.name
}

// ============================================================================
// Handle Retrieval (with permission re-request)
// ============================================================================

/**
 * Load saved handle from IndexedDB and request readwrite permission.
 * Returns null if no handle saved or permission denied.
 */
export async function getBackupHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadBackupHandle()
  if (!handle) return null

  try {
    const perm = await handle.requestPermission({ mode: 'readwrite' })
    if (perm !== 'granted') return null
    return handle
  } catch {
    return null
  }
}

// ============================================================================
// Backup Execution
// ============================================================================

/** Module-level lock to prevent concurrent backups */
let backupInProgress = false

/**
 * Perform a backup for the given profile.
 * Exports bytes from DuckDB, writes {profile}-{YYYY-MM-DD}.duckdb,
 * prunes to keep the last 10 files per profile.
 */
export async function performBackup(profile: string): Promise<void> {
  if (backupInProgress) {
    logger.warn('Backup already in progress, skipping')
    return
  }

  const handle = await getBackupHandle()
  if (!handle) {
    throw new Error('No backup folder configured or permission denied')
  }

  backupInProgress = true
  try {
    const graph = await GraphService.getInstance()
    const bytes = await graph.exportBytes()

    if (!bytes || bytes.byteLength === 0) {
      throw new Error('Export returned empty bytes')
    }

    // Same-day backup overwrites (YYYY-MM-DD)
    const date = new Date().toISOString().slice(0, 10)
    const fileName = `${profile}-${date}.duckdb`

    const fileHandle = await handle.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    await writable.write(bytes)
    await writable.close()

    // Prune: keep last 10 per profile
    const prefix = `${profile}-`
    const entries: string[] = []
    // @ts-expect-error — OPFS directory entries() async iterator
    for await (const [name] of handle) {
      if (typeof name === 'string' && name.startsWith(prefix) && name.endsWith('.duckdb')) {
        entries.push(name)
      }
    }

    if (entries.length > 10) {
      entries.sort() // ISO date sorts chronologically
      const toDelete = entries.slice(0, entries.length - 10)
      for (const name of toDelete) {
        await handle.removeEntry(name)
        logger.debug('Pruned old backup', name)
      }
    }

    // Update config
    const config = getBackupConfig() ?? { folderName: handle.name, profiles: {} }
    config.profiles[profile] = { lastBackupAt: Date.now() }
    saveBackupConfig(config)

    const sizeMB = (bytes.byteLength / (1024 * 1024)).toFixed(1)
    logger.info(`Backup complete: ${fileName} (${sizeMB} MB)`)
  } finally {
    backupInProgress = false
  }
}

export function isBackupInProgress(): boolean {
  return backupInProgress
}

// ============================================================================
// Auto-Backup (visibility change + idle fallback)
// ============================================================================

let autoBackupInitialized = false

/**
 * Initialize automatic backup for the current profile.
 * Triggers on tab hidden (visibilitychange) + requestIdleCallback fallback (30 min).
 * Only runs if > 24h since last backup for this profile.
 */
export function initAutoBackup(profile: string): () => void {
  if (autoBackupInitialized) return () => {}
  autoBackupInitialized = true

  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000
  const IDLE_INTERVAL = 30 * 60 * 1000 // 30 minutes

  const shouldBackup = (): boolean => {
    const config = getBackupConfig()
    if (!config) return false // No folder configured
    const profileConfig = config.profiles[profile]
    if (!profileConfig) return true // Never backed up
    return Date.now() - profileConfig.lastBackupAt > TWENTY_FOUR_HOURS
  }

  const tryBackup = async () => {
    if (!shouldBackup()) return
    try {
      await performBackup(profile)
    } catch (err) {
      logger.warn('Auto-backup failed', err)
    }
  }

  // Trigger when tab becomes hidden (user navigates away)
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      tryBackup()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)

  // Idle fallback — check every 30 minutes
  let idleTimer: ReturnType<typeof setInterval> | null = null
  idleTimer = setInterval(() => {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(() => tryBackup())
    } else {
      tryBackup()
    }
  }, IDLE_INTERVAL)

  logger.info('Auto-backup initialized for profile', profile)

  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    if (idleTimer) clearInterval(idleTimer)
    autoBackupInitialized = false
  }
}
