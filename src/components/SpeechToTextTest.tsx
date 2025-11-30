/**
 * Speech-to-Text Test Page (Refactored)
 *
 * Demonstrates usage of the modular STT service
 */

import { useState, useEffect, useMemo } from 'react';
import { useSTT } from '../services/stt/useSTT';
import { settingsHelpers } from '../stores/settingsStore';
import type { STTProvider } from '../services/stt';

type STTTab = 'groq-whisper' | 'deepgram-nova' | 'deepgram-flux' | 'gemini';

export function SpeechToTextTest() {
  const [activeTab, setActiveTab] = useState<STTTab>('groq-whisper');
  const [apiKeys, setApiKeys] = useState({
    groq: '',
    deepgram: '',
    gemini: '',
  });

  // Load API keys from settings
  useEffect(() => {
    const groqKey = settingsHelpers.getApiKey('groq');
    const deepgramKey = settingsHelpers.getApiKey('deepgram');
    const geminiKey = settingsHelpers.getApiKey('gemini');

    setApiKeys({ groq: groqKey, deepgram: deepgramKey, gemini: geminiKey });

    const unsubscribe = settingsHelpers.subscribe((settings) => {
      setApiKeys({
        groq: settings.providers.groq.apiKey,
        deepgram: settings.providers.deepgram?.apiKey || '',
        gemini: settings.providers.gemini?.apiKey || '',
      });
    });

    return unsubscribe;
  }, []);

  return (
    <div className="min-h-screen bg-base-300 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h1 className="card-title text-3xl mb-6">Speech-to-Text Test</h1>

            {/* Tabs */}
            <div className="tabs tabs-boxed mb-6">
              <button
                className={`tab ${activeTab === 'groq-whisper' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('groq-whisper')}
              >
                Groq Whisper
              </button>
              <button
                className={`tab ${activeTab === 'deepgram-nova' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('deepgram-nova')}
              >
                Deepgram Nova
              </button>
              <button
                className={`tab ${activeTab === 'deepgram-flux' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('deepgram-flux')}
              >
                Deepgram Flux
              </button>
              <button
                className={`tab ${activeTab === 'gemini' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('gemini')}
              >
                Gemini
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'groq-whisper' && (
              <STTTabContent provider="groq-whisper" apiKey={apiKeys.groq} />
            )}
            {activeTab === 'deepgram-nova' && (
              <STTTabContent provider="deepgram-nova" apiKey={apiKeys.deepgram} />
            )}
            {activeTab === 'deepgram-flux' && (
              <STTTabContent provider="deepgram-flux" apiKey={apiKeys.deepgram} />
            )}
            {activeTab === 'gemini' && (
              <STTTabContent provider="gemini" apiKey={apiKeys.gemini} />
            )}

            {/* Info Section */}
            <div className="divider mt-8"></div>
            <div className="text-sm opacity-70">
              <p className="mb-2">Powered by modular STT service</p>
              <p>Supports integrated (mic + transcription) and headless (external audio) modes</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface STTTabContentProps {
  provider: STTProvider;
  apiKey: string;
}

function STTTabContent({ provider, apiKey }: STTTabContentProps) {
  const [chunkingStrategy, setChunkingStrategy] = useState<'simple' | 'vad'>('simple');

  // Memoize config to prevent infinite re-renders
  const config = useMemo(() => ({
    provider,
    apiKey,
    sampleRate: 16000,
    encoding: 'linear16',
    chunkingStrategy: (provider === 'groq-whisper' || provider === 'gemini') ? chunkingStrategy : undefined,
  }), [provider, apiKey, chunkingStrategy]);

  const stt = useSTT({
    config,
    autoConnect: false, // Don't auto-connect - providers will be created when needed
  });

  const providerLabels: Record<STTProvider, string> = {
    'groq-whisper': 'Groq Whisper (Ultra-fast)',
    'deepgram-nova': 'Deepgram Nova-3',
    'deepgram-flux': 'Deepgram Flux (Conversational AI)',
    'gemini': 'Gemini 2.5 Flash',
  };

  const providerDescriptions: Record<STTProvider, string> = {
    'groq-whisper': 'File-based transcription with ultra-low latency. Record audio and transcribe after stopping.',
    'deepgram-nova': 'Real-time streaming speech-to-text with Nova-3 model.',
    'deepgram-flux': 'Advanced conversational AI with turn detection and interruption handling.',
    'gemini': 'Google Gemini AI with multimodal audio transcription. Supports VAD-based chunking.',
  };

  return (
    <div className="space-y-4">
      {/* API Key Status */}
      {!apiKey && (
        <div className="alert alert-warning">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span>
            No API key configured. <a href="/settings" className="link link-primary">Go to Settings →</a>
          </span>
        </div>
      )}

      {/* Groq Whisper & Gemini Chunking Strategy */}
      {(provider === 'groq-whisper' || provider === 'gemini') && (
        <div className="form-control">
          <label className="label">
            <span className="label-text font-semibold">Chunking Strategy</span>
          </label>
          <select
            className="select select-bordered w-full"
            value={chunkingStrategy}
            onChange={(e) => setChunkingStrategy(e.target.value as any)}
            disabled={stt.isRecording}
          >
            <option value="simple">Simple (Send entire recording)</option>
            <option value="vad">VAD-based (Voice Activity Detection, intelligent chunking)</option>
          </select>
          <label className="label">
            <span className="label-text-alt">
              {chunkingStrategy === 'simple' && 'Best for short recordings under 30 seconds'}
              {chunkingStrategy === 'vad' && 'Uses ML to detect speech, sends only speech chunks (10s+ minimum)'}
            </span>
          </label>
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-4">
        {/* For Groq Whisper & Gemini - no connect needed, auto-connected */}
        {(provider === 'groq-whisper' || provider === 'gemini') ? (
          <>
            {!stt.isRecording ? (
              <button
                className="btn btn-success"
                onClick={stt.startRecording}
                disabled={!apiKey}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
                Start Recording
              </button>
            ) : (
              <button
                className="btn btn-error"
                onClick={stt.stopRecording}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
                Stop Recording
              </button>
            )}

            {stt.transcript && (
              <button
                className="btn btn-ghost"
                onClick={stt.clearTranscript}
              >
                Clear
              </button>
            )}
          </>
        ) : (
          /* For Deepgram - need to connect/disconnect */
          <>
            {!stt.isConnected ? (
              <button
                className="btn btn-primary"
                onClick={stt.connect}
                disabled={!apiKey}
              >
                Connect
              </button>
            ) : (
              <>
                {!stt.isRecording ? (
                  <button
                    className="btn btn-success"
                    onClick={stt.startRecording}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                    </svg>
                    Start Recording
                  </button>
                ) : (
                  <button
                    className="btn btn-error"
                    onClick={stt.stopRecording}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                    </svg>
                    Stop Recording
                  </button>
                )}

                <button
                  className="btn btn-ghost"
                  onClick={stt.disconnect}
                >
                  Disconnect
                </button>

                {stt.transcript && (
                  <button
                    className="btn btn-ghost"
                    onClick={stt.clearTranscript}
                  >
                    Clear
                  </button>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Status Indicators */}
      {stt.isRecording && (
        <div className="flex items-center gap-2">
          <span className="loading loading-bars loading-md text-success"></span>
          <span className="text-success">
            {(provider === 'groq-whisper' || provider === 'gemini') ? 'Recording...' : 'Recording and transcribing...'}
          </span>
        </div>
      )}

      {stt.isConnected && !stt.isRecording && provider !== 'groq-whisper' && provider !== 'gemini' && (
        <div className="text-success">✓ Connected and ready</div>
      )}

      {/* Error Display */}
      {stt.error && (
        <div className="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <div className="font-bold">{stt.error.code}</div>
            <div className="text-sm">{stt.error.message}</div>
          </div>
        </div>
      )}

      {/* Transcript Display */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="font-semibold mb-2">Transcript:</h3>
          <div className="min-h-[200px] max-h-[400px] overflow-y-auto">
            <p className="whitespace-pre-wrap">
              {stt.transcript || 'Transcript will appear here...'}
            </p>
          </div>
        </div>
      </div>

      {/* Provider Info */}
      <div className="text-sm opacity-70">
        <p className="font-semibold">{providerLabels[provider]}</p>
        <p>{providerDescriptions[provider]}</p>
      </div>
    </div>
  );
}
