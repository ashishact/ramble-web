/**
 * OnboardingFlow - Main onboarding component
 *
 * A clean, modern onboarding experience with:
 * - Elegant full-screen design
 * - Subtle step indicators
 * - Smooth transitions
 */

import { useEffect } from 'react'
import { Loader2, Sparkles, ArrowRight } from 'lucide-react'
import { useOnboarding } from './hooks/useOnboarding'
import { ApiKeyStep } from './steps/ApiKeyStep'
import { UserInfoStep } from './steps/UserInfoStep'

interface OnboardingFlowProps {
  onComplete: () => void
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const {
    isLoading,
    currentStep,
    userProfile,
    hasApiKey,
    isComplete,
    completeApiKeyStep,
    completeUserInfoStep,
    finishOnboarding,
  } = useOnboarding()

  useEffect(() => {
    if (isComplete) {
      onComplete()
    }
  }, [isComplete, onComplete])

  // Loading state
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-base-100 via-base-100 to-base-200 flex items-center justify-center z-50">
        <div className="text-center space-y-4">
          <div className="relative">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-secondary/20 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  const stepNumber = currentStep === 'api_key' ? 1 : currentStep === 'user_info' ? 2 : 2

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-base-100 via-base-100 to-base-200 z-50 overflow-auto">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-secondary/5 rounded-full blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative min-h-full flex flex-col">
        {/* Minimal header with step indicator */}
        <header className="p-6">
          <div className="max-w-lg mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <span className="font-semibold text-base-content/80">Ramble</span>
            </div>

            {currentStep !== 'complete' && (
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  {[1, 2].map((step) => (
                    <div
                      key={step}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        step < stepNumber
                          ? 'w-6 bg-primary'
                          : step === stepNumber
                          ? 'w-6 bg-primary/60'
                          : 'w-3 bg-base-300'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-xs text-base-content/40 ml-2">
                  {stepNumber}/2
                </span>
              </div>
            )}
          </div>
        </header>

        {/* Main content area */}
        <main className="flex-1 flex items-center justify-center p-6 pb-12">
          <div className="w-full max-w-lg">
            {currentStep === 'api_key' && (
              <ApiKeyStep
                onComplete={completeApiKeyStep}
                hasExistingKey={hasApiKey}
              />
            )}

            {currentStep === 'user_info' && (
              <UserInfoStep
                onComplete={async (profile) => {
                  await completeUserInfoStep(profile)
                  await finishOnboarding()
                }}
                existingProfile={userProfile}
              />
            )}

            {currentStep === 'complete' && (
              <div className="text-center space-y-8">
                {/* Success animation */}
                <div className="relative">
                  <div className="w-24 h-24 mx-auto rounded-3xl bg-gradient-to-br from-success/20 to-success/5 flex items-center justify-center">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-success to-success/80 flex items-center justify-center shadow-lg shadow-success/25">
                      <Sparkles className="w-8 h-8 text-white" />
                    </div>
                  </div>
                  {/* Decorative rings */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-32 h-32 rounded-full border border-success/10 animate-ping" style={{ animationDuration: '2s' }} />
                  </div>
                </div>

                <div className="space-y-3">
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-base-content to-base-content/70 bg-clip-text text-transparent">
                    You're all set!
                  </h1>
                  <p className="text-base-content/60 text-lg">
                    Welcome to Ramble, {userProfile?.name || 'friend'}.
                  </p>
                </div>

                <button
                  onClick={onComplete}
                  className="btn btn-primary btn-lg gap-2 shadow-lg shadow-primary/25"
                >
                  Start Using Ramble
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}
