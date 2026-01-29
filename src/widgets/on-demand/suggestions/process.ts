/**
 * Suggestion Process
 *
 * Analyzes current working memory and suggests what to talk about.
 * Results stored in profile-scoped localStorage for persistence across reloads.
 */

import { z } from 'zod';
import { callLLM } from '../../../program/llmClient';
import { workingMemory } from '../../../program/WorkingMemory';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';
import { getKernel } from '../../../program/kernel/kernel';
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
  category: z.enum(['missing_info', 'follow_up', 'clarification', 'action', 'explore']),
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

const SYSTEM_PROMPT = `You are an assistant that analyzes a user's working memory and conversation history to suggest what they should talk about next.

Your job is to perform a GAP ANALYSIS:
1. Identify incomplete information (e.g., todos without deadlines, people without context)
2. Find opportunities for clarification
3. Suggest follow-up questions
4. Identify actionable items that need more detail
5. Spot topics that could be explored further

Categories:
- missing_info: Information that would complete an existing memory (deadlines, details, context)
- follow_up: Natural next things to discuss based on recent conversation
- clarification: Ambiguous items that need clarification
- action: Actionable suggestions (decisions to make, things to do)
- explore: Topics worth exploring deeper

Priority levels:
- high: Critical missing information or time-sensitive
- medium: Would significantly improve knowledge
- low: Nice to have, exploratory

IMPORTANT ORDERING:
- Return exactly 4 suggestions, ordered from older context to newest
- The LAST suggestion (4th) should be MOST motivated by the user's most recent message
- Earlier suggestions can reference older conversation context
- This ordering allows the user to focus on the most recent/relevant suggestion at the bottom

Respond with a JSON object containing an array of suggestions:
{
  "suggestions": [
    {
      "text": "Add a deadline for your 'finish project' todo",
      "category": "missing_info",
      "relatedTopics": ["project", "todos"],
      "priority": "high"
    }
  ]
}

Be specific and actionable. Return exactly 4 suggestions, with the last one being most relevant to the latest user message.`;

const TOPIC_FOCUSED_PROMPT = `You are an assistant analyzing a user's working memory with a FOCUS on a specific topic.

Focus Topic: {{TOPIC}}

Generate suggestions specifically related to this topic:
1. What information about this topic is incomplete?
2. What follow-up questions would deepen understanding?
3. What actions related to this topic need more detail?
4. What connections to other topics could be explored?

Categories:
- missing_info: Information that would complete knowledge about this topic
- follow_up: Natural next things to discuss about this topic
- clarification: Ambiguous aspects that need clarification
- action: Actionable suggestions related to this topic
- explore: Related areas worth exploring

IMPORTANT ORDERING:
- Return exactly 4 suggestions, ordered from older context to newest
- The LAST suggestion (4th) should be MOST motivated by the user's most recent message
- Earlier suggestions can reference older conversation context
- This ordering allows the user to focus on the most recent/relevant suggestion at the bottom

Respond with JSON:
{
  "suggestions": [
    {
      "text": "Specific suggestion about the topic",
      "category": "missing_info",
      "relatedTopics": ["topic1"],
      "priority": "high"
    }
  ]
}

Be specific and actionable. Return exactly 4 suggestions focused on the topic, with the last one being most relevant to the latest user message.`;

// ============================================================================
// Process
// ============================================================================

export async function generateSuggestions(
  focusTopic?: string
): Promise<SuggestionResult> {
  const kernel = getKernel();
  const session = kernel.getCurrentSession();

  if (!session) {
    return {
      suggestions: [],
      availableTopics: [],
      generatedAt: Date.now(),
    };
  }

  // Build context using unified WorkingMemory (use 'small' for suggestions)
  const wmData = await workingMemory.fetch({
    size: 'small',
    sessionId: session.id,
  });

  // Extract available topics for filtering
  const availableTopics = workingMemory.extractTopics(wmData);

  // If context is empty, return early
  if (workingMemory.isEmpty(wmData)) {
    return {
      suggestions: [{
        id: 'start-1',
        text: 'Start by telling me about your day or what\'s on your mind',
        category: 'explore',
        relatedTopics: [],
        priority: 'medium',
      }],
      availableTopics: [],
      generatedAt: Date.now(),
    };
  }

  // Format context for LLM
  const contextPrompt = workingMemory.formatForLLM(wmData);

  // Build prompt
  const systemPrompt = focusTopic
    ? TOPIC_FOCUSED_PROMPT.replace('{{TOPIC}}', focusTopic)
    : SYSTEM_PROMPT;

  const userPrompt = `## Current Working Memory
${contextPrompt}

${focusTopic ? `\nFocus your analysis on the topic: "${focusTopic}"\n` : ''}
Analyze this working memory and suggest what should be discussed. Respond with JSON only.`;

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
      console.error('Failed to parse suggestion response:', error);
      return { suggestions: [], availableTopics, generatedAt: Date.now() };
    }

    return {
      suggestions: normalizeSuggestions(data),
      availableTopics,
      generatedAt: Date.now(),
    };
  } catch (error) {
    console.error('Suggestion process failed:', error);
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

  const validCategories = ['missing_info', 'follow_up', 'clarification', 'action', 'explore'];
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
          : 'explore',
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
