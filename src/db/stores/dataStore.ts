/**
 * Data Store - CRUD operations for flexible key-value storage
 *
 * Provides type-safe access to the data table for:
 * - Onboarding status and progress
 * - User profile information
 * - App preferences
 * - Feature flags
 */

import { Q } from '@nozbe/watermelondb'
import { database } from '../database'
import Data, {
  type DataType,
  type OnboardingData,
  type UserProfileData,
} from '../models/Data'

const dataCollection = database.get<Data>('data')

// Default onboarding state
const DEFAULT_ONBOARDING: OnboardingData = {
  status: 'not_started',
  currentStep: 0,
  totalSteps: 2, // Step 1: API key, Step 2: User info
  stepsCompleted: {},
}

export const dataStore = {
  // ============================================================================
  // Generic CRUD
  // ============================================================================

  async get(key: string): Promise<Data | null> {
    const results = await dataCollection
      .query(Q.where('key', key), Q.take(1))
      .fetch()
    return results[0] ?? null
  },

  async getValue<T = unknown>(key: string): Promise<T | null> {
    const record = await this.get(key)
    if (!record) return null
    try {
      return JSON.parse(record.value) as T
    } catch {
      return null
    }
  },

  async set(key: string, type: DataType, value: unknown): Promise<Data> {
    const now = Date.now()
    const valueJson = JSON.stringify(value)

    // Delete existing if present (avoids update validation issues)
    const existing = await this.get(key)
    const originalCreatedAt = existing?.createdAt ?? now

    if (existing) {
      await database.write(async () => {
        await existing.destroyPermanently()
      })
    }

    // Create new
    return await database.write(async () => {
      return await dataCollection.create((d) => {
        d.key = key
        d.dataType = type
        d.value = valueJson
        d.createdAt = originalCreatedAt
        d.updatedAt = now
      })
    })
  },

  async delete(key: string): Promise<boolean> {
    const record = await this.get(key)
    if (!record) return false

    await database.write(async () => {
      await record.destroyPermanently()
    })
    return true
  },

  async getByType(type: DataType): Promise<Data[]> {
    return await dataCollection
      .query(Q.where('dataType', type))
      .fetch()
  },

  // ============================================================================
  // Onboarding-specific helpers
  // ============================================================================

  async getOnboarding(): Promise<OnboardingData> {
    const data = await this.getValue<OnboardingData>('onboarding')
    return data ?? DEFAULT_ONBOARDING
  },

  async setOnboarding(data: Partial<OnboardingData>): Promise<void> {
    const current = await this.getOnboarding()
    await this.set('onboarding', 'onboarding', { ...current, ...data })
  },

  async isOnboardingComplete(): Promise<boolean> {
    const data = await this.getOnboarding()
    return data.status === 'completed'
  },

  async startOnboarding(): Promise<void> {
    await this.setOnboarding({
      status: 'in_progress',
      currentStep: 0,
      startedAt: Date.now(),
    })
  },

  async completeOnboardingStep(step: keyof OnboardingData['stepsCompleted']): Promise<void> {
    const current = await this.getOnboarding()
    await this.setOnboarding({
      stepsCompleted: {
        ...current.stepsCompleted,
        [step]: true,
      },
      currentStep: current.currentStep + 1,
    })
  },

  async completeOnboarding(): Promise<void> {
    await this.setOnboarding({
      status: 'completed',
      completedAt: Date.now(),
    })
  },

  async resetOnboarding(): Promise<void> {
    await this.set('onboarding', 'onboarding', DEFAULT_ONBOARDING)
  },

  // ============================================================================
  // User Profile-specific helpers
  // ============================================================================

  async getUserProfile(): Promise<UserProfileData | null> {
    return await this.getValue<UserProfileData>('user_profile')
  },

  async setUserProfile(profile: UserProfileData): Promise<void> {
    await this.set('user_profile', 'user_profile', profile)
  },

  async hasUserProfile(): Promise<boolean> {
    const profile = await this.getUserProfile()
    return profile !== null && !!profile.name
  },
}
