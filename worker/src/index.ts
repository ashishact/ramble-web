import { DurableObject } from "cloudflare:workers";
import { handleRambleAPI } from "./ramble-api";

/**
 * BrokenAI Worker - API endpoints for the BrokenAI application
 */

/** A Durable Object's behavior is defined in an exported Javascript class */
export class MyDurableObject extends DurableObject {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
	}

	async sayHello(name: string): Promise<string> {
		return `Hello, ${name}!`;
	}
}

// Helper function to generate WebSocket key
function generateWebSocketKey(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return btoa(String.fromCharCode(...bytes));
}

// CORS headers for allowing frontend access
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		// Route: /api/ramble/* - Ramble speech-to-text and correction API
		if (url.pathname.startsWith('/api/ramble/')) {
			const response = await handleRambleAPI(request, env, url.pathname);
			if (response) return response;
		}

		// Route: /api/cf-gateway - Proxy to Cloudflare AI Gateway with streaming
		if (url.pathname === '/api/cf-gateway' && request.method === 'POST') {
			try {
				const body = await request.json();
				const { apiKey, model, system, user, messages, stream = true, audio } = body;

				if (!apiKey) {
					return new Response(JSON.stringify({ error: 'API key is required' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
					});
				}

				// Handle Gemini native API format (for multimodal with audio/images)
				if (model.startsWith('google/')) {
					const modelName = model.replace('google/', '');
					const geminiUrl = `https://gateway.ai.cloudflare.com/v1/f107b4eef4a9b8eb99a9d1df6fac9ff2/brokenai/google-ai-studio/v1beta/models/${modelName}:generateContent`;

					let geminiBody;

					// Check if native Gemini format is provided
					if (body.contents) {
						// Native format: use as-is
						geminiBody = { contents: body.contents };
					} else if (messages && Array.isArray(messages) && messages.length > 0) {
						// OpenAI-format messages: transform to Gemini native format
						// Extract system instruction if present
						let systemInstruction = undefined;
						const geminiContents = [];

						for (const msg of messages) {
							if (msg.role === 'system') {
								// System messages become systemInstruction in Gemini
								systemInstruction = { parts: [{ text: msg.content }] };
							} else {
								// Map user/assistant to user/model in Gemini
								const role = msg.role === 'assistant' ? 'model' : 'user';
								geminiContents.push({
									role,
									parts: [{ text: msg.content }],
								});
							}
						}

						geminiBody = {
							contents: geminiContents,
							...(systemInstruction && { systemInstruction }),
						};
					} else {
						// Simple format: transform to Gemini native
						const parts = [];
						if (system) parts.push({ text: system });
						if (user) parts.push({ text: user });
						if (audio) {
							parts.push({
								inline_data: {
									mime_type: audio.mime_type || 'audio/wav',
									data: audio.data,
								},
							});
						}
						geminiBody = { contents: [{ parts }] };
					}

					const response = await fetch(geminiUrl, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'x-goog-api-key': apiKey,
						},
						body: JSON.stringify(geminiBody),
					});

					if (!response.ok) {
						const errorData = await response.text();
						return new Response(JSON.stringify({ error: errorData }), {
							status: response.status,
							headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
						});
					}

					const data = await response.json();

					// Transform Gemini response to OpenAI SSE format for streaming clients
					if (stream) {
						// Extract text from Gemini response
						const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

						// Create SSE response in OpenAI format
						const sseData = `data: ${JSON.stringify({
							choices: [{ delta: { content: text } }]
						})}\n\ndata: [DONE]\n\n`;

						return new Response(sseData, {
							headers: {
								'Content-Type': 'text/event-stream',
								'Cache-Control': 'no-cache',
								'Connection': 'keep-alive',
								...CORS_HEADERS,
							},
						});
					}

					return new Response(JSON.stringify(data), {
						status: response.status,
						headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
					});
				}

				// Transform model format and determine endpoint
				// Frontend sends: provider/model or groq/provider/model
				// Transform to Cloudflare AI Gateway format
				let endpoint = 'compat';
				let transformedModel = model;

				if (model.startsWith('groq/')) {
					// Groq models: groq/provider/model -> provider/model, use /groq endpoint
					endpoint = 'groq';
					transformedModel = model.replace('groq/', '');
				} else if (model.startsWith('google/')) {
					// Google models: google/model -> google-ai-studio/model
					transformedModel = model.replace('google/', 'google-ai-studio/');
				}
				// OpenAI and Anthropic models stay as-is (openai/model, anthropic/model)

				// Build messages array from simple format or use provided messages
				let requestMessages;

				if (messages) {
					// Native format: use messages as-is
					requestMessages = messages;
				} else if (system || user) {
					// Simple format: transform to OpenAI-compatible
					requestMessages = [];
					if (system) requestMessages.push({ role: 'system', content: system });
					if (user) requestMessages.push({ role: 'user', content: user });
				} else {
					// Default fallback
					requestMessages = [{ role: 'user', content: 'Hello, world!' }];
				}

				// Call Cloudflare AI Gateway
				const gatewayUrl = `https://gateway.ai.cloudflare.com/v1/f107b4eef4a9b8eb99a9d1df6fac9ff2/brokenai/${endpoint}/chat/completions`;

				const response = await fetch(gatewayUrl, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${apiKey}`,
					},
					body: JSON.stringify({
						model: transformedModel,
						messages: requestMessages,
						stream: stream,
					}),
				});

				if (!response.ok) {
					const errorData = await response.text();
					return new Response(JSON.stringify({ error: errorData }), {
						status: response.status,
						headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
					});
				}

				// If streaming is enabled, pass through the stream
				if (stream && response.body) {
					return new Response(response.body, {
						headers: {
							'Content-Type': 'text/event-stream',
							'Cache-Control': 'no-cache',
							'Connection': 'keep-alive',
							...CORS_HEADERS,
						},
					});
				}

				// Non-streaming response
				const data = await response.json();
				return new Response(JSON.stringify(data), {
					status: response.status,
					headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
				});
			} catch (error) {
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
				});
			}
		}

		// Route: /api/groq-whisper - Groq Whisper transcription
		if (url.pathname === '/api/groq-whisper' && request.method === 'POST') {
			try {
				// Parse the FormData to get the API key
				const formData = await request.formData();
				const apiKey = formData.get('apiKey');

				console.log('[Worker] Groq Whisper request:', {
					hasApiKey: !!apiKey,
					apiKeyValue: apiKey,
					apiKeyType: typeof apiKey,
				});

				if (!apiKey || apiKey === '' || apiKey === 'undefined') {
					return new Response(JSON.stringify({ error: 'Groq API key is missing or invalid. Please configure your API key in Settings.' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
					});
				}

				// Remove apiKey from formData before forwarding
				formData.delete('apiKey');

				// Forward to Groq through Cloudflare AI Gateway
				const groqUrl = 'https://gateway.ai.cloudflare.com/v1/f107b4eef4a9b8eb99a9d1df6fac9ff2/brokenai/groq/audio/transcriptions';

				const response = await fetch(groqUrl, {
					method: 'POST',
					headers: {
						'Authorization': `Bearer ${apiKey}`,
					},
					body: formData,
				});

				const data = await response.json();

				return new Response(JSON.stringify(data), {
					status: response.status,
					headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
				});
			} catch (error) {
				return new Response(JSON.stringify({ error: error.message }), {
					status: 500,
					headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
				});
			}
		}

		// NOTE: Deepgram WebSocket endpoints removed
		// Worker-based WebSocket proxying doesn't work well with Deepgram
		// Frontend connects directly to Deepgram API using WebSocket from browser

		// Default route - health check
		if (url.pathname === '/' || url.pathname === '/health') {
			return new Response(JSON.stringify({ status: 'ok', service: 'brokenai' }), {
				headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
			});
		}

		// 404 for unknown routes
		return new Response('Not Found', {
			status: 404,
			headers: CORS_HEADERS,
		});
	},
} satisfies ExportedHandler<Env>;
