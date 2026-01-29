/**
 * ApiKeyStep - First step of onboarding
 *
 * Clean, focused API key entry with:
 * - Clear instructions
 * - Real-time validation
 * - Elegant transitions
 */

import { useState, useCallback } from 'react'
import { Key, ExternalLink, Loader2, CheckCircle, XCircle, ArrowRight, ArrowLeft } from 'lucide-react'
import { settingsHelpers } from '../../../stores/settingsStore'
import { testGeminiApiKey, validateApiKeyFormat } from '../utils/testApiKey'

interface ApiKeyStepProps {
  onComplete: () => void
  hasExistingKey: boolean
}

type TestStatus = 'idle' | 'testing' | 'success' | 'error'

export function ApiKeyStep({ onComplete, hasExistingKey }: ApiKeyStepProps) {
  const [showKeyInput, setShowKeyInput] = useState(!hasExistingKey)
  const [apiKey, setApiKey] = useState('')
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [testError, setTestError] = useState<string | null>(null)

  // If user already has an API key
  if (hasExistingKey && !showKeyInput) {
    return (
      <div className="space-y-5">
        {/* Compact header */}
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-success to-success/80 flex items-center justify-center shadow-lg shadow-success/25 flex-shrink-0">
            <CheckCircle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-base-content">
              API Key Connected
            </h1>
            <p className="text-sm text-base-content/60">
              Your Gemini API key is ready to use
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3 pt-2">
          <button
            onClick={onComplete}
            className="btn btn-primary w-full gap-2"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowKeyInput(true)}
            className="btn btn-ghost btn-sm w-full text-base-content/50"
          >
            Use a different key
          </button>
        </div>
      </div>
    )
  }

  const handleTestApiKey = useCallback(async () => {
    const formatCheck = validateApiKeyFormat(apiKey, 'gemini')
    if (!formatCheck.valid) {
      setTestStatus('error')
      setTestError(formatCheck.error || 'Invalid API key format')
      return
    }

    setTestStatus('testing')
    setTestError(null)

    settingsHelpers.setApiKey('gemini', apiKey.trim())

    const result = await testGeminiApiKey(apiKey.trim())

    if (result.success) {
      setTestStatus('success')
      setTimeout(() => onComplete(), 800)
    } else {
      setTestStatus('error')
      setTestError(result.error || 'API key verification failed')
      settingsHelpers.setApiKey('gemini', '')
    }
  }, [apiKey, onComplete])

  return (
    <div className="space-y-5">
      {/* Compact header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/80 flex items-center justify-center shadow-lg shadow-primary/25 flex-shrink-0">
          <Key className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-base-content">
            Connect to Gemini
          </h1>
          <p className="text-sm text-base-content/60">
            Enter your API key to enable AI features
          </p>
        </div>
      </div>

      {/* Instructions card */}
      <div className="bg-base-200/50 backdrop-blur rounded-xl p-5 space-y-4">
        <p className="text-sm font-medium text-base-content/80">
          Get a free API key from Google AI Studio:
        </p>
        <ol className="text-sm space-y-2 text-base-content/60">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">1</span>
            <span>Sign in with your Google account</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">2</span>
            <span>Click "Create API Key"</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center font-medium">3</span>
            <span>Copy and paste below</span>
          </li>
        </ol>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-sm btn-primary btn-outline gap-2 w-full"
        >
          <ExternalLink className="w-4 h-4" />
          Open Google AI Studio
        </a>
      </div>

      {/* API Key Input */}
      <div className="space-y-2">
        <div className="relative">
          <input
            type="password"
            placeholder="Paste your API key here"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              setTestStatus('idle')
              setTestError(null)
            }}
            className={`input input-bordered w-full pr-12 font-mono text-sm ${
              testStatus === 'error' ? 'input-error' :
              testStatus === 'success' ? 'input-success' : ''
            }`}
            disabled={testStatus === 'testing' || testStatus === 'success'}
          />
          {testStatus === 'success' && (
            <CheckCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-success" />
          )}
          {testStatus === 'error' && (
            <XCircle className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-error" />
          )}
        </div>

        {testError && (
          <p className="text-sm text-error flex items-center gap-2">
            <XCircle className="w-4 h-4 flex-shrink-0" />
            {testError}
          </p>
        )}

        {testStatus === 'success' && (
          <p className="text-sm text-success flex items-center gap-2">
            <CheckCircle className="w-4 h-4 flex-shrink-0" />
            API key verified successfully!
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="space-y-3">
        <button
          onClick={handleTestApiKey}
          disabled={!apiKey.trim() || testStatus === 'testing' || testStatus === 'success'}
          className="btn btn-primary w-full gap-2"
        >
          {testStatus === 'testing' ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying...
            </>
          ) : testStatus === 'success' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              Verified!
            </>
          ) : (
            <>
              Verify & Continue
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>

        {hasExistingKey && (
          <button
            onClick={() => setShowKeyInput(false)}
            disabled={testStatus === 'testing'}
            className="btn btn-ghost btn-sm w-full gap-2 text-base-content/50"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}
      </div>
    </div>
  )
}
