/**
 * ProfileMenu — Compact avatar + dropdown for auth & backup management.
 *
 * When authenticated: 24px circular avatar (first letter of email).
 * Click opens dropdown with email, backup config, and sign out.
 *
 * When not authenticated: "Sign up for more" sparkles button.
 */

import React, { useState, useEffect, useRef, useCallback, useSyncExternalStore } from 'react'
import { Sparkles, LogOut, HardDrive, FolderOpen, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { authStore } from '../../stores/authStore'
import { SignupModal } from './SignupModal'
import {
  getBackupConfig,
  pickBackupFolder,
  performBackup,
  isBackupInProgress,
  type BackupConfig,
} from '../../graph/backup'
import { getCurrentProfile } from '../../lib/profile'

// ── Relative time helper ────────────────────────────────────────────

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ── Component ───────────────────────────────────────────────────────

export const ProfileMenu: React.FC = () => {
  const authState = useSyncExternalStore(authStore.subscribe, authStore.getState)
  const [showSignup, setShowSignup] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [backupConfig, setBackupConfig] = useState<BackupConfig | null>(null)
  const [backing, setBacking] = useState(false)
  const [backupError, setBackupError] = useState<string | null>(null)
  const [backupSuccess, setBackupSuccess] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Reload backup config whenever dropdown opens
  useEffect(() => {
    if (isOpen) {
      setBackupConfig(getBackupConfig())
      setBacking(isBackupInProgress())
      setBackupError(null)
      setBackupSuccess(false)
    }
  }, [isOpen])

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen])

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen])

  const handlePickFolder = useCallback(async () => {
    try {
      const folderName = await pickBackupFolder()
      if (folderName) {
        setBackupConfig(getBackupConfig())
      }
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Failed to pick folder')
    }
  }, [])

  const handleBackupNow = useCallback(async () => {
    setBacking(true)
    setBackupError(null)
    setBackupSuccess(false)
    try {
      const profile = getCurrentProfile()
      await performBackup(profile)
      setBackupConfig(getBackupConfig())
      setBackupSuccess(true)
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Backup failed')
    } finally {
      setBacking(false)
    }
  }, [])

  // ── Not authenticated ──────────────────────────────────────────────

  if (!authState.isAuthenticated) {
    return (
      <>
        <button
          onClick={() => setShowSignup(true)}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 rounded transition-colors flex-shrink-0"
        >
          <Sparkles size={10} />
          Sign up for more
        </button>
        <SignupModal isOpen={showSignup} onClose={() => setShowSignup(false)} />
      </>
    )
  }

  // ── Authenticated ──────────────────────────────────────────────────

  const email = authState.email || ''
  const initial = email.charAt(0).toUpperCase()
  const profile = getCurrentProfile()
  const profileBackup = backupConfig?.profiles[profile]

  return (
    <div ref={containerRef} className="relative flex-shrink-0">
      {/* Avatar button */}
      <button
        onClick={() => setIsOpen(v => !v)}
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-colors ${
          isOpen
            ? 'bg-primary/25 text-primary'
            : 'bg-primary/15 text-primary hover:bg-primary/25'
        }`}
        title={email}
      >
        {initial}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-[9999] w-64 bg-white border border-slate-200 rounded-lg shadow-xl animate-in fade-in zoom-in-95 duration-150">
          {/* Header */}
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="text-xs font-medium text-slate-700 truncate">{email}</div>
            <div className="text-[10px] text-slate-400">{profile}</div>
          </div>

          {/* Backup section */}
          <div className="px-3 py-2 border-b border-slate-100">
            <div className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">Backup</div>

            {backupConfig?.folderName ? (
              <div className="space-y-1.5">
                {/* Folder info */}
                <div className="flex items-center gap-1.5">
                  <FolderOpen size={11} className="text-green-500 flex-shrink-0" />
                  <span className="text-xs text-slate-600 truncate">{backupConfig.folderName}</span>
                </div>

                {/* Last backup time */}
                {profileBackup?.lastBackupAt ? (
                  <div className="text-[10px] text-slate-400 pl-[17px]">
                    Last backup: {timeAgo(profileBackup.lastBackupAt)}
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 pl-[17px]">
                    No backups yet for this profile
                  </div>
                )}

                {/* Status indicators */}
                {backing && (
                  <div className="flex items-center gap-1.5 pl-[17px]">
                    <Loader2 size={10} className="animate-spin text-primary" />
                    <span className="text-[10px] text-primary">Backing up...</span>
                  </div>
                )}
                {backupSuccess && (
                  <div className="flex items-center gap-1.5 pl-[17px]">
                    <CheckCircle2 size={10} className="text-green-500" />
                    <span className="text-[10px] text-green-600">Backup complete</span>
                  </div>
                )}
                {backupError && (
                  <div className="flex items-center gap-1.5 pl-[17px]">
                    <AlertCircle size={10} className="text-red-500" />
                    <span className="text-[10px] text-red-500 truncate" title={backupError}>{backupError}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1 pt-0.5">
                  <button
                    onClick={handleBackupNow}
                    disabled={backing}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50 rounded transition-colors disabled:opacity-40"
                  >
                    <HardDrive size={10} />
                    Backup now
                  </button>
                  <button
                    onClick={handlePickFolder}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors"
                  >
                    Change folder
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handlePickFolder}
                className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded transition-colors w-full"
              >
                <HardDrive size={12} className="text-slate-400" />
                Set up backup folder
              </button>
            )}
          </div>

          {/* Sign out */}
          <div className="p-1">
            <button
              onClick={() => {
                authStore.clearTokens()
                setIsOpen(false)
              }}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-600 hover:bg-slate-50 rounded transition-colors"
            >
              <LogOut size={11} />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
