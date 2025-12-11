/**
 * Migration Panel
 *
 * UI for viewing database status and running data migrations.
 *
 * Displays two types of migration info:
 * 1. WatermelonDB Schema Version - automatically managed by WatermelonDB
 * 2. Application Data Migrations - manually run data transformations
 */

import { useState, useEffect } from 'react';
import type { MigrationStatus, MigrationResult } from '../program/migrations';
import { schema } from '../db/schema';

interface MigrationPanelProps {
  getMigrationStatus: () => MigrationStatus;
  runMigration: (version: number) => Promise<MigrationResult>;
  runAllPending: () => Promise<MigrationResult[]>;
}

export function MigrationPanel({ getMigrationStatus, runMigration, runAllPending }: MigrationPanelProps) {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [kernelReady, setKernelReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<MigrationResult | null>(null);

  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = () => {
    try {
      const migrationStatus = getMigrationStatus();
      setStatus(migrationStatus);
      setKernelReady(true);
    } catch (error) {
      // Kernel not initialized yet - this is fine
      console.debug('Migration panel: Kernel not initialized yet');
      setStatus(null);
      setKernelReady(false);
    }
  };

  const handleRunMigration = async (version: number) => {
    setRunning(true);
    setLastResult(null);

    try {
      const result = await runMigration(version);
      setLastResult(result);
      refreshStatus();
    } catch (error) {
      setLastResult({
        success: false,
        itemsAffected: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setRunning(false);
    }
  };

  const handleRunAllPending = async () => {
    setRunning(true);
    setLastResult(null);

    try {
      const results = await runAllPending();
      // Show combined result
      const totalAffected = results.reduce((sum, r) => sum + r.itemsAffected, 0);
      const allErrors = results.flatMap(r => r.errors);
      const allSuccess = results.every(r => r.success);

      setLastResult({
        success: allSuccess,
        itemsAffected: totalAffected,
        errors: allErrors,
        details: { migrationsRun: results.length },
      });
      refreshStatus();
    } catch (error) {
      setLastResult({
        success: false,
        itemsAffected: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* WatermelonDB Schema Version - Always shown */}
      <div className="card bg-base-200">
        <div className="card-body p-4">
          <h3 className="font-bold text-sm mb-2">Database Schema</h3>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">WatermelonDB schema version:</span>
              <span className="badge badge-primary badge-lg font-mono font-bold">
                v{schema.version}
              </span>
            </div>
            <div className="badge badge-success badge-sm">Active</div>
          </div>
          <p className="text-xs opacity-50 mt-2">
            Schema migrations are applied automatically when the database opens.
            See src/db/migrations.ts for schema change history.
          </p>
        </div>
      </div>

      {/* Application Data Migrations - Requires kernel */}
      <div>
        <h3 className="font-bold text-sm mb-3">Application Data Migrations</h3>

        {!kernelReady ? (
          <div className="alert alert-info">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <div>
              <h4 className="font-bold">Kernel Not Initialized</h4>
              <p className="text-sm">Start a session on the main page to initialize the kernel and view application migrations.</p>
            </div>
          </div>
        ) : status ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm opacity-70">App migration version:</span>
                <span className="badge badge-lg font-mono font-bold">v{status.currentVersion}</span>
              </div>
              {status.pendingMigrations.length > 0 && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleRunAllPending}
                  disabled={running}
                >
                  {running ? (
                    <>
                      <span className="loading loading-spinner loading-xs"></span>
                      Running...
                    </>
                  ) : (
                    `Run All Pending (${status.pendingMigrations.length})`
                  )}
                </button>
              )}
            </div>

            {/* Result Display */}
            {lastResult && (
              <div
                className={`alert mb-3 ${
                  lastResult.success ? 'alert-success' : 'alert-error'
                }`}
              >
                <div className="flex-1">
                  <h4 className="font-bold">
                    {lastResult.success ? 'Migration Complete' : 'Migration Failed'}
                  </h4>
                  <p className="text-sm">
                    {lastResult.itemsAffected} items affected
                  </p>
                  {lastResult.errors.length > 0 && (
                    <ul className="text-xs mt-2 list-disc list-inside">
                      {lastResult.errors.map((error, i) => (
                        <li key={i}>{error}</li>
                      ))}
                    </ul>
                  )}
                  {lastResult.details && (
                    <pre className="text-xs mt-2 opacity-70">
                      {JSON.stringify(lastResult.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            )}

            {/* Pending Migrations */}
            {status.pendingMigrations.length > 0 ? (
              <div className="mb-4">
                <h4 className="font-bold text-xs mb-2 text-warning">
                  Pending Migrations ({status.pendingMigrations.length})
                </h4>
                <div className="space-y-2">
                  {status.pendingMigrations.map((migration) => (
                    <div
                      key={migration.version}
                      className="card bg-warning/10 border border-warning/30"
                    >
                      <div className="card-body p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="badge badge-warning badge-sm">
                                v{migration.version}
                              </span>
                              <span className="font-mono text-sm font-bold">
                                {migration.name}
                              </span>
                            </div>
                            <p className="text-xs mt-1 opacity-70">
                              {migration.description}
                            </p>
                          </div>
                          <button
                            className="btn btn-warning btn-xs"
                            onClick={() => handleRunMigration(migration.version)}
                            disabled={running}
                          >
                            Run
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="alert alert-success mb-4">
                <div>
                  <h4 className="font-bold">All Migrations Applied</h4>
                  <p className="text-sm">No pending data migrations</p>
                </div>
              </div>
            )}

            {/* Applied Migrations */}
            {status.appliedMigrations.length > 0 && (
              <div>
                <h4 className="font-bold text-xs mb-2">
                  Applied Migrations ({status.appliedMigrations.length})
                </h4>
                <div className="space-y-1">
                  {status.availableMigrations
                    .filter(m => status.appliedMigrations.includes(m.version))
                    .map((migration) => (
                      <div
                        key={migration.version}
                        className="flex items-center gap-2 p-2 bg-base-200 rounded text-sm"
                      >
                        <span className="badge badge-success badge-xs">
                          ✓
                        </span>
                        <span className="badge badge-ghost badge-xs">
                          v{migration.version}
                        </span>
                        <span className="font-mono flex-1">
                          {migration.name}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="alert">
            <span className="loading loading-spinner loading-sm"></span>
            <span>Loading migration status...</span>
          </div>
        )}
      </div>
    </div>
  );
}
