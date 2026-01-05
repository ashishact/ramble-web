/**
 * Ramble API - Speech-to-text and text correction endpoints
 *
 * Models:
 * - STT: whisper-large-v3-turbo (via Groq)
 * - LLM: openai/gpt-oss-120b (via Groq)
 *
 * API key handling:
 * - Uses client-provided apiKey if sent
 * - Falls back to server's GROQ_API_KEY from env
 */

const STT_MODEL = 'whisper-large-v3-turbo';
const LLM_MODEL = 'openai/gpt-oss-120b';

// Cloudflare AI Gateway base URL
const GATEWAY_BASE = 'https://gateway.ai.cloudflare.com/v1/f107b4eef4a9b8eb99a9d1df6fac9ff2/brokenai';

// CORS headers
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

interface Env {
	GROQ_API_KEY?: string;
}

/**
 * Get API key from request or fall back to server env
 */
function getApiKey(clientKey: string | undefined, env: Env): string | null {
	if (clientKey && clientKey !== '' && clientKey !== 'undefined') {
		return clientKey;
	}
	return env.GROQ_API_KEY || null;
}

/**
 * Speech-to-Text endpoint
 * POST /api/ramble/stt
 *
 * Body (FormData):
 * - file: audio file (required)
 * - apiKey: Groq API key (optional, falls back to server key)
 *
 * Returns: { text: string }
 */
async function handleSTT(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData();
		const clientApiKey = formData.get('apiKey') as string | null;
		const apiKey = getApiKey(clientApiKey || undefined, env);

		if (!apiKey) {
			return new Response(JSON.stringify({ error: 'No API key available. Configure GROQ_API_KEY or provide apiKey in request.' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		// Remove apiKey from formData before forwarding
		formData.delete('apiKey');

		// Add model to formData
		formData.set('model', STT_MODEL);

		// Forward to Groq through Cloudflare AI Gateway
		const response = await fetch(`${GATEWAY_BASE}/groq/audio/transcriptions`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
			},
			body: formData,
		});

		const data = await response.json();

		if (!response.ok) {
			return new Response(JSON.stringify({ error: data.error?.message || 'STT failed' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		return new Response(JSON.stringify({ text: data.text }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
		});
	}
}

/**
 * Text Correction endpoint
 * POST /api/ramble/correct
 *
 * Body (JSON):
 * - system: system prompt (required)
 * - user: user prompt / text to correct (required)
 * - apiKey: Groq API key (optional, falls back to server key)
 *
 * Returns: { text: string }
 */
async function handleCorrect(request: Request, env: Env): Promise<Response> {
	try {
		const body = await request.json();
		const { system, user, apiKey: clientApiKey } = body;

		const apiKey = getApiKey(clientApiKey, env);

		if (!apiKey) {
			return new Response(JSON.stringify({ error: 'No API key available. Configure GROQ_API_KEY or provide apiKey in request.' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		if (!system || !user) {
			return new Response(JSON.stringify({ error: 'system and user prompts are required' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		// Build messages array
		const messages = [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		];

		// Call LLM through Cloudflare AI Gateway
		const response = await fetch(`${GATEWAY_BASE}/groq/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: LLM_MODEL,
				messages,
				stream: false,
			}),
		});

		const data = await response.json();

		if (!response.ok) {
			return new Response(JSON.stringify({ error: data.error?.message || 'Correction failed' }), {
				status: response.status,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		const text = data.choices?.[0]?.message?.content || '';

		return new Response(JSON.stringify({ text }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
		});
	}
}

/**
 * Combined Transcribe endpoint (STT + Correction)
 * POST /api/ramble/transcribe
 *
 * Body (FormData):
 * - file: audio file (required)
 * - system: system prompt for correction (optional)
 * - user: additional user context (optional)
 * - correct: whether to apply correction (default: true)
 * - apiKey: Groq API key (optional, falls back to server key)
 *
 * Returns: { text: string, rawText: string }
 */
async function handleTranscribe(request: Request, env: Env): Promise<Response> {
	try {
		const formData = await request.formData();
		const clientApiKey = formData.get('apiKey') as string | null;
		const apiKey = getApiKey(clientApiKey || undefined, env);

		if (!apiKey) {
			return new Response(JSON.stringify({ error: 'No API key available. Configure GROQ_API_KEY or provide apiKey in request.' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		// Extract parameters
		const system = formData.get('system') as string | null;
		const user = formData.get('user') as string | null;
		const correctStr = formData.get('correct') as string | null;
		const shouldCorrect = correctStr !== 'false';

		// Remove non-audio fields
		formData.delete('apiKey');
		formData.delete('system');
		formData.delete('user');
		formData.delete('correct');

		// Add STT model
		formData.set('model', STT_MODEL);

		// Step 1: Speech-to-Text
		const sttResponse = await fetch(`${GATEWAY_BASE}/groq/audio/transcriptions`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${apiKey}`,
			},
			body: formData,
		});

		const sttData = await sttResponse.json();

		if (!sttResponse.ok) {
			return new Response(JSON.stringify({ error: sttData.error?.message || 'STT failed' }), {
				status: sttResponse.status,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		const rawText = sttData.text || '';

		// If no correction needed, return raw text
		if (!shouldCorrect || !system) {
			return new Response(JSON.stringify({ text: rawText, rawText }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		// Step 2: Text Correction
		// User prompt is the raw transcription, with optional additional context
		const userContent = user ? `${user}\n\nText to process:\n${rawText}` : rawText;

		const messages = [
			{ role: 'system', content: system },
			{ role: 'user', content: userContent },
		];

		const llmResponse = await fetch(`${GATEWAY_BASE}/groq/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				model: LLM_MODEL,
				messages,
				stream: false,
			}),
		});

		const llmData = await llmResponse.json();

		if (!llmResponse.ok) {
			// Return raw text if correction fails
			console.error('[Ramble] Correction failed:', llmData.error);
			return new Response(JSON.stringify({ text: rawText, rawText, correctionError: llmData.error?.message }), {
				status: 200,
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		const correctedText = llmData.choices?.[0]?.message?.content || rawText;

		return new Response(JSON.stringify({ text: correctedText, rawText }), {
			status: 200,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
		});
	} catch (error: any) {
		return new Response(JSON.stringify({ error: error.message }), {
			status: 500,
			headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
		});
	}
}

/**
 * Route handler for Ramble API endpoints
 * Import and call this from index.ts
 */
export async function handleRambleAPI(request: Request, env: Env, pathname: string): Promise<Response | null> {
	// Handle CORS preflight
	if (request.method === 'OPTIONS') {
		return new Response(null, { headers: CORS_HEADERS });
	}

	if (request.method !== 'POST') {
		return null; // Let index.ts handle 404
	}

	switch (pathname) {
		case '/api/ramble/stt':
			return handleSTT(request, env);
		case '/api/ramble/correct':
			return handleCorrect(request, env);
		case '/api/ramble/transcribe':
			return handleTranscribe(request, env);
		default:
			return null; // Not a Ramble endpoint
	}
}
