/**
 * UserInfoStep - Second step of onboarding
 *
 * Clean user info collection with:
 * - Voice input support via Ramble Native
 * - AI extraction of name/about from speech
 * - Elegant form design
 */

import { useState, useEffect, useCallback } from 'react'
import { User, Mic, Edit3, Loader2, AlertCircle, Sparkles, ArrowRight, Command } from 'lucide-react'
import type { UserProfileData } from '../../../db/models/Data'
import { rambleNative } from '../../../services/stt/rambleNative'
import { extractUserInfo } from '../utils/extractUserInfo'

interface UserInfoStepProps {
  onComplete: (profile: UserProfileData) => void
  existingProfile: UserProfileData | null
}

type RecordingState = 'idle' | 'recording' | 'transcribing' | 'extracting' | 'done'

export function UserInfoStep({ onComplete, existingProfile }: UserInfoStepProps) {
  const [name, setName] = useState(existingProfile?.name || '')
  const [aboutMe, setAboutMe] = useState(existingProfile?.aboutMe || '')
  const [isEditing, setIsEditing] = useState(!existingProfile)

  const [isRambleAvailable, setIsRambleAvailable] = useState(false)
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [intermediateText, setIntermediateText] = useState('')
  const [recordingError, setRecordingError] = useState<string | null>(null)

  useEffect(() => {
    setIsRambleAvailable(rambleNative.isRambleAvailable())

    rambleNative.setCallbacks({
      onConnectionChange: (connected) => setIsRambleAvailable(connected),
      onStateChange: (state) => {
        if (!state) return
        switch (state) {
          case 'recording':
            setRecordingState('recording')
            setRecordingError(null)
            break
          case 'transcribing':
            setRecordingState('transcribing')
            break
          case 'done':
            setRecordingState('done')
            setTimeout(() => setRecordingState('idle'), 500)
            break
          case 'idle':
            setRecordingState('idle')
            break
        }
      },
      onIntermediateText: (text) => setIntermediateText(text),
      onTranscriptionComplete: async (text) => {
        setIntermediateText('')
        setRecordingState('extracting')

        try {
          const extracted = await extractUserInfo(text)
          if (extracted.name) setName(extracted.name)
          if (extracted.aboutMe) setAboutMe(extracted.aboutMe)
          setRecordingState('done')
          setTimeout(() => setRecordingState('idle'), 500)
        } catch (error) {
          console.error('[Onboarding] Failed to extract user info:', error)
          setRecordingError('Failed to process speech. Please try again or type manually.')
          setRecordingState('idle')
        }
      },
    })

    return () => rambleNative.clearCallbacks()
  }, [])

  const handleSubmit = useCallback(() => {
    if (!name.trim()) return
    onComplete({
      name: name.trim(),
      aboutMe: aboutMe.trim() || undefined,
      collectedAt: Date.now(),
    })
  }, [name, aboutMe, onComplete])

  // Recording overlay
  const renderRecordingOverlay = () => {
    if (recordingState === 'idle') return null

    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-base-100 rounded-2xl p-8 max-w-sm w-full mx-4 text-center space-y-6 shadow-2xl">
          {recordingState === 'recording' && (
            <>
              <div className="relative">
                <div className="w-24 h-24 mx-auto rounded-full bg-error/10 flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full bg-error/20 flex items-center justify-center animate-pulse">
                    <Mic className="w-8 h-8 text-error" />
                  </div>
                </div>
                {/* Ripple effect */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-28 h-28 rounded-full border-2 border-error/20 animate-ping" />
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Listening...</h3>
                <p className="text-base-content/60 text-sm">
                  Say your name and tell me a bit about yourself
                </p>
              </div>
              {intermediateText && (
                <div className="bg-base-200 rounded-lg p-3">
                  <p className="text-sm italic text-base-content/70">"{intermediateText}"</p>
                </div>
              )}
              <p className="text-xs text-base-content/40">
                Release <kbd className="kbd kbd-xs">Right ⌘</kbd> when done
              </p>
            </>
          )}

          {recordingState === 'transcribing' && (
            <>
              <div className="w-20 h-20 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-10 h-10 text-primary animate-spin" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Processing...</h3>
                <p className="text-base-content/60 text-sm">Converting speech to text</p>
              </div>
            </>
          )}

          {recordingState === 'extracting' && (
            <>
              <div className="w-20 h-20 mx-auto rounded-full bg-secondary/10 flex items-center justify-center">
                <Sparkles className="w-10 h-10 text-secondary animate-pulse" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-semibold">Understanding...</h3>
                <p className="text-base-content/60 text-sm">Extracting your information</p>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // Review screen (after info is captured)
  if (!isEditing && name) {
    return (
      <>
        {renderRecordingOverlay()}

        <div className="space-y-5">
          {/* Compact header */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-success to-success/80 flex items-center justify-center shadow-lg shadow-success/25 flex-shrink-0">
              <User className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-base-content">
                Nice to meet you, {name}!
              </h1>
              <p className="text-sm text-base-content/60">
                Please review your information
              </p>
            </div>
          </div>

          {/* Info card */}
          <div className="bg-base-200/50 backdrop-blur rounded-xl p-5 space-y-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-base-content/40 mb-1">Name</p>
              <p className="font-medium">{name}</p>
            </div>
            {aboutMe && (
              <div>
                <p className="text-xs uppercase tracking-wider text-base-content/40 mb-1">About</p>
                <p className="text-sm text-base-content/80">{aboutMe}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button onClick={handleSubmit} className="btn btn-primary w-full gap-2">
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="btn btn-ghost btn-sm w-full gap-2 text-base-content/50"
            >
              <Edit3 className="w-4 h-4" />
              Edit
            </button>
          </div>
        </div>
      </>
    )
  }

  // Input form
  return (
    <>
      {renderRecordingOverlay()}

      <div className="space-y-5">
        {/* Compact header */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25 flex-shrink-0">
            <User className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-base-content">
              Tell me about yourself
            </h1>
            <p className="text-sm text-base-content/60">
              {isRambleAvailable
                ? 'Use voice or type below'
                : 'Enter your information below'}
            </p>
          </div>
        </div>

        {/* Voice input hint */}
        {isRambleAvailable && (
          <div className="flex items-center justify-center gap-3 py-3 px-4 bg-success/5 border border-success/20 rounded-xl">
            <div className="w-8 h-8 rounded-lg bg-success/10 flex items-center justify-center">
              <Mic className="w-4 h-4 text-success" />
            </div>
            <div className="text-sm">
              <p className="text-success font-medium">Voice input ready</p>
              <p className="text-base-content/50 text-xs">
                Hold <kbd className="kbd kbd-xs">Right <Command className="w-2.5 h-2.5 inline" /></kbd> to speak
              </p>
            </div>
          </div>
        )}

        {/* Form */}
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-base-content/80">
              Your Name <span className="text-error">*</span>
            </label>
            <input
              type="text"
              placeholder="What should I call you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input input-bordered w-full"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-base-content/80">
              About You <span className="text-base-content/40">(optional)</span>
            </label>
            <textarea
              placeholder="Tell me a bit about yourself, your interests, what you do..."
              value={aboutMe}
              onChange={(e) => setAboutMe(e.target.value)}
              className="textarea textarea-bordered w-full h-24 resize-none"
            />
            <p className="text-xs text-base-content/40">
              This helps personalize your experience
            </p>
          </div>
        </div>

        {recordingError && (
          <div className="flex items-center gap-2 text-sm text-error">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {recordingError}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <button
            onClick={() => setIsEditing(false)}
            disabled={!name.trim()}
            className="btn btn-primary w-full gap-2"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
          {existingProfile && (
            <button
              onClick={() => {
                setName(existingProfile.name)
                setAboutMe(existingProfile.aboutMe || '')
                setIsEditing(false)
              }}
              className="btn btn-ghost btn-sm w-full text-base-content/50"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </>
  )
}
