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

// Maximum characters to send to LLM (roughly ~4000 tokens)
// High limit since we're only sending one conversation, not full working memory
const MAX_INPUT_CHARS = 8000;

// ============================================================================
// Zod Schemas
// ============================================================================

const SuggestionSchema = z.object({
	original: z.string(),
	improved: z.string(),
	reason: z.string(),
	category: z.enum(['vocabulary', 'conciseness', 'clarity', 'tone', 'grammar']),
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

const SYSTEM_PROMPT = `You are a language coach helping someone speak more eloquently and concisely.

Your job is to analyze what someone said and show them how they could have said it better.

FOCUS AREAS:
1. **Vocabulary**: Suggest richer, more precise words. English has many synonyms with subtle differences - help them learn the right word for the right context.
   - Example: "sad" → "melancholic", "dejected", "crestfallen" (each has different nuance)
   - Example: "crying" → "weeping" (grief), "sobbing" (intense), "whimpering" (quiet)

2. **Conciseness**: Remove filler words, redundancy, and rambling. Get to the point.
   - Example: "I was thinking that maybe we could possibly try to..." → "Let's try..."

3. **Clarity**: Make the message clearer and more direct.

4. **Tone**: Suggest more appropriate tone when needed.

5. **Grammar**: Fix any grammatical issues.

RESPONSE FORMAT (JSON):
{
  "betterVersion": "The complete rewritten text - concise and eloquent",
  "suggestions": [
    {
      "original": "the exact phrase from their text",
      "improved": "better way to say it",
      "reason": "brief explanation (10-15 words)",
      "category": "vocabulary|conciseness|clarity|tone|grammar"
    }
  ],
  "vocabularyTips": [
    "Word X means Y - use it when Z (brief tip about a word they could learn)"
  ]
}

GUIDELINES:
- Be constructive, not critical
- Focus on 2-4 most impactful suggestions
- Include 1-2 vocabulary tips with words they could add to their repertoire
- The better version should sound natural, not overly formal
- Keep explanations brief`;

// ============================================================================
// Process
// ============================================================================

export async function analyzeText(conversationId: string, text: string): Promise<AnalysisResult> {
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
		};
	}

	// Truncate if too long
	const truncated = text.length > MAX_INPUT_CHARS;
	const inputText = truncated ? text.slice(0, MAX_INPUT_CHARS) + '...' : text;
	const inputChars = inputText.length;

	const userPrompt = `Analyze this speech and show me how I could have said it better:

"${inputText}"

Respond with JSON only.`;

	try {
		const response = await callLLM({
			tier: 'large', // Use best model for quality suggestions
			prompt: userPrompt,
			systemPrompt: SYSTEM_PROMPT,
			options: {
				temperature: 0.7,
				max_tokens: 1500,
			},
		});

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
			};
		}

		const result = normalizeResult(conversationId, inputText, data, inputChars, outputChars, truncated);
		saveToStorage(result);
		return result;
	} catch (error) {
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
	truncated: boolean
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
				if (typeof sug.original === 'string' && typeof sug.improved === 'string') {
					suggestions.push({
						original: sug.original,
						improved: sug.improved,
						reason: typeof sug.reason === 'string' ? sug.reason : '',
						category: validCategories.includes(sug.category as string)
							? (sug.category as Suggestion['category'])
							: 'clarity',
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
	};
}
