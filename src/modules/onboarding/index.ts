/**
 * Onboarding Module
 *
 * Handles first-time user setup:
 * - API key configuration
 * - User profile collection
 *
 * Usage:
 * ```tsx
 * import { OnboardingFlow, useOnboarding } from './modules/onboarding'
 *
 * // Check if onboarding is needed
 * const { isComplete, isLoading } = useOnboarding()
 *
 * if (!isComplete && !isLoading) {
 *   return <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
 * }
 * ```
 */

// Main component
export { OnboardingFlow } from './OnboardingFlow'

// Hook for checking onboarding status
export { useOnboarding } from './hooks/useOnboarding'

// Step components (for custom flows)
export { ApiKeyStep } from './steps/ApiKeyStep'
export { UserInfoStep } from './steps/UserInfoStep'

// Utilities
export { testGeminiApiKey, validateApiKeyFormat } from './utils/testApiKey'
