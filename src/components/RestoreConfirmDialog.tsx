/**
 * RestoreConfirmDialog - UI confirmation for backup restore
 *
 * Triggered from console via rambleBackup.restore(timestamp)
 * Shows backup details and confirms before restoring.
 */

import { useState, useEffect, useCallback } from 'react';
import { registerRestoreConfirmUI, type BackupInfo } from '../db/backup';
import { Database, AlertTriangle, Check, X } from 'lucide-react';

interface PendingRestore {
  info: BackupInfo;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export function RestoreConfirmDialog() {
  const [pending, setPending] = useState<PendingRestore | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  // Register the UI callback on mount
  useEffect(() => {
    registerRestoreConfirmUI((info, onConfirm, onCancel) => {
      setPending({ info, onConfirm, onCancel });
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!pending) return;

    setIsRestoring(true);
    try {
      await pending.onConfirm();
      // Show success briefly then close
      setTimeout(() => {
        setPending(null);
        setIsRestoring(false);
        // Reload to show restored data
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Restore failed:', error);
      setIsRestoring(false);
    }
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.onCancel();
    setPending(null);
  }, [pending]);

  if (!pending) return null;

  const { info } = pending;

  // Filter to only tables with data
  const tablesWithData = Object.entries(info.tableCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Database size={20} className="text-amber-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-800">Restore from Backup</h2>
            <p className="text-xs text-slate-500">This will replace all current data</p>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Warning */}
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg">
            <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700">
              <strong>Warning:</strong> This will permanently replace all current data with the backup.
              This cannot be undone.
            </div>
          </div>

          {/* Backup Info */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Backup Date:</span>
              <span className="font-medium text-slate-700">{info.dateString}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Total Records:</span>
              <span className="font-medium text-slate-700">{info.recordCount}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Latest Data:</span>
              <span className="font-medium text-slate-700">{info.latestDataDateString}</span>
            </div>
          </div>

          {/* Table breakdown */}
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-medium text-slate-500 mb-2">Data to restore:</div>
            <div className="grid grid-cols-2 gap-1">
              {tablesWithData.map(([table, count]) => (
                <div key={table} className="flex justify-between text-xs px-2 py-1 bg-slate-50 rounded">
                  <span className="text-slate-600">{table}</span>
                  <span className="font-medium text-slate-700">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={handleCancel}
            disabled={isRestoring}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
          >
            <X size={16} className="inline mr-1" />
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isRestoring}
            className="px-4 py-2 text-sm bg-amber-500 text-white hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1"
          >
            {isRestoring ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Restoring...
              </>
            ) : (
              <>
                <Check size={16} />
                Restore Backup
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
