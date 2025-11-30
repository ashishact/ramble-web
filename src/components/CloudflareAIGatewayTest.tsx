import { useState, useEffect } from 'react';
import { settingsHelpers } from '../stores/settingsStore';

const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'http://localhost:8787';

type Provider = 'gemini' | 'openai' | 'anthropic' | 'groq';

// Model options for each provider (using provider/model format)
const PROVIDER_MODELS: Record<Provider, { label: string; value: string }[]> = {
  gemini: [
    { label: 'Gemini 2.5 Flash', value: 'google/gemini-2.5-flash' },
    { label: 'Gemini 2.5 Flash Lite', value: 'google/gemini-2.5-flash-lite' },
  ],
  openai: [
    { label: 'GPT-5', value: 'openai/gpt-5' },
    { label: 'GPT-5 Mini', value: 'openai/gpt-5-mini' },
    { label: 'GPT-5 Nano', value: 'openai/gpt-5-nano' },
  ],
  anthropic: [
    { label: 'Claude Sonnet 4.5', value: 'anthropic/claude-sonnet-4-5-20250929' },
    { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4-5-20251001' },
    { label: 'Claude Opus 4.5', value: 'anthropic/claude-opus-4-5-20251101' },
  ],
  groq: [
    { label: 'GPT OSS 120B', value: 'groq/openai/gpt-oss-120b' },
    { label: 'GPT OSS 20B', value: 'groq/openai/gpt-oss-20b' },
    { label: 'Kimi K2 Instruct', value: 'groq/moonshotai/kimi-k2-instruct-0905' },
    { label: 'Qwen 3 32B', value: 'groq/qwen/qwen3-32b' },
    { label: 'Llama 3.1 8B Instant', value: 'groq/llama-3.1-8b-instant' },
  ],
};

export function CloudflareAIGatewayTest() {
  const [provider, setProvider] = useState<Provider>('gemini');
  const [model, setModel] = useState(PROVIDER_MODELS.gemini[0].value);
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('Hello, world!');
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<string>('');
  const [error, setError] = useState<string>('');

  // Load API key from settings store when provider changes
  useEffect(() => {
    const storedApiKey = settingsHelpers.getApiKey(provider);
    setApiKey(storedApiKey);

    // Set default model for provider
    setModel(PROVIDER_MODELS[provider][0].value);

    // Subscribe to settings changes
    const unsubscribe = settingsHelpers.subscribe((settings) => {
      setApiKey(settings.providers[provider].apiKey);
    });

    return unsubscribe;
  }, [provider]);

  const handleTest = async () => {
    // Validation
    if (!apiKey.trim()) {
      setError(`Please enter your ${provider.toUpperCase()} API Key`);
      return;
    }
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsLoading(true);
    setError('');
    setResponse('');

    try {
      const apiResponse = await fetch(`${WORKER_URL}/api/cf-gateway`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          apiKey: apiKey,
          model: model,
          messages: [{ role: 'user', content: prompt }],
          stream: true,
        }),
      });

      if (!apiResponse.ok) {
        const errorData = await apiResponse.json();
        throw new Error(errorData.error || 'Failed to get response from API');
      }

      // Handle streaming response
      const reader = apiResponse.body?.getReader();
      if (!reader) {
        throw new Error('Stream not available');
      }

      const decoder = new TextDecoder();
      let accumulatedResponse = '';
      let buffer = ''; // Buffer for incomplete chunks

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Split by newlines to process complete lines
        const lines = buffer.split('\n');

        // Keep the last potentially incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim(); // Remove 'data: ' prefix and trim

            if (data === '[DONE]' || !data) {
              continue;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;

              if (content) {
                accumulatedResponse += content;
                setResponse(accumulatedResponse);
              }
            } catch (e) {
              // Skip invalid JSON chunks silently
              // This is normal for streaming as chunks can be incomplete
            }
          }
        }
      }

      if (!accumulatedResponse) {
        setResponse('No response received');
      }
    } catch (err) {
      console.error('Error calling Cloudflare AI Gateway:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-base-300 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h1 className="card-title text-3xl mb-6">Cloudflare AI Gateway Test</h1>

            {/* Configuration Section */}
            <div className="space-y-4">
              {/* Provider Selection */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">Provider</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value as Provider)}
                  disabled={isLoading}
                >
                  <option value="gemini">Google Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="groq">Groq</option>
                </select>
              </div>

              {/* Model Selection */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">Model</span>
                </label>
                <select
                  className="select select-bordered w-full"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={isLoading}
                >
                  {PROVIDER_MODELS[provider].map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">
                    {provider.charAt(0).toUpperCase() + provider.slice(1)} API Key
                  </span>
                  {apiKey && (
                    <span className="label-text-alt text-success">
                      ✓ Loaded from settings
                    </span>
                  )}
                </label>
                <input
                  type="password"
                  placeholder={`Enter your ${provider.toUpperCase()} API Key`}
                  className="input input-bordered w-full"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={isLoading}
                />
                {!apiKey && (
                  <label className="label">
                    <span className="label-text-alt">
                      <a href="/settings" className="link link-primary">
                        Configure API key in Settings →
                      </a>
                    </span>
                  </label>
                )}
              </div>

              {/* Prompt */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold">Prompt</span>
                </label>
                <textarea
                  className="textarea textarea-bordered h-24"
                  placeholder="Enter your prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={isLoading}
                />
              </div>

              <button
                className={`btn btn-primary w-full ${isLoading ? 'loading' : ''}`}
                onClick={handleTest}
                disabled={isLoading}
              >
                {isLoading ? 'Testing...' : 'Test Gateway'}
              </button>
            </div>

            {/* Error Display */}
            {error && (
              <div className="alert alert-error mt-6">
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* Response Display */}
            {response && (
              <div className="mt-6">
                <h2 className="text-xl font-bold mb-3">
                  Response:
                  {isLoading && <span className="loading loading-dots loading-sm ml-2"></span>}
                </h2>
                <div className="bg-base-200 p-4 rounded-lg">
                  <p className="whitespace-pre-wrap">{response}</p>
                </div>
              </div>
            )}

            {/* Info Section */}
            <div className="divider mt-8"></div>
            <div className="text-sm opacity-70">
              <p className="font-semibold mb-2">
                Provider: {provider.charAt(0).toUpperCase() + provider.slice(1)} | Model: {model}
              </p>
              <p className="mb-2">This test uses the Cloudflare AI Gateway via your worker.</p>
              <p className="font-mono text-xs">Worker URL: {WORKER_URL}</p>
              <p className="font-mono text-xs">Gateway: f107b4eef4a9b8eb99a9d1df6fac9ff2/brokenai</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
