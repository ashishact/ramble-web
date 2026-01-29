/**
 * Debug Utilities - window.ramble object for testing and debugging
 *
 * Provides convenient functions accessible from browser console:
 *   window.ramble.resetOnboarding()
 *   window.ramble.getUserProfile()
 *   window.ramble.clearAllData()
 *   etc.
 */

import { dataStore } from '../db/stores/dataStore'
import { settingsHelpers } from '../stores/settingsStore'

// Define the ramble debug interface
interface RambleDebug {
  // Onboarding
  resetOnboarding: () => Promise<void>
  getOnboardingStatus: () => Promise<unknown>

  // User Profile
  getUserProfile: () => Promise<unknown>
  clearUserProfile: () => Promise<void>

  // Combined
  clearOnboardingData: () => Promise<void>

  // Settings
  getSettings: () => unknown
  clearApiKeys: () => void

  // Database
  resetDatabase: () => Promise<void>

  // Data store
  getData: (key: string) => Promise<unknown>
  setData: (key: string, type: string, value: unknown) => Promise<void>
  deleteData: (key: string) => Promise<boolean>
}

// Create the ramble debug object
const rambleDebug: RambleDebug = {
  // ============================================================================
  // Onboarding
  // ============================================================================

  async resetOnboarding() {
    await dataStore.resetOnboarding()
    console.log('[ramble] Onboarding reset to initial state')
  },

  async getOnboardingStatus() {
    const status = await dataStore.getOnboarding()
    console.log('[ramble] Onboarding status:', status)
    return status
  },

  // ============================================================================
  // User Profile
  // ============================================================================

  async getUserProfile() {
    const profile = await dataStore.getUserProfile()
    console.log('[ramble] User profile:', profile)
    return profile
  },

  async clearUserProfile() {
    await dataStore.delete('user_profile')
    console.log('[ramble] User profile cleared')
  },

  // ============================================================================
  // Combined (Profile-specific only - does NOT touch global settings/API keys)
  // ============================================================================

  async clearOnboardingData() {
    await dataStore.resetOnboarding()
    await dataStore.delete('user_profile')
    console.log('[ramble] Onboarding data cleared for current profile:')
    console.log('[ramble]   - Onboarding status reset')
    console.log('[ramble]   - User profile deleted')
    console.log('[ramble] Note: API keys and settings are NOT affected (they are global)')
    console.log('[ramble] Reload the page to restart onboarding')
  },

  // ============================================================================
  // Settings
  // ============================================================================

  getSettings() {
    const settings = settingsHelpers.getSettings()
    console.log('[ramble] Settings:', settings)
    return settings
  },

  clearApiKeys() {
    settingsHelpers.setApiKey('gemini', '')
    settingsHelpers.setApiKey('anthropic', '')
    settingsHelpers.setApiKey('openai', '')
    settingsHelpers.setApiKey('groq', '')
    settingsHelpers.setApiKey('deepgram', '')
    console.log('[ramble] All API keys cleared')
  },

  // ============================================================================
  // Database Management
  // ============================================================================

  async resetDatabase() {
    console.log('[ramble] Clearing all IndexedDB databases...')
    const dbs = await indexedDB.databases()
    for (const db of dbs) {
      if (db.name) {
        console.log('[ramble] Deleting:', db.name)
        indexedDB.deleteDatabase(db.name)
      }
    }
    console.log('[ramble] Done! Reloading in 500ms...')
    setTimeout(() => location.reload(), 500)
  },

  // ============================================================================
  // Generic Data Store Access
  // ============================================================================

  async getData(key: string) {
    const data = await dataStore.getValue(key)
    console.log(`[ramble] Data[${key}]:`, data)
    return data
  },

  async setData(key: string, type: string, value: unknown) {
    await dataStore.set(key, type as 'custom', value)
    console.log(`[ramble] Data[${key}] set`)
  },

  async deleteData(key: string) {
    const result = await dataStore.delete(key)
    console.log(`[ramble] Data[${key}] deleted:`, result)
    return result
  },
}

// Attach to window
declare global {
  interface Window {
    ramble: RambleDebug
  }
}

export function initDebugUtils() {
  if (typeof window !== 'undefined') {
    window.ramble = rambleDebug
    console.log('[ramble] Debug utilities loaded. Try: window.ramble.getOnboardingStatus()')
  }
}

// Auto-initialize
initDebugUtils()
