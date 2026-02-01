/**
 * Meta Query Lens - Processing Logic
 *
 * ARCHITECTURE DECISION: Lens Data Persistence
 * =============================================
 * Lens widgets store their data in profileStorage (localStorage), NOT the database.
 *
 * WHY NOT DATABASE:
 * 1. **Ephemeral by Design**: Lens queries are "meta queries" - they examine the conversation
 *    without becoming part of it. Saving to DB would pollute the conversation history.
 * 2. **Fast Access**: localStorage is synchronous and fast. No async DB queries needed.
 * 3. **Profile Isolation**: profileStorage already provides per-profile namespacing.
 * 4. **Schema Validation**: We use Zod to validate data on load, handling corruption gracefully.
 *
 * DATA LIFECYCLE:
 * - On query: Save result to profileStorage
 * - On widget load: Restore last query/response from profileStorage
 * - On invalid data: Clear and start fresh (no crash)
 */

import { z } from 'zod';
import { profileStorage } from '../../../lib/profileStorage';
import { workingMemory } from '../../../program/WorkingMemory';
import { callLLM } from '../../../program/llmClient';

const STORAGE_KEY = 'lens:meta-query';

// Zod schema for validation
const LensHistoryItemSchema = z.object({
	query: z.string(),
	response: z.string(),
	timestamp: z.number(),
});

const LensDataSchema = z.object({
	lastQuery: z.string().optional(),
	lastResponse: z.string().optional(),
	history: z.array(LensHistoryItemSchema).optional(),
	generatedAt: z.number(),
});

export type LensData = z.infer<typeof LensDataSchema>;
export type LensHistoryItem = z.infer<typeof LensHistoryItemSchema>;

/**
 * Save lens data with validation
 */
export function saveLensData(data: LensData): void {
	try {
		profileStorage.setJSON(STORAGE_KEY, data);
	} catch (error) {
		console.warn('[MetaQueryLens] Failed to save lens data:', error);
	}
}

/**
 * Load and validate lens data
 * Returns null if data is missing or invalid (handles gracefully)
 */
export function loadLensData(): LensData | null {
	try {
		const raw = profileStorage.getJSON<unknown>(STORAGE_KEY);
		if (!raw) return null;

		const validated = LensDataSchema.safeParse(raw);
		if (validated.success) {
			return validated.data;
		} else {
			console.warn('[MetaQueryLens] Invalid lens data in storage, clearing:', validated.error);
			profileStorage.removeItem(STORAGE_KEY);
			return null;
		}
	} catch (error) {
		console.warn('[MetaQueryLens] Failed to load lens data:', error);
		profileStorage.removeItem(STORAGE_KEY);
		return null;
	}
}

/**
 * Process a meta query against the working memory
 *
 * Uses the tier-based LLM abstraction (callLLM) - the configured provider/model
 * is resolved automatically based on user settings. We use 'small' tier for
 * meta queries since they're quick lookups, not complex reasoning.
 */
export async function processMetaQuery(query: string): Promise<string> {
	// Fetch current working memory context
	const wmData = await workingMemory.fetch({ size: 'medium' });
	const contextPrompt = workingMemory.formatForLLM(wmData);

	// Build the meta query prompt
	const systemPrompt = `You are a helpful assistant that answers questions about the user's conversation history and context.
You have access to the user's recent conversations, entities, topics, memories, and goals.
Answer their question directly and concisely based on the available context.
If the answer isn't in the context, say so honestly.

AVAILABLE CONTEXT:
${contextPrompt}`;

	try {
		// Use the tier-based LLM abstraction - provider/model resolved from settings
		const response = await callLLM({
			tier: 'small', // Meta queries are quick lookups, use small tier
			prompt: query,
			systemPrompt,
			options: {
				temperature: 0.7,
				max_tokens: 500,
			},
		});

		const content = response.content;

		// Save to history
		const existing = loadLensData();
		const historyItem: LensHistoryItem = {
			query,
			response: content,
			timestamp: Date.now(),
		};

		saveLensData({
			lastQuery: query,
			lastResponse: content,
			history: [...(existing?.history || []).slice(-9), historyItem], // Keep last 10
			generatedAt: Date.now(),
		});

		return content;
	} catch (error) {
		console.error('[MetaQueryLens] Processing error:', error);
		return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
	}
}
