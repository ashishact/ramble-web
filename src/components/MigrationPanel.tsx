/**
 * Migration Panel
 *
 * UI for running database migrations
 */

import { useState, useEffect } from 'react';
import type { MigrationStatus, MigrationResult } from '../program/migrations';

interface MigrationPanelProps {
  getMigrationStatus: () => MigrationStatus;
  runMigration: (version: number) => Promise<MigrationResult>;
  runAllPending: () => Promise<MigrationResult[]>;
}

export function MigrationPanel({ getMigrationStatus, runMigration, runAllPending }: MigrationPanelProps) {
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<MigrationResult | null>(null);

  useEffect(() => {
    refreshStatus();
  }, []);

  const refreshStatus = () => {
    setStatus(getMigrationStatus());
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

  if (!status) {
    return (
      <div className="p-4">
        <span className="loading loading-spinner loading-sm"></span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm opacity-70">Current version:</span>
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
          className={`alert ${
            lastResult.success ? 'alert-success' : 'alert-error'
          }`}
        >
          <div className="flex-1">
            <h3 className="font-bold">
              {lastResult.success ? '✓ Migration Complete' : '✗ Migration Failed'}
            </h3>
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
        <div>
          <h3 className="font-bold text-sm mb-2 text-warning">
            Pending Migrations ({status.pendingMigrations.length})
          </h3>
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
        <div className="alert alert-success">
          <div>
            <h3 className="font-bold">✓ Database Up to Date</h3>
            <p className="text-sm">No pending migrations</p>
          </div>
        </div>
      )}

      {/* Applied Migrations */}
      {status.appliedMigrations.length > 0 && (
        <div>
          <h3 className="font-bold text-sm mb-2">
            Applied Migrations ({status.appliedMigrations.length})
          </h3>
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
    </div>
  );
}
