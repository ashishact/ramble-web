import { useState, useEffect } from 'react';
import { settingsHelpers } from '../stores/settingsStore';
import {
  type Provider,
  type Message,
  PROVIDER_MODELS,
  streamChat,
} from '../services/cfGateway';

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

    const messages: Message[] = [{ role: 'user', content: prompt }];

    await streamChat(
      {
        provider,
        model,
        apiKey,
        messages,
      },
      {
        onToken: (token) => {
          setResponse((prev) => prev + token);
        },
        onComplete: (fullText) => {
          setIsLoading(false);
          if (!fullText) {
            setResponse('No response received');
          }
        },
        onError: (err) => {
          setIsLoading(false);
          setError(err.message);
          console.error('Error calling Cloudflare AI Gateway:', err);
        },
      }
    );
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
                      Loaded from settings
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
                        Configure API key in Settings
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
              <p className="font-mono text-xs">Using cfGateway module</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
