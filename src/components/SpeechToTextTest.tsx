import { useState, useEffect, useRef } from 'react';
import { settingsHelpers } from '../stores/settingsStore';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

type STTProvider = 'groq-whisper' | 'deepgram-v1' | 'deepgram-flux';

export function SpeechToTextTest() {
  const [activeTab, setActiveTab] = useState<STTProvider>('groq-whisper');
  const [groqApiKey, setGroqApiKey] = useState('');
  const [deepgramApiKey, setDeepgramApiKey] = useState('');

  // Load API keys from settings
  useEffect(() => {
    const groqKey = settingsHelpers.getApiKey('groq');
    const deepgramKey = settingsHelpers.getApiKey('deepgram');

    setGroqApiKey(groqKey);
    setDeepgramApiKey(deepgramKey);

    const unsubscribe = settingsHelpers.subscribe((settings) => {
      setGroqApiKey(settings.providers.groq.apiKey);
      setDeepgramApiKey(settings.providers.deepgram?.apiKey || '');
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
                className={`tab ${activeTab === 'deepgram-v1' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('deepgram-v1')}
              >
                Deepgram Live (v1)
              </button>
              <button
                className={`tab ${activeTab === 'deepgram-flux' ? 'tab-active' : ''}`}
                onClick={() => setActiveTab('deepgram-flux')}
              >
                Deepgram Flux (v2)
              </button>
            </div>

            {/* Tab Content */}
            {activeTab === 'groq-whisper' && (
              <GroqWhisperTab apiKey={groqApiKey} onApiKeyChange={setGroqApiKey} />
            )}
            {activeTab === 'deepgram-v1' && (
              <DeepgramLiveTab apiKey={deepgramApiKey} onApiKeyChange={setDeepgramApiKey} version="v1" />
            )}
            {activeTab === 'deepgram-flux' && (
              <DeepgramLiveTab apiKey={deepgramApiKey} onApiKeyChange={setDeepgramApiKey} version="v2" />
            )}

            {/* Info Section */}
            <div className="divider mt-8"></div>
            <div className="text-sm opacity-70">
              <p className="mb-2">All requests are routed through Cloudflare AI Gateway.</p>
              <p className="font-mono text-xs">Worker URL: {WORKER_URL}</p>
              <p className="font-mono text-xs">Gateway: f107b4eef4a9b8eb99a9d1df6fac9ff2/brokenai</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Groq Whisper Tab Component
function GroqWhisperTab({ apiKey, onApiKeyChange }: { apiKey: string; onApiKeyChange: (key: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcript, setTranscript] = useState('');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState('');

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to access microphone');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const transcribeAudio = async () => {
    if (!audioBlob || !apiKey) {
      setError('Please record audio and provide API key');
      return;
    }

    setIsTranscribing(true);
    setError('');
    setTranscript('');

    try {
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.webm');
      formData.append('model', 'whisper-large-v3-turbo');
      formData.append('apiKey', apiKey);

      const response = await fetch(`${WORKER_URL}/api/groq-whisper`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Transcription failed');
      }

      const data = await response.json();
      setTranscript(data.text || 'No transcript received');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsTranscribing(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* API Key */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-semibold">Groq API Key</span>
          {apiKey && <span className="label-text-alt text-success">✓ Loaded from settings</span>}
        </label>
        <input
          type="password"
          placeholder="Enter your Groq API Key"
          className="input input-bordered w-full"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />
        {!apiKey && (
          <label className="label">
            <span className="label-text-alt">
              <a href="/settings" className="link link-primary">Configure API key in Settings →</a>
            </span>
          </label>
        )}
      </div>

      {/* Recording Controls */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="font-semibold mb-4">Audio Recording</h3>

          <div className="flex gap-4">
            {!isRecording ? (
              <button className="btn btn-primary" onClick={startRecording}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M7 4a3 3 0 016 0v4a3 3 0 11-6 0V4zm4 10.93A7.001 7.001 0 0017 8a1 1 0 10-2 0A5 5 0 015 8a1 1 0 00-2 0 7.001 7.001 0 006 6.93V17H6a1 1 0 100 2h8a1 1 0 100-2h-3v-2.07z" clipRule="evenodd" />
                </svg>
                Start Recording
              </button>
            ) : (
              <button className="btn btn-error" onClick={stopRecording}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1V8a1 1 0 00-1-1H8z" clipRule="evenodd" />
                </svg>
                Stop Recording
              </button>
            )}

            {audioBlob && (
              <button
                className={`btn btn-success ${isTranscribing ? 'loading' : ''}`}
                onClick={transcribeAudio}
                disabled={isTranscribing || !apiKey}
              >
                {isTranscribing ? 'Transcribing...' : 'Transcribe Audio'}
              </button>
            )}
          </div>

          {isRecording && (
            <div className="mt-4">
              <span className="loading loading-bars loading-md text-error"></span>
              <span className="ml-2 text-error">Recording...</span>
            </div>
          )}

          {audioBlob && !isRecording && (
            <div className="mt-4 text-success">
              ✓ Audio recorded successfully
            </div>
          )}
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Transcript Display */}
      {transcript && (
        <div className="card bg-base-200">
          <div className="card-body">
            <h3 className="font-semibold mb-2">Transcript:</h3>
            <p className="whitespace-pre-wrap">{transcript}</p>
          </div>
        </div>
      )}

      <div className="text-sm opacity-70">
        <p className="font-semibold">Model: whisper-large-v3-turbo</p>
        <p>Record audio and transcribe using Groq's ultra-fast Whisper API.</p>
      </div>
    </div>
  );
}

// Deepgram Live Tab Component
function DeepgramLiveTab({
  apiKey,
  onApiKeyChange,
  version
}: {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  version: 'v1' | 'v2';
}) {
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');

  const websocketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const isManualCloseRef = useRef(false);
  const currentTurnIndexRef = useRef<number>(-1);
  const finalTranscriptRef = useRef<string>('');

  const connect = async () => {
    if (!apiKey) {
      setError('Please provide Deepgram API key');
      return;
    }

    try {
      setError('');
      isManualCloseRef.current = false;

      // Get microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Connect directly to Deepgram API (not through worker)
      // Using Sec-WebSocket-Protocol for authentication
      const params = new URLSearchParams({
        encoding: 'linear16',
        sample_rate: '16000',
      });

      // Add model parameter
      if (version === 'v2') {
        // Flux v2 - no channels parameter
        params.append('model', 'flux-general-en');
      } else {
        // For v1, use nova-3 model with channels
        params.append('model', 'nova-3');
        params.append('channels', '1');
      }

      const wsUrl = `wss://api.deepgram.com/${version}/listen?${params}`;

      // Use Sec-WebSocket-Protocol header for authentication
      const ws = new WebSocket(wsUrl, ['token', apiKey]);
      websocketRef.current = ws;

      ws.onopen = () => {
        console.log('Deepgram WebSocket connected');
        setIsConnected(true);
        startStreaming(stream, ws);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Deepgram message:', data);

          // Handle v1 response format
          if (version === 'v1' && data.channel?.alternatives?.[0]?.transcript) {
            const text = data.channel.alternatives[0].transcript;
            if (text.trim()) {
              setTranscript(prev => prev + ' ' + text);
            }
          }

          // Handle v2 (Flux) response format - TurnInfo events
          if (version === 'v2' && data.type === 'TurnInfo') {
            const text = data.transcript;
            const turnIndex = data.turn_index;

            if (data.event === 'EndOfTurn' && text && text.trim()) {
              // Final result - append to final transcript
              finalTranscriptRef.current += (finalTranscriptRef.current ? ' ' : '') + text;
              setTranscript(finalTranscriptRef.current);
              currentTurnIndexRef.current = turnIndex;
            } else if (data.event === 'Update' && text) {
              // Interim result - show final + current interim
              setTranscript(finalTranscriptRef.current + (finalTranscriptRef.current ? ' ' : '') + text);
            }
          }
        } catch (err) {
          console.error('Failed to parse message:', err);
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError(`WebSocket connection error (${version})`);
      };

      ws.onclose = (event) => {
        console.log('Deepgram WebSocket closed:', event.code, event.reason);
        setIsConnected(false);
        setIsRecording(false);
        // Only show error if it was not a manual close and not a normal close
        if (!isManualCloseRef.current && event.code !== 1000) {
          setError(`WebSocket closed unexpectedly: ${event.code} - ${event.reason || 'No reason provided'}`);
        }
        cleanup();
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  };

  const startStreaming = (stream: MediaStream, ws: WebSocket) => {
    // Create AudioContext to process raw audio data
    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (ws.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0);

        // Convert Float32Array to Int16Array (linear16 PCM)
        const pcmData = new Int16Array(inputData.length);
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]));
          pcmData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        ws.send(pcmData.buffer);
      }
    };

    // Store reference for cleanup
    (mediaRecorderRef.current as any) = { processor, audioContext, source };
    setIsRecording(true);
  };

  const disconnect = () => {
    isManualCloseRef.current = true;
    cleanup();
    setIsConnected(false);
    setIsRecording(false);
  };

  const cleanup = () => {
    if (mediaRecorderRef.current) {
      const ref = mediaRecorderRef.current as any;
      if (ref.processor) {
        ref.processor.disconnect();
        ref.source.disconnect();
        ref.audioContext.close();
      } else if (typeof ref.stop === 'function') {
        ref.stop();
      }
      mediaRecorderRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (websocketRef.current) {
      websocketRef.current.close();
      websocketRef.current = null;
    }
  };

  const clearTranscript = () => {
    setTranscript('');
    finalTranscriptRef.current = '';
    currentTurnIndexRef.current = -1;
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => cleanup();
  }, []);

  return (
    <div className="space-y-4">
      {/* API Key */}
      <div className="form-control">
        <label className="label">
          <span className="label-text font-semibold">Deepgram API Key</span>
          {apiKey && <span className="label-text-alt text-success">✓ Loaded from settings</span>}
        </label>
        <input
          type="password"
          placeholder="Enter your Deepgram API Key"
          className="input input-bordered w-full"
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          disabled={isConnected}
        />
        {!apiKey && (
          <label className="label">
            <span className="label-text-alt">
              <a href="/settings" className="link link-primary">Configure API key in Settings →</a>
            </span>
          </label>
        )}
      </div>

      {/* Connection Controls */}
      <div className="flex gap-4">
        {!isConnected ? (
          <button className="btn btn-primary" onClick={connect} disabled={!apiKey}>
            Connect & Start
          </button>
        ) : (
          <button className="btn btn-error" onClick={disconnect}>
            Stop & Disconnect
          </button>
        )}

        {transcript && (
          <button className="btn btn-ghost" onClick={clearTranscript}>
            Clear Transcript
          </button>
        )}
      </div>

      {/* Status */}
      {isRecording && (
        <div className="flex items-center gap-2">
          <span className="loading loading-bars loading-md text-success"></span>
          <span className="text-success">Live transcription active...</span>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="alert alert-error">
          <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Live Transcript Display */}
      <div className="card bg-base-200">
        <div className="card-body">
          <h3 className="font-semibold mb-2">Live Transcript:</h3>
          <div className="min-h-[200px] max-h-[400px] overflow-y-auto">
            <p className="whitespace-pre-wrap">{transcript || 'Transcript will appear here...'}</p>
          </div>
        </div>
      </div>

      <div className="text-sm opacity-70">
        <p className="font-semibold">
          {version === 'v1' ? 'Deepgram Nova-3 (v1)' : 'Deepgram Flux (v2)'}
        </p>
        <p>Real-time streaming speech-to-text with direct WebSocket connection to Deepgram API.</p>
      </div>
    </div>
  );
}
