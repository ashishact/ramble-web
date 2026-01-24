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
const MAX_BACKUPS = 10;

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
  latestDataTimestamp: number;  // Latest timestamp found in the actual data
}

export interface BackupMetadata {
  timestamp: number;
  recordCount: number;
  checksum: string;
  latestDataTimestamp: number;
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

/**
 * Find the latest data timestamp across all records
 * Looks at createdAt, timestamp, startedAt, lastMentioned, etc.
 */
function getLatestDataTimestamp(data: Record<string, unknown[]>): number {
  let latest = 0;

  const timeFields = ['createdAt', 'timestamp', 'startedAt', 'lastMentioned', 'lastReinforced', 'lastReferenced', 'lastUsed'];

  for (const tableName of TABLES_TO_BACKUP) {
    const records = data[tableName] ?? [];
    for (const record of records) {
      const rec = record as Record<string, unknown>;
      for (const field of timeFields) {
        const value = rec[field];
        if (typeof value === 'number' && value > latest) {
          latest = value;
        }
      }
    }
  }

  return latest;
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
          latestDataTimestamp: b.latestDataTimestamp || 0,
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
 * Returns true if backup was created, false if skipped (no changes or data loss detected)
 */
export async function createBackup(force = false): Promise<boolean> {
  // Export all data
  const data = await exportAllData();
  const checksum = calculateChecksum(data);
  const recordCount = TABLES_TO_BACKUP.reduce(
    (sum, t) => sum + (data[t]?.length ?? 0),
    0
  );
  const latestDataTimestamp = getLatestDataTimestamp(data);

  // Get latest backup for comparison
  const latestBackup = await getLatestBackup();

  // SAFETY CHECK: Validate new data against previous backup using TIME + SIZE
  if (latestBackup && !force) {
    const prevTimestamp = latestBackup.latestDataTimestamp || 0;
    const prevCount = latestBackup.recordCount;

    // New data must be NEWER (has more recent timestamps) OR LARGER (has more records)
    const hasNewerData = latestDataTimestamp > prevTimestamp;
    const hasMoreData = recordCount > prevCount;
    const hasSameData = checksum === latestBackup.checksum;

    // If no changes, skip
    if (hasSameData) {
      console.log('Backup: Skipped (no changes detected)');
      return false;
    }

    // If we have LESS data AND OLDER timestamps, refuse - this is data loss
    if (!hasNewerData && !hasMoreData && recordCount < prevCount) {
      console.error(
        `Backup: REFUSED - Data loss detected! ` +
        `Previous: ${prevCount} records (latest: ${new Date(prevTimestamp).toISOString()}), ` +
        `Current: ${recordCount} records (latest: ${new Date(latestDataTimestamp).toISOString()}). ` +
        `New data is neither newer nor larger. Use force=true to override.`
      );
      return false;
    }

    // If we lost significant data (>50%) without newer timestamps, refuse
    if (prevCount > 10 && recordCount < prevCount * 0.5 && !hasNewerData) {
      console.error(
        `Backup: REFUSED - Significant data loss without newer timestamps! ` +
        `Previous: ${prevCount} records, Current: ${recordCount} records. ` +
        `Use force=true to override.`
      );
      return false;
    }
  }

  // Create backup entry
  const backup: BackupEntry = {
    timestamp: Date.now(),
    data,
    checksum,
    recordCount,
    latestDataTimestamp,
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

  console.log(
    `Backup: Created at ${new Date(backup.timestamp).toISOString()} ` +
    `(${recordCount} records, latest data: ${new Date(latestDataTimestamp).toISOString()})`
  );

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
// Restore
// ============================================================================

/**
 * Export backup as JSON string
 */
export async function exportBackupAsJSON(timestamp: number): Promise<string | null> {
  const backup = await getBackup(timestamp);
  if (!backup) return null;

  return JSON.stringify(backup.data, null, 2);
}

/**
 * Get detailed info about a backup for display
 */
export interface BackupInfo {
  timestamp: number;
  dateString: string;
  recordCount: number;
  latestDataTimestamp: number;
  latestDataDateString: string;
  tableCounts: Record<string, number>;
}

export async function getBackupInfo(timestamp: number): Promise<BackupInfo | null> {
  const backup = await getBackup(timestamp);
  if (!backup) return null;

  const tableCounts: Record<string, number> = {};
  for (const table of TABLES_TO_BACKUP) {
    tableCounts[table] = backup.data[table]?.length ?? 0;
  }

  return {
    timestamp: backup.timestamp,
    dateString: new Date(backup.timestamp).toLocaleString(),
    recordCount: backup.recordCount,
    latestDataTimestamp: backup.latestDataTimestamp || 0,
    latestDataDateString: backup.latestDataTimestamp
      ? new Date(backup.latestDataTimestamp).toLocaleString()
      : 'Unknown',
    tableCounts,
  };
}

/**
 * List all backups with their info
 */
export async function listBackups(): Promise<BackupInfo[]> {
  const backups = await getBackups();
  const infos: BackupInfo[] = [];

  for (const b of backups) {
    const info = await getBackupInfo(b.timestamp);
    if (info) infos.push(info);
  }

  return infos;
}

// Restore confirmation callback - set by UI component
let restoreConfirmCallback: ((
  info: BackupInfo,
  onConfirm: () => Promise<void>,
  onCancel: () => void
) => void) | null = null;

/**
 * Register the UI confirmation handler
 */
export function registerRestoreConfirmUI(
  callback: (
    info: BackupInfo,
    onConfirm: () => Promise<void>,
    onCancel: () => void
  ) => void
): void {
  restoreConfirmCallback = callback;
}

/**
 * Perform the actual restore operation
 */
async function performRestore(backup: BackupEntry): Promise<void> {
  console.log('Restore: Starting restore operation...');

  // Clear all existing data and insert from backup
  await database.write(async () => {
    for (const tableName of TABLES_TO_BACKUP) {
      const collection = database.get(tableName);
      const records = backup.data[tableName] ?? [];

      // Delete all existing records
      const existing = await collection.query().fetch();
      for (const record of existing) {
        await record.destroyPermanently();
      }

      console.log(`Restore: Cleared ${existing.length} records from ${tableName}`);

      // Insert records from backup
      for (const recordData of records) {
        const data = recordData as Record<string, unknown>;
        await collection.create((rec) => {
          // Access _raw to set values directly
          const raw = (rec as unknown as { _raw: Record<string, unknown> })._raw;
          // Copy all fields from backup data
          for (const [key, value] of Object.entries(data)) {
            if (key !== '$loki' && key !== 'meta' && key !== '_status' && key !== '_changed') {
              raw[key] = value;
            }
          }
        });
      }

      console.log(`Restore: Inserted ${records.length} records into ${tableName}`);
    }
  });

  console.log('Restore: Complete! Refresh the page to see restored data.');
}

/**
 * Initiate restore from a backup - shows UI confirmation
 * Call from console: rambleBackup.restore() or rambleBackup.restore(timestamp)
 */
export async function initiateRestore(timestamp?: number): Promise<void> {
  // Get available backups
  const backups = await listBackups();

  if (backups.length === 0) {
    console.error('Restore: No backups available');
    return;
  }

  // If no timestamp specified, show available backups
  if (!timestamp) {
    console.log('\n📦 Available Backups:\n');
    backups.forEach((b, i) => {
      console.log(
        `[${i + 1}] ${b.dateString} - ${b.recordCount} records ` +
        `(latest data: ${b.latestDataDateString})`
      );
      console.log(`    Timestamp: ${b.timestamp}`);
      console.log(`    Tables: ${Object.entries(b.tableCounts).map(([t, c]) => `${t}:${c}`).join(', ')}`);
      console.log('');
    });
    console.log('To restore, run: rambleBackup.restore(timestamp)');
    console.log('Example: rambleBackup.restore(' + backups[0].timestamp + ')');
    return;
  }

  // Get the specific backup
  const backup = await getBackup(timestamp);
  if (!backup) {
    console.error(`Restore: Backup with timestamp ${timestamp} not found`);
    return;
  }

  const info = await getBackupInfo(timestamp);
  if (!info) {
    console.error('Restore: Could not get backup info');
    return;
  }

  // Show info in console
  console.log('\n📦 Backup to restore:\n');
  console.log(`  Date: ${info.dateString}`);
  console.log(`  Records: ${info.recordCount}`);
  console.log(`  Latest data: ${info.latestDataDateString}`);
  console.log(`  Tables:`);
  for (const [table, count] of Object.entries(info.tableCounts)) {
    if (count > 0) console.log(`    - ${table}: ${count}`);
  }

  // If UI callback is registered, use it
  if (restoreConfirmCallback) {
    console.log('\n⏳ Waiting for UI confirmation...');

    restoreConfirmCallback(
      info,
      async () => {
        await performRestore(backup);
      },
      () => {
        console.log('Restore: Cancelled by user');
      }
    );
  } else {
    // Fallback to console confirmation
    console.log('\n⚠️  No UI registered. To confirm restore, run:');
    console.log('rambleBackup.confirmRestore(' + timestamp + ')');
  }
}

/**
 * Direct restore without UI (for console use when UI not available)
 */
export async function confirmRestore(timestamp: number): Promise<void> {
  const backup = await getBackup(timestamp);
  if (!backup) {
    console.error(`Restore: Backup with timestamp ${timestamp} not found`);
    return;
  }

  console.log('Restore: Confirmed via console. Starting...');
  await performRestore(backup);
}

// ============================================================================
// Debug Helpers (exposed to window for console access)
// ============================================================================

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).rambleBackup = {
    // Backup operations
    createBackup,
    getBackups,
    getLatestBackup,
    exportBackupAsJSON,
    clearAllBackups,
    startBackupScheduler,
    stopBackupScheduler,
    // Restore operations
    listBackups,
    restore: initiateRestore,
    confirmRestore,
    getBackupInfo,
  };
}
