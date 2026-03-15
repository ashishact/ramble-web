/**
 * DataStore — Profile-scoped key-value store for app settings
 *
 * Backed by profileStorage (localStorage namespaced by profile).
 * Instantly available on page load — no async DB initialization needed.
 *
 * Stores:
 * - Onboarding status and progress
 * - User profile information
 * - App preferences
 */

import { profileStorage } from '../../lib/profileStorage'

// ============================================================================
// Types
// ============================================================================

export type DataType = 'onboarding' | 'user_profile' | 'system' | 'feature' | 'custom'

export interface OnboardingData {
  status: 'not_started' | 'in_progress' | 'completed'
  currentStep: number
  totalSteps: number
  startedAt?: number
  completedAt?: number
  stepsCompleted: {
    apiKey?: boolean
    userInfo?: boolean
  }
}

export interface UserProfileData {
  name: string
  aboutMe?: string
  collectedAt: number
}

// Default onboarding state
const DEFAULT_ONBOARDING: OnboardingData = {
  status: 'not_started',
  currentStep: 0,
  totalSteps: 2,
  stepsCompleted: {},
}

// Key prefix to avoid collisions with other profileStorage users
const PREFIX = 'data:'

// ============================================================================
// Store
// ============================================================================

export const dataStore = {
  // ── Generic CRUD ──────────────────────────────────────────────────────

  get(key: string): { key: string; value: string; createdAt: number } | null {
    const raw = profileStorage.getItem(`${PREFIX}${key}`)
    if (!raw) return null
    try {
      const record = JSON.parse(raw) as { key: string; value: string; createdAt: number }
      return record
    } catch {
      return null
    }
  },

  getValue<T = unknown>(key: string): T | null {
    const record = this.get(key)
    if (!record) return null
    try {
      return JSON.parse(record.value) as T
    } catch {
      return null
    }
  },

  set(key: string, _type: DataType, value: unknown): void {
    const now = Date.now()
    const existing = this.get(key)
    const record = {
      key,
      value: JSON.stringify(value),
      createdAt: existing?.createdAt ?? now,
    }
    profileStorage.setItem(`${PREFIX}${key}`, JSON.stringify(record))
  },

  delete(key: string): boolean {
    const exists = profileStorage.hasItem(`${PREFIX}${key}`)
    if (!exists) return false
    profileStorage.removeItem(`${PREFIX}${key}`)
    return true
  },

  // ── Onboarding ────────────────────────────────────────────────────────

  getOnboarding(): OnboardingData {
    const data = this.getValue<OnboardingData>('onboarding')
    return data ?? DEFAULT_ONBOARDING
  },

  setOnboarding(data: Partial<OnboardingData>): void {
    const current = this.getOnboarding()
    this.set('onboarding', 'onboarding', { ...current, ...data })
  },

  isOnboardingComplete(): boolean {
    const data = this.getOnboarding()
    return data.status === 'completed'
  },

  startOnboarding(): void {
    this.setOnboarding({
      status: 'in_progress',
      currentStep: 0,
      startedAt: Date.now(),
    })
  },

  completeOnboardingStep(step: keyof OnboardingData['stepsCompleted']): void {
    const current = this.getOnboarding()
    this.setOnboarding({
      stepsCompleted: {
        ...current.stepsCompleted,
        [step]: true,
      },
      currentStep: current.currentStep + 1,
    })
  },

  completeOnboarding(): void {
    this.setOnboarding({
      status: 'completed',
      completedAt: Date.now(),
    })
  },

  resetOnboarding(): void {
    this.set('onboarding', 'onboarding', DEFAULT_ONBOARDING)
  },

  // ── User Profile ──────────────────────────────────────────────────────

  getUserProfile(): UserProfileData | null {
    return this.getValue<UserProfileData>('user_profile')
  },

  setUserProfile(profile: UserProfileData): void {
    this.set('user_profile', 'user_profile', profile)
  },

  hasUserProfile(): boolean {
    const profile = this.getUserProfile()
    return profile !== null && !!profile.name
  },
}
