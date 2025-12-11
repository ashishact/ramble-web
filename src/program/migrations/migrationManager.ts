/**
 * Migration Manager
 *
 * Handles database schema migrations with versioning
 */

import type { ProgramStoreInstance } from '../store';
import type { Migration, MigrationResult, MigrationStatus, MigrationRecord } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('Migration');

const MIGRATION_STORAGE_KEY = 'ramble_migrations';

export class MigrationManager {
  private store: ProgramStoreInstance;
  private migrations: Migration[] = [];

  constructor(store: ProgramStoreInstance) {
    this.store = store;
  }

  /**
   * Register a migration
   */
  registerMigration(migration: Migration): void {
    // Check for duplicate version
    if (this.migrations.some(m => m.version === migration.version)) {
      throw new Error(`Migration version ${migration.version} already registered`);
    }

    this.migrations.push(migration);
    // Keep sorted by version
    this.migrations.sort((a, b) => a.version - b.version);

    logger.debug('Registered migration', {
      version: migration.version,
      name: migration.name,
    });
  }

  /**
   * Get current migration status
   */
  getStatus(): MigrationStatus {
    const appliedMigrations = this.getAppliedMigrations();
    const currentVersion = appliedMigrations.length > 0
      ? Math.max(...appliedMigrations.map(m => m.version))
      : 0;

    const appliedVersions = new Set(appliedMigrations.map(m => m.version));
    const pendingMigrations = this.migrations.filter(m => !appliedVersions.has(m.version));

    return {
      currentVersion,
      availableMigrations: this.migrations,
      pendingMigrations,
      appliedMigrations: appliedMigrations.map(m => m.version),
    };
  }

  /**
   * Run a specific migration
   */
  async runMigration(version: number): Promise<MigrationResult> {
    const migration = this.migrations.find(m => m.version === version);
    if (!migration) {
      return {
        success: false,
        itemsAffected: 0,
        errors: [`Migration version ${version} not found`],
      };
    }

    // Check if already applied
    const appliedMigrations = this.getAppliedMigrations();
    if (appliedMigrations.some(m => m.version === version)) {
      return {
        success: false,
        itemsAffected: 0,
        errors: [`Migration ${version} already applied`],
      };
    }

    logger.info('Running migration', {
      version: migration.version,
      name: migration.name,
    });

    try {
      const result = await migration.up(this.store);

      if (result.success) {
        // Record migration as applied
        this.recordMigration({
          version: migration.version,
          appliedAt: Date.now(),
          name: migration.name,
        });

        logger.info('Migration completed successfully', {
          version: migration.version,
          itemsAffected: result.itemsAffected,
        });
      } else {
        logger.error('Migration failed', {
          version: migration.version,
          errors: result.errors,
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Migration threw exception', {
        version: migration.version,
        error: errorMessage,
      });

      return {
        success: false,
        itemsAffected: 0,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Run all pending migrations
   */
  async runAllPending(): Promise<MigrationResult[]> {
    const status = this.getStatus();
    const results: MigrationResult[] = [];

    for (const migration of status.pendingMigrations) {
      const result = await this.runMigration(migration.version);
      results.push(result);

      // Stop on first failure
      if (!result.success) {
        logger.warn('Stopping migrations due to failure', {
          failedVersion: migration.version,
        });
        break;
      }
    }

    return results;
  }

  /**
   * Rollback a migration (if down migration exists)
   */
  async rollbackMigration(version: number): Promise<MigrationResult> {
    const migration = this.migrations.find(m => m.version === version);
    if (!migration) {
      return {
        success: false,
        itemsAffected: 0,
        errors: [`Migration version ${version} not found`],
      };
    }

    if (!migration.down) {
      return {
        success: false,
        itemsAffected: 0,
        errors: [`Migration ${version} does not support rollback`],
      };
    }

    // Check if migration was applied
    const appliedMigrations = this.getAppliedMigrations();
    if (!appliedMigrations.some(m => m.version === version)) {
      return {
        success: false,
        itemsAffected: 0,
        errors: [`Migration ${version} was not applied`],
      };
    }

    logger.info('Rolling back migration', {
      version: migration.version,
      name: migration.name,
    });

    try {
      const result = await migration.down(this.store);

      if (result.success) {
        // Remove migration record
        this.removeMigrationRecord(version);

        logger.info('Migration rollback completed', {
          version: migration.version,
          itemsAffected: result.itemsAffected,
        });
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Migration rollback threw exception', {
        version: migration.version,
        error: errorMessage,
      });

      return {
        success: false,
        itemsAffected: 0,
        errors: [errorMessage],
      };
    }
  }

  /**
   * Get list of applied migrations from localStorage
   */
  private getAppliedMigrations(): MigrationRecord[] {
    try {
      const stored = localStorage.getItem(MIGRATION_STORAGE_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      logger.error('Failed to read migration records', { error });
    }
    return [];
  }

  /**
   * Record a migration as applied
   */
  private recordMigration(record: MigrationRecord): void {
    const applied = this.getAppliedMigrations();
    applied.push(record);
    localStorage.setItem(MIGRATION_STORAGE_KEY, JSON.stringify(applied));
  }

  /**
   * Remove a migration record
   */
  private removeMigrationRecord(version: number): void {
    const applied = this.getAppliedMigrations();
    const filtered = applied.filter(m => m.version !== version);
    localStorage.setItem(MIGRATION_STORAGE_KEY, JSON.stringify(filtered));
  }

  /**
   * Clear all migration records (for testing)
   */
  clearMigrationRecords(): void {
    localStorage.removeItem(MIGRATION_STORAGE_KEY);
    logger.warn('Cleared all migration records');
  }
}

export function createMigrationManager(store: ProgramStoreInstance): MigrationManager {
  return new MigrationManager(store);
}
