/**
 * useOnboarding Hook
 *
 * Manages onboarding state and navigation between steps
 */

import { useState, useEffect, useCallback } from 'react'
import { dataStore } from '../../../db/stores'
import type { OnboardingData, UserProfileData } from '../../../db/models/Data'
import { settingsHelpers } from '../../../stores/settingsStore'

export type OnboardingStep = 'api_key' | 'user_info' | 'complete'

interface UseOnboardingReturn {
  // State
  isLoading: boolean
  currentStep: OnboardingStep
  onboardingData: OnboardingData | null
  userProfile: UserProfileData | null

  // Checks
  hasApiKey: boolean
  hasUserProfile: boolean
  isComplete: boolean

  // Actions
  goToStep: (step: OnboardingStep) => void
  completeApiKeyStep: () => Promise<void>
  completeUserInfoStep: (profile: UserProfileData) => Promise<void>
  finishOnboarding: () => Promise<void>
  resetOnboarding: () => Promise<void>
}

export function useOnboarding(): UseOnboardingReturn {
  const [isLoading, setIsLoading] = useState(true)
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(null)
  const [userProfile, setUserProfile] = useState<UserProfileData | null>(null)
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('api_key')

  // Check if API key exists
  const hasApiKey = settingsHelpers.isProviderConfigured('gemini')

  // Check if user profile exists
  const hasUserProfile = userProfile !== null && !!userProfile.name

  // Check if onboarding is complete
  const isComplete = onboardingData?.status === 'completed'

  // Load initial state
  useEffect(() => {
    async function loadState() {
      setIsLoading(true)
      try {
        const [onboarding, profile] = await Promise.all([
          dataStore.getOnboarding(),
          dataStore.getUserProfile(),
        ])

        setOnboardingData(onboarding)
        setUserProfile(profile)

        // Determine current step based on progress
        if (onboarding.status === 'completed') {
          setCurrentStep('complete')
        } else if (onboarding.stepsCompleted.apiKey || hasApiKey) {
          setCurrentStep('user_info')
        } else {
          setCurrentStep('api_key')
        }
      } catch (error) {
        console.error('Failed to load onboarding state:', error)
      } finally {
        setIsLoading(false)
      }
    }

    loadState()
  }, [hasApiKey])

  // Go to a specific step
  const goToStep = useCallback((step: OnboardingStep) => {
    setCurrentStep(step)
  }, [])

  // Complete the API key step
  const completeApiKeyStep = useCallback(async () => {
    await dataStore.completeOnboardingStep('apiKey')
    const updated = await dataStore.getOnboarding()
    setOnboardingData(updated)
    setCurrentStep('user_info')
  }, [])

  // Complete the user info step
  const completeUserInfoStep = useCallback(async (profile: UserProfileData) => {
    await dataStore.setUserProfile(profile)
    await dataStore.completeOnboardingStep('userInfo')
    setUserProfile(profile)
    const updated = await dataStore.getOnboarding()
    setOnboardingData(updated)
    setCurrentStep('complete')
  }, [])

  // Finish onboarding
  const finishOnboarding = useCallback(async () => {
    await dataStore.completeOnboarding()
    const updated = await dataStore.getOnboarding()
    setOnboardingData(updated)
  }, [])

  // Reset onboarding (for testing/debugging)
  const resetOnboarding = useCallback(async () => {
    await dataStore.resetOnboarding()
    await dataStore.delete('user_profile')
    const updated = await dataStore.getOnboarding()
    setOnboardingData(updated)
    setUserProfile(null)
    setCurrentStep('api_key')
  }, [])

  return {
    isLoading,
    currentStep,
    onboardingData,
    userProfile,
    hasApiKey,
    hasUserProfile,
    isComplete,
    goToStep,
    completeApiKeyStep,
    completeUserInfoStep,
    finishOnboarding,
    resetOnboarding,
  }
}
