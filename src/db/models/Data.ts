/**
 * Data - Flexible key-value storage for app data
 *
 * Designed to store various types of app data without frequent migrations:
 * - Onboarding status and progress
 * - User profile information
 * - App preferences that don't fit in localStorage
 * - Feature flags and experiments
 *
 * Each record has:
 * - key: Unique identifier (e.g., "onboarding", "user_profile")
 * - dataType: Category for organization (e.g., "system", "user", "feature")
 * - value: JSON string containing the actual data
 */

import { Model } from '@nozbe/watermelondb'
import { field } from '@nozbe/watermelondb/decorators'

// Well-known data types
export type DataType = 'onboarding' | 'user_profile' | 'system' | 'feature' | 'custom'

// Onboarding data structure
export interface OnboardingData {
  status: 'not_started' | 'in_progress' | 'completed'
  currentStep: number
  totalSteps: number
  startedAt?: number
  completedAt?: number
  // Track which steps are done
  stepsCompleted: {
    apiKey?: boolean
    userInfo?: boolean
  }
}

// User profile data structure
export interface UserProfileData {
  name: string
  aboutMe?: string
  collectedAt: number
}

export default class Data extends Model {
  static table = 'data'

  /** Unique key identifier (e.g., "onboarding", "user_profile") */
  @field('key') key!: string

  /** Category type for organization */
  @field('dataType') dataType!: DataType

  /** JSON string containing the actual data */
  @field('value') value!: string

  @field('createdAt') createdAt!: number

  @field('updatedAt') updatedAt!: number

  // Parsed value getter
  get valueParsed(): unknown {
    try {
      return JSON.parse(this.value)
    } catch {
      return null
    }
  }

  // Type-safe getters for known data types
  get asOnboarding(): OnboardingData | null {
    if (this.key !== 'onboarding') return null
    return this.valueParsed as OnboardingData | null
  }

  get asUserProfile(): UserProfileData | null {
    if (this.key !== 'user_profile') return null
    return this.valueParsed as UserProfileData | null
  }
}
