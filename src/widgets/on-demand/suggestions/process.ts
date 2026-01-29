/**
 * Suggestions Process
 *
 * Analyzes current working memory and provides actionable suggestions.
 * Results stored in profile-scoped localStorage for persistence across reloads.
 */

import { z } from 'zod';
import { callLLM } from '../../../program/llmClient';
import { workingMemory } from '../../../program/WorkingMemory';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';
import { profileStorage } from '../../../lib/profileStorage';

// ============================================================================
// Constants
// ============================================================================

const STORAGE_KEY = 'suggestions';

// ============================================================================
// Zod Schemas for validation
// ============================================================================

const SuggestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  category: z.enum(['action', 'optimization', 'reminder', 'idea', 'next_step']),
  relatedTopics: z.array(z.string()),
  priority: z.enum(['high', 'medium', 'low']),
});

const SuggestionResultSchema = z.object({
  suggestions: z.array(SuggestionSchema),
  availableTopics: z.array(z.string()),
  generatedAt: z.number(),
});

// ============================================================================
// Types (derived from Zod schemas)
// ============================================================================

export type Suggestion = z.infer<typeof SuggestionSchema>;
export type SuggestionResult = z.infer<typeof SuggestionResultSchema>;

// ============================================================================
// LocalStorage Persistence
// ============================================================================

/**
 * Save suggestions to profile-scoped storage
 */
export function saveSuggestionsToStorage(result: SuggestionResult): void {
  try {
    profileStorage.setJSON(STORAGE_KEY, result);
  } catch (error) {
    console.warn('Failed to save suggestions to storage:', error);
  }
}

/**
 * Load suggestions from profile-scoped storage with Zod validation
 * Returns null if not found or invalid
 */
export function loadSuggestionsFromStorage(): SuggestionResult | null {
  try {
    const parsed = profileStorage.getJSON<unknown>(STORAGE_KEY);
    if (!parsed) return null;

    const validated = SuggestionResultSchema.safeParse(parsed);

    if (validated.success) {
      return validated.data;
    } else {
      console.warn('Invalid suggestions in storage, clearing:', validated.error);
      profileStorage.removeItem(STORAGE_KEY);
      return null;
    }
  } catch (error) {
    console.warn('Failed to load suggestions from storage:', error);
    profileStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

/**
 * Clear suggestions from profile-scoped storage
 */
export function clearSuggestionsFromStorage(): void {
  profileStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You analyze a user's memory and provide ACTIONABLE SUGGESTIONS - things they could do.

Your job is to SUGGEST SOLUTIONS and ACTIONS. Help the user by proposing what they should do.
- Provide concrete, actionable advice
- Suggest ways to accomplish their goals
- Offer optimizations or better approaches

STYLE:
- Clear and actionable (10-30 words)
- Suggestions and solutions, NOT questions
- Examples: "Consider breaking the project into weekly sprints to track progress better." / "You could delegate the report to Sarah since she has experience with analytics."

Categories:
- action: Specific things to do now
- optimization: Ways to do something better
- reminder: Things not to forget
- idea: Creative approaches or alternatives
- next_step: What to do next in a process

Priority: high (urgent/important), medium (helpful), low (nice to have)

ORDERING: Return exactly 4 suggestions. Last one = most relevant to latest message.

IMPORTANT: If previous suggestions are provided, do NOT repeat them. Suggest NEW things.

JSON format:
{
  "suggestions": [
    { "text": "Consider setting up a weekly check-in with the team.", "category": "action", "relatedTopics": ["project"], "priority": "high" }
  ]
}

Actionable suggestions only. Be helpful and specific.`;

const TOPIC_FOCUSED_PROMPT = `Provide actionable suggestions about: {{TOPIC}}

Your job is to SUGGEST SOLUTIONS and ACTIONS about this topic.
- Provide concrete, actionable advice (10-30 words)
- Help the user accomplish their goals related to this topic

Categories:
- action: Specific things to do now
- optimization: Ways to do something better
- reminder: Things not to forget
- idea: Creative approaches or alternatives
- next_step: What to do next in a process

Priority: high (urgent/important), medium (helpful), low (nice to have)

Return exactly 4 suggestions. Last one = most relevant to latest message.

IMPORTANT: If previous suggestions are provided, do NOT repeat them. Suggest NEW things.

JSON format:
{
  "suggestions": [
    { "text": "Suggestion about the topic.", "category": "action", "relatedTopics": ["{{TOPIC}}"], "priority": "high" }
  ]
}

Actionable suggestions only. Be specific.`;

// ============================================================================
// Process
// ============================================================================

export async function generateSuggestions(
  focusTopic?: string,
  previousSuggestions?: string[]
): Promise<SuggestionResult> {
  // Build context using unified WorkingMemory (use 'small' for suggestions)
  // No session filter - fetches all conversations chronologically
  const wmData = await workingMemory.fetch({
    size: 'small',
  });

  // Extract available topics for filtering
  const availableTopics = workingMemory.extractTopics(wmData);

  // If context is empty, return early
  if (workingMemory.isEmpty(wmData)) {
    return {
      suggestions: [{
        id: 'start-1',
        text: 'Start by telling me about what you\'re working on or what you need help with',
        category: 'idea',
        relatedTopics: [],
        priority: 'medium',
      }],
      availableTopics: [],
      generatedAt: Date.now(),
    };
  }

  // Format context for LLM (exclude memories - conversations already contain the info)
  const contextPrompt = workingMemory.formatForLLM({ ...wmData, memories: [] });

  // Build prompt
  const systemPrompt = focusTopic
    ? TOPIC_FOCUSED_PROMPT.replace(/\{\{TOPIC\}\}/g, focusTopic)
    : SYSTEM_PROMPT;

  // Build previous suggestions section if available
  const previousSection = previousSuggestions && previousSuggestions.length > 0
    ? `\n## Previous Suggestions (already shown to user - suggest NEW things)
${previousSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`
    : '';

  const userPrompt = `## Current Working Memory
${contextPrompt}
${previousSection}
${focusTopic ? `Focus your suggestions on the topic: "${focusTopic}"\n` : ''}
Analyze this working memory and provide actionable suggestions. Avoid repeating previous suggestions. Respond with JSON only.`;

  try {
    const response = await callLLM({
      tier: 'small',
      prompt: userPrompt,
      systemPrompt,
      options: {
        temperature: 0.7,
        max_tokens: 1000,
      },
    });

    const { data, error } = parseLLMJSON(response.content);

    if (error || !data) {
      console.error('Failed to parse suggestions response:', error);
      return { suggestions: [], availableTopics, generatedAt: Date.now() };
    }

    return {
      suggestions: normalizeSuggestions(data),
      availableTopics,
      generatedAt: Date.now(),
    };
  } catch (error) {
    console.error('Suggestions process failed:', error);
    return { suggestions: [], availableTopics, generatedAt: Date.now() };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeSuggestions(data: unknown): Suggestion[] {
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  const rawSuggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];

  const validCategories = ['action', 'optimization', 'reminder', 'idea', 'next_step'];
  const validPriorities = ['high', 'medium', 'low'];

  return rawSuggestions
    .map((s, index) => {
      if (!s || typeof s !== 'object') return null;

      const suggestion = s as Record<string, unknown>;
      const text = typeof suggestion.text === 'string' ? suggestion.text.trim() : null;

      if (!text) return null;

      return {
        id: `suggestion-${index}-${Date.now()}`,
        text,
        category: validCategories.includes(suggestion.category as string)
          ? (suggestion.category as Suggestion['category'])
          : 'idea',
        relatedTopics: Array.isArray(suggestion.relatedTopics)
          ? suggestion.relatedTopics.filter((t): t is string => typeof t === 'string')
          : [],
        priority: validPriorities.includes(suggestion.priority as string)
          ? (suggestion.priority as Suggestion['priority'])
          : 'medium',
      };
    })
    .filter((s): s is Suggestion => s !== null);
}
