/**
 * Migration System Types
 *
 * Versioned database migrations with UI controls
 */

export interface Migration {
  version: number;
  name: string;
  description: string;
  up: (store: any) => Promise<MigrationResult>;
  down?: (store: any) => Promise<MigrationResult>;
}

export interface MigrationResult {
  success: boolean;
  itemsAffected: number;
  errors: string[];
  details?: Record<string, any>;
}

export interface MigrationStatus {
  currentVersion: number;
  availableMigrations: Migration[];
  pendingMigrations: Migration[];
  appliedMigrations: number[];
}

export interface MigrationRecord {
  version: number;
  appliedAt: number;
  name: string;
}
