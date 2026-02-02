/**
 * Speak Better Process
 *
 * Analyzes user's speech and suggests improvements:
 * - Better vocabulary choices
 * - More concise phrasing
 * - Proper word usage in context
 *
 * Uses the large tier LLM for best quality suggestions.
 * Results stored in profile-scoped localStorage for persistence.
 */

import { z } from 'zod';
import { callLLM } from '../../../program/llmClient';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';
import { profileStorage } from '../../../lib/profileStorage';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'speak-better';
const TONE_STORAGE_KEY = 'speak-better-tone';

// Maximum characters to send to LLM (roughly ~4000 tokens)
// High limit since we're only sending one conversation, not full working memory
const MAX_INPUT_CHARS = 8000;

// ============================================================================
// Tones
// ============================================================================

export const TONES = {
	professional: {
		label: 'Professional',
		description: 'Polished, formal, business-appropriate',
		prompt: 'Rewrite in a professional, polished tone suitable for business or formal settings. Use proper vocabulary and maintain credibility.',
	},
	casual: {
		label: 'Casual',
		description: 'Relaxed, everyday conversation',
		prompt: 'Rewrite in a casual, relaxed tone like talking to a friend. Use everyday language, contractions, and a conversational flow.',
	},
	friendly: {
		label: 'Friendly',
		description: 'Warm, approachable, personable',
		prompt: 'Rewrite in a warm, friendly tone that feels approachable and personable. Be genuine and create connection.',
	},
	witty: {
		label: 'Witty',
		description: 'Clever, playful, subtle humor',
		prompt: 'Rewrite with wit and clever wordplay. Add subtle humor or playfulness while keeping the message clear. Be smart, not silly.',
	},
	direct: {
		label: 'Direct',
		description: 'Straight to the point, no fluff',
		prompt: 'Rewrite to be extremely direct and to the point. Remove all unnecessary words. Be clear and assertive.',
	},
	diplomatic: {
		label: 'Diplomatic',
		description: 'Tactful, considerate, balanced',
		prompt: 'Rewrite diplomatically, being tactful and considerate of different perspectives. Soften harsh statements while preserving the message.',
	},
	enthusiastic: {
		label: 'Enthusiastic',
		description: 'Energetic, positive, excited',
		prompt: 'Rewrite with enthusiasm and positive energy. Show genuine excitement while keeping it natural, not over-the-top.',
	},
	storytelling: {
		label: 'Storytelling',
		description: 'Narrative, engaging, vivid',
		prompt: 'Rewrite with a storytelling flair. Make it engaging and vivid, drawing the listener in with narrative elements.',
	},
} as const;

export type ToneId = keyof typeof TONES;
export const DEFAULT_TONE: ToneId = 'casual';

// Tone storage functions
export function saveTone(tone: ToneId): void {
	try {
		profileStorage.setItem(TONE_STORAGE_KEY, tone);
	} catch (error) {
		console.warn('Failed to save tone:', error);
	}
}

export function loadTone(): ToneId {
	try {
		const stored = profileStorage.getItem(TONE_STORAGE_KEY);
		if (stored && stored in TONES) {
			return stored as ToneId;
		}
	} catch (error) {
		console.warn('Failed to load tone:', error);
	}
	return DEFAULT_TONE;
}

// ============================================================================
// Zod Schemas
// ============================================================================

const SuggestionSchema = z.object({
	improved: z.string(), // "first two ... last two" words to locate phrase in betterVersion
	reason: z.string(), // What was changed
	category: z.enum(['vocabulary', 'conciseness', 'clarity', 'tone', 'grammar']),
	principle: z.string(), // The underlying rule/learning (e.g., "Active voice is more direct")
	alternative: z.string().optional(), // Another way to phrase it (vocabulary expansion)
});

const AnalysisResultSchema = z.object({
	conversationId: z.string(), // Track which conversation was analyzed
	originalText: z.string(),
	betterVersion: z.string(),
	suggestions: z.array(SuggestionSchema),
	vocabularyTips: z.array(z.string()),
	generatedAt: z.number(),
	// Context tracking
	inputChars: z.number(),
	outputChars: z.number(),
	truncated: z.boolean(),
	durationMs: z.number(), // Time taken for LLM call in milliseconds
});

// ============================================================================
// Types
// ============================================================================

export type Suggestion = z.infer<typeof SuggestionSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ============================================================================
// Storage
// ============================================================================

export function saveToStorage(result: AnalysisResult): void {
	try {
		profileStorage.setJSON(STORAGE_KEY, result);
	} catch (error) {
		console.warn('Failed to save speak-better result:', error);
	}
}

export function loadFromStorage(): AnalysisResult | null {
	try {
		const parsed = profileStorage.getJSON<unknown>(STORAGE_KEY);
		if (!parsed) return null;

		const validated = AnalysisResultSchema.safeParse(parsed);
		if (validated.success) {
			return validated.data;
		} else {
			console.warn('Invalid speak-better data in storage:', validated.error);
			profileStorage.removeItem(STORAGE_KEY);
			return null;
		}
	} catch (error) {
		console.warn('Failed to load speak-better from storage:', error);
		return null;
	}
}

// ============================================================================
// Prompt
// ============================================================================

function buildSystemPrompt(tone: ToneId): string {
	const toneConfig = TONES[tone];

	return `You are a language coach helping someone speak more effectively and concisely.

Your job is to analyze what someone said and show them how they could have said it better.

TARGET TONE: ${toneConfig.label.toUpperCase()}
${toneConfig.prompt}

FOCUS AREAS:
1. **Vocabulary**: Suggest words that fit the ${toneConfig.label.toLowerCase()} tone. Help them learn the right word for the right context.
   - Match vocabulary to the tone (e.g., casual tone uses everyday words, professional uses polished terms)

2. **Conciseness**: Remove filler words, redundancy, and rambling. Get to the point.
   - Example: "I was thinking that maybe we could possibly try to..." → "Let's try..."

3. **Clarity**: Make the message clearer while maintaining the ${toneConfig.label.toLowerCase()} tone.

4. **Flow**: Ensure the rewrite sounds natural for the chosen tone.

5. **Grammar**: Fix any grammatical issues.

RESPONSE FORMAT (JSON):
{
  "betterVersion": "The complete rewritten text in a ${toneConfig.label.toLowerCase()} tone",
  "suggestions": [
    {
      "improved": "first two ... last two",
      "reason": "What was changed (brief)",
      "category": "vocabulary|conciseness|clarity|tone|grammar",
      "principle": "The underlying rule to remember",
      "alternative": "Another way to phrase it (optional)"
    }
  ],
  "vocabularyTips": [
    "Word X means Y - use it when Z"
  ]
}

IMPORTANT for "improved" field:
- Write the FIRST 2 WORDS and LAST 2 WORDS of the improved phrase from betterVersion
- Format: "first second ... second-last last"
- Example: If betterVersion contains "I believe we should proceed carefully", write "I believe ... proceed carefully"
- This helps locate which part of betterVersion this suggestion refers to

GUIDELINES:
- Be constructive, not critical
- Focus on 2-4 most impactful suggestions
- Include 1-2 vocabulary tips appropriate for the ${toneConfig.label.toLowerCase()} tone
- The better version must match the ${toneConfig.label.toUpperCase()} tone - ${toneConfig.description}
- Keep explanations brief`;
}

// ============================================================================
// Process
// ============================================================================

export async function analyzeText(conversationId: string, text: string, tone: ToneId = DEFAULT_TONE): Promise<AnalysisResult> {
	if (!text.trim()) {
		return {
			conversationId,
			originalText: '',
			betterVersion: '',
			suggestions: [],
			vocabularyTips: [],
			generatedAt: Date.now(),
			inputChars: 0,
			outputChars: 0,
			truncated: false,
			durationMs: 0,
		};
	}

	// Truncate if too long
	const truncated = text.length > MAX_INPUT_CHARS;
	const inputText = truncated ? text.slice(0, MAX_INPUT_CHARS) + '...' : text;
	const inputChars = inputText.length;

	const toneConfig = TONES[tone];
	const userPrompt = `Analyze this speech and show me how I could have said it better in a ${toneConfig.label.toLowerCase()} tone:

"${inputText}"

Respond with JSON only.`;

	const startTime = performance.now();

	try {
		const response = await callLLM({
			tier: 'large', // Use best model for quality suggestions
			prompt: userPrompt,
			systemPrompt: buildSystemPrompt(tone),
			options: {
				temperature: 0.7,
				max_tokens: 1500,
			},
		});

		const durationMs = Math.round(performance.now() - startTime);
		const { data, error } = parseLLMJSON(response.content);

		const outputChars = response.content.length;

		if (error || !data) {
			console.error('Failed to parse speak-better response:', error);
			return {
				conversationId,
				originalText: inputText,
				betterVersion: '',
				suggestions: [],
				vocabularyTips: [],
				generatedAt: Date.now(),
				inputChars,
				outputChars,
				truncated,
				durationMs,
			};
		}

		const result = normalizeResult(conversationId, inputText, data, inputChars, outputChars, truncated, durationMs);
		saveToStorage(result);
		return result;
	} catch (error) {
		const durationMs = Math.round(performance.now() - startTime);
		console.error('Speak-better analysis failed:', error);
		return {
			conversationId,
			originalText: inputText,
			betterVersion: '',
			suggestions: [],
			vocabularyTips: [],
			generatedAt: Date.now(),
			inputChars,
			outputChars: 0,
			truncated,
			durationMs,
		};
	}
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeResult(
	conversationId: string,
	originalText: string,
	data: unknown,
	inputChars: number,
	outputChars: number,
	truncated: boolean,
	durationMs: number
): AnalysisResult {
	if (!data || typeof data !== 'object') {
		return {
			conversationId,
			originalText,
			betterVersion: '',
			suggestions: [],
			vocabularyTips: [],
			generatedAt: Date.now(),
			inputChars,
			outputChars,
			truncated,
			durationMs,
		};
	}

	const obj = data as Record<string, unknown>;

	const betterVersion = typeof obj.betterVersion === 'string' ? obj.betterVersion : '';

	const suggestions: Suggestion[] = [];
	if (Array.isArray(obj.suggestions)) {
		const validCategories = ['vocabulary', 'conciseness', 'clarity', 'tone', 'grammar'];
		for (const s of obj.suggestions) {
			if (s && typeof s === 'object') {
				const sug = s as Record<string, unknown>;
				if (typeof sug.reason === 'string' && sug.reason.trim()) {
					suggestions.push({
						improved: typeof sug.improved === 'string' ? sug.improved : '',
						reason: sug.reason,
						category: validCategories.includes(sug.category as string)
							? (sug.category as Suggestion['category'])
							: 'clarity',
						principle: typeof sug.principle === 'string' ? sug.principle : '',
						alternative: typeof sug.alternative === 'string' ? sug.alternative : undefined,
					});
				}
			}
		}
	}

	const vocabularyTips: string[] = [];
	if (Array.isArray(obj.vocabularyTips)) {
		for (const tip of obj.vocabularyTips) {
			if (typeof tip === 'string' && tip.trim()) {
				vocabularyTips.push(tip.trim());
			}
		}
	}

	return {
		conversationId,
		originalText,
		betterVersion,
		suggestions,
		vocabularyTips,
		generatedAt: Date.now(),
		inputChars,
		outputChars,
		truncated,
		durationMs,
	};
}
