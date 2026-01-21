/**
 * Database Backup System
 *
 * Simple hourly backup using raw IndexedDB.
 * - Stores full JSON export of all tables
 * - Keeps only the latest 3 backups
 * - Only backs up if data has changed
 *
 * Backup structure:
 * - timestamp: when backup was taken
 * - data: full JSON export of all tables
 * - checksum: simple hash to detect changes
 */

import { database } from './database';

// Backup database name (separate from main DB)
const BACKUP_DB_NAME = 'ramble_backups';
const BACKUP_STORE_NAME = 'backups';
const BACKUP_DB_VERSION = 1;

// How many backups to keep
const MAX_BACKUPS = 3;

// Backup interval in milliseconds (1 hour)
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

// Tables to backup
const TABLES_TO_BACKUP = [
  'sessions',
  'conversations',
  'tasks',
  'entities',
  'topics',
  'memories',
  'goals',
  'plugins',
  'corrections',
  'extraction_logs',
];

// ============================================================================
// Types
// ============================================================================

export interface BackupEntry {
  timestamp: number;
  data: Record<string, unknown[]>;
  checksum: string;
  recordCount: number;
}

export interface BackupMetadata {
  timestamp: number;
  recordCount: number;
  checksum: string;
}

// ============================================================================
// IndexedDB Helpers
// ============================================================================

function openBackupDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKUP_DB_NAME, BACKUP_DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create the backups store if it doesn't exist
      if (!db.objectStoreNames.contains(BACKUP_STORE_NAME)) {
        // Use timestamp as key
        db.createObjectStore(BACKUP_STORE_NAME, { keyPath: 'timestamp' });
      }
    };
  });
}

// ============================================================================
// Export Data
// ============================================================================

/**
 * Export all data from WatermelonDB to JSON
 */
async function exportAllData(): Promise<Record<string, unknown[]>> {
  const data: Record<string, unknown[]> = {};

  for (const tableName of TABLES_TO_BACKUP) {
    try {
      const collection = database.get(tableName);
      const records = await collection.query().fetch();

      // Convert WatermelonDB models to plain objects
      data[tableName] = records.map((record) => {
        const raw: Record<string, unknown> = { id: record.id };

        // Get all column values from _raw
        const rawData = (record as unknown as { _raw: Record<string, unknown> })._raw;
        if (rawData) {
          for (const [key, value] of Object.entries(rawData)) {
            if (key !== 'id' && key !== '_status' && key !== '_changed') {
              raw[key] = value;
            }
          }
        }

        return raw;
      });
    } catch (error) {
      console.warn(`Backup: Failed to export table ${tableName}:`, error);
      data[tableName] = [];
    }
  }

  return data;
}

/**
 * Calculate a simple checksum for change detection
 */
function calculateChecksum(data: Record<string, unknown[]>): string {
  // Simple checksum: count of records per table + total record count
  const counts = TABLES_TO_BACKUP.map((t) => data[t]?.length ?? 0);
  const total = counts.reduce((a, b) => a + b, 0);

  // Include a hash of the first few record IDs for better change detection
  const sampleIds: string[] = [];
  for (const tableName of TABLES_TO_BACKUP) {
    const records = data[tableName] ?? [];
    for (let i = 0; i < Math.min(3, records.length); i++) {
      const record = records[i] as { id?: string };
      if (record.id) sampleIds.push(record.id);
    }
  }

  return `${total}:${counts.join(',')}:${sampleIds.slice(0, 10).join(',')}`;
}

// ============================================================================
// Backup Operations
// ============================================================================

/**
 * Get all existing backups (sorted by timestamp, newest first)
 */
export async function getBackups(): Promise<BackupMetadata[]> {
  const db = await openBackupDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const request = store.getAll();

    request.onerror = () => {
      db.close();
      reject(request.error);
    };

    request.onsuccess = () => {
      db.close();
      const backups = (request.result as BackupEntry[])
        .map((b) => ({
          timestamp: b.timestamp,
          recordCount: b.recordCount,
          checksum: b.checksum,
        }))
        .sort((a, b) => b.timestamp - a.timestamp); // Newest first

      resolve(backups);
    };
  });
}

/**
 * Get a specific backup by timestamp
 */
export async function getBackup(timestamp: number): Promise<BackupEntry | null> {
  const db = await openBackupDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readonly');
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const request = store.get(timestamp);

    request.onerror = () => {
      db.close();
      reject(request.error);
    };

    request.onsuccess = () => {
      db.close();
      resolve(request.result ?? null);
    };
  });
}

/**
 * Get the latest backup
 */
export async function getLatestBackup(): Promise<BackupEntry | null> {
  const backups = await getBackups();
  if (backups.length === 0) return null;

  return getBackup(backups[0].timestamp);
}

/**
 * Create a new backup
 * Returns true if backup was created, false if skipped (no changes)
 */
export async function createBackup(force = false): Promise<boolean> {
  // Export all data
  const data = await exportAllData();
  const checksum = calculateChecksum(data);
  const recordCount = TABLES_TO_BACKUP.reduce(
    (sum, t) => sum + (data[t]?.length ?? 0),
    0
  );

  // Check if we need to backup
  if (!force) {
    const latestBackup = await getLatestBackup();
    if (latestBackup && latestBackup.checksum === checksum) {
      console.log('Backup: Skipped (no changes detected)');
      return false;
    }
  }

  // Create backup entry
  const backup: BackupEntry = {
    timestamp: Date.now(),
    data,
    checksum,
    recordCount,
  };

  // Save to IndexedDB
  const db = await openBackupDB();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const request = store.add(backup);

    request.onerror = () => {
      db.close();
      reject(request.error);
    };

    request.onsuccess = () => {
      db.close();
      resolve();
    };
  });

  console.log(`Backup: Created at ${new Date(backup.timestamp).toISOString()} (${recordCount} records)`);

  // Prune old backups
  await pruneBackups();

  return true;
}

/**
 * Delete old backups, keeping only the latest MAX_BACKUPS
 */
async function pruneBackups(): Promise<void> {
  const backups = await getBackups();

  if (backups.length <= MAX_BACKUPS) {
    return;
  }

  // Get timestamps of backups to delete (oldest ones)
  const toDelete = backups.slice(MAX_BACKUPS);

  const db = await openBackupDB();

  for (const backup of toDelete) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
      const store = tx.objectStore(BACKUP_STORE_NAME);
      const request = store.delete(backup.timestamp);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

    console.log(`Backup: Deleted old backup from ${new Date(backup.timestamp).toISOString()}`);
  }

  db.close();
}

/**
 * Delete all backups
 */
export async function clearAllBackups(): Promise<void> {
  const db = await openBackupDB();

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(BACKUP_STORE_NAME, 'readwrite');
    const store = tx.objectStore(BACKUP_STORE_NAME);
    const request = store.clear();

    request.onerror = () => {
      db.close();
      reject(request.error);
    };

    request.onsuccess = () => {
      db.close();
      resolve();
    };
  });

  console.log('Backup: All backups cleared');
}

// ============================================================================
// Backup Scheduler
// ============================================================================

let backupIntervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the hourly backup scheduler
 */
export function startBackupScheduler(): void {
  if (backupIntervalId) {
    console.log('Backup: Scheduler already running');
    return;
  }

  // Run initial backup after a short delay (let app initialize)
  setTimeout(() => {
    createBackup().catch((err) => {
      console.error('Backup: Initial backup failed:', err);
    });
  }, 5000);

  // Schedule hourly backups
  backupIntervalId = setInterval(() => {
    createBackup().catch((err) => {
      console.error('Backup: Scheduled backup failed:', err);
    });
  }, BACKUP_INTERVAL_MS);

  console.log('Backup: Scheduler started (hourly backups)');
}

/**
 * Stop the backup scheduler
 */
export function stopBackupScheduler(): void {
  if (backupIntervalId) {
    clearInterval(backupIntervalId);
    backupIntervalId = null;
    console.log('Backup: Scheduler stopped');
  }
}

// ============================================================================
// Restore (for future use)
// ============================================================================

/**
 * Restore data from a backup
 * Note: This is a destructive operation - it will replace all current data
 *
 * Currently just exports the data for manual inspection.
 * Full restore would require careful handling of WatermelonDB internals.
 */
export async function exportBackupAsJSON(timestamp: number): Promise<string | null> {
  const backup = await getBackup(timestamp);
  if (!backup) return null;

  return JSON.stringify(backup.data, null, 2);
}

// ============================================================================
// Debug Helpers (exposed to window for console access)
// ============================================================================

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).rambleBackup = {
    createBackup,
    getBackups,
    getLatestBackup,
    exportBackupAsJSON,
    clearAllBackups,
    startBackupScheduler,
    stopBackupScheduler,
  };
}
