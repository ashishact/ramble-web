/**
 * Suggestions Process
 *
 * Analyzes current working memory and provides actionable suggestions.
 * Results stored in profile-scoped localStorage for persistence across reloads.
 */

import { z } from 'zod';
import { nid } from '../../../program/utils/id';
import { callLLM } from '../../../program/llmClient';
import { workingMemory } from '../../../program/WorkingMemory';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';
import { widgetRecordStore } from '../../../graph/stores/widgetRecordStore';
// (no localStorage key needed — storage is DuckDB via widgetRecordStore)

// ============================================================================
// Zod Schemas for validation
// ============================================================================

const SuggestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  topic: z.string(), // "Domain / Topic" format
  category: z.enum(['action', 'optimization', 'reminder', 'idea', 'next_step']),
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
// DuckDB Persistence
// ============================================================================

const WIDGET_TYPE = 'suggestion';

/**
 * Save suggestions to DuckDB (fire-and-forget — never throws).
 * Appends a new row each call; full generation history is preserved.
 */
export function saveSuggestionsToStorage(result: SuggestionResult): void {
  widgetRecordStore.create({
    type: WIDGET_TYPE,
    content: result,
    createdAt: result.generatedAt,
  }).catch(e => console.warn('Failed to save suggestions to DB:', e));
}

/**
 * Load the latest suggestions from DuckDB with Zod validation.
 * Returns null if not found or invalid.
 */
export async function loadSuggestionsFromStorage(): Promise<SuggestionResult | null> {
  try {
    const record = await widgetRecordStore.getLatest(WIDGET_TYPE);
    if (!record) return null;

    const validated = SuggestionResultSchema.safeParse(record.contentParsed);
    if (validated.success) {
      return validated.data;
    } else {
      console.warn('Invalid suggestions in DB:', validated.error);
      return null;
    }
  } catch (error) {
    console.warn('Failed to load suggestions from DB:', error);
    return null;
  }
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You are an advisor who reads a user's memory and gives CONCRETE RECOMMENDATIONS — declarative answers, not questions.

CRITICAL RULE: Every output must be a STATEMENT or RECOMMENDATION, never a question.
❌ BAD: "Have you considered using a project tracker?"
❌ BAD: "What about delegating that task?"
✓ GOOD: "Use a project tracker to unblock the team bottleneck."
✓ GOOD: "Delegate the onboarding doc to someone with more context on it."

Context is annotated with relative time (e.g., [just now], [2 min ago], [3 days ago]). The latest input is highlighted separately. Prioritize suggestions about what the user is currently talking about. Older context is background — only reference it if the latest input relates to it.

Your job: Given what you know about the user, tell them WHAT TO DO. Be specific. Use the context.
- Reference concrete details from their memory (names, projects, deadlines, goals)
- Give the specific action, not a vague "you could consider" prompt

Categories:
- action: Do this specific thing right now
- optimization: A better way to handle something they're already doing
- reminder: Something time-sensitive they mentioned but haven't acted on
- idea: A concrete alternative approach or solution to a known problem
- next_step: The clear next move in an ongoing process

Priority is determined by recency and impact — a suggestion for the latest input is higher priority than one for older context. high (urgent, recent, or blocks something), medium (will help soon), low (nice to have, older context).

Return 1 to 4 suggestions — only as many as are genuinely warranted. If only 1 or 2 are clearly useful, return just those. Last one = most directly relevant to the latest message.
Do NOT repeat previous suggestions — find new angles.

JSON format:
{
  "suggestions": [
    { "text": "Book the venue this week — you mentioned the date is in 3 weeks.", "topic": "Events / Planning", "category": "reminder", "priority": "high" },
    { "text": "Switch to async updates with the Tokyo team to avoid the timezone lag.", "topic": "Work / Communication", "category": "optimization", "priority": "medium" }
  ]
}

topic = "Domain / Topic" format. Statements and recommendations only — no questions.`;

const TOPIC_FOCUSED_PROMPT = `You are an advisor giving CONCRETE RECOMMENDATIONS about a specific topic — declarative answers, not questions.

CRITICAL RULE: Every output must be a STATEMENT or RECOMMENDATION, never a question.
❌ BAD: "Have you thought about X?"
✓ GOOD: "Do X — it directly addresses the issue you mentioned."

Use specific details from the user's memory to make recommendations relevant to the given topic.
Reference real context (names, dates, projects) when available.

Categories:
- action: Do this specific thing right now
- optimization: A better approach to something they're already doing
- reminder: Something time-sensitive they haven't acted on yet
- idea: A concrete alternative or solution to a known problem
- next_step: The clear next move in an ongoing process

Priority: high (urgent or blocking), medium (helpful soon), low (nice to have)

Return 1 to 4 suggestions — only as many as are genuinely useful for this topic. Do NOT repeat previous ones — find new angles.

JSON format:
{
  "suggestions": [
    { "text": "Recommendation about the topic.", "topic": "Domain / Topic", "category": "action", "priority": "high" }
  ]
}

topic = "Domain / Topic" format. Statements only — no questions.`;

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
        topic: 'General',
        category: 'idea',
        priority: 'medium',
      }],
      availableTopics: [],
      generatedAt: Date.now(),
    };
  }

  // Format context for LLM (exclude memories - conversations already contain the info)
  const contextPrompt = workingMemory.formatForLLM({ ...wmData, memories: [] });

  // Build prompt
  const systemPrompt = focusTopic ? TOPIC_FOCUSED_PROMPT : SYSTEM_PROMPT;

  // Build previous suggestions section if available
  const previousSection = previousSuggestions && previousSuggestions.length > 0
    ? `\n## Previous Suggestions (already shown to user - suggest NEW things)
${previousSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`
    : '';

  // Extract the latest conversation text to highlight it explicitly
  const latestConv = wmData.conversations.length > 0
    ? wmData.conversations[wmData.conversations.length - 1].text
    : null;

  const latestSection = latestConv
    ? `\n## Latest Input (anchor your suggestions here)\n${latestConv}\n`
    : '';

  const userPrompt = `Current time: ${wmData.userContext.currentTime}

## Working Memory
${contextPrompt}
${latestSection}${previousSection}
${focusTopic ? `Focus your suggestions on the topic: "${focusTopic}"\n` : ''}
Give concrete recommendations based on this context. Use specific details from the memory. Write declarative statements — never questions. Avoid repeating previous suggestions. Respond with JSON only.`;

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
    .map((s) => {
      if (!s || typeof s !== 'object') return null;

      const suggestion = s as Record<string, unknown>;
      const text = typeof suggestion.text === 'string' ? suggestion.text.trim() : null;

      if (!text) return null;

      // Handle topic - prefer new format, fall back to first relatedTopic
      let topic = typeof suggestion.topic === 'string' ? suggestion.topic.trim() : '';
      if (!topic && Array.isArray(suggestion.relatedTopics) && suggestion.relatedTopics.length > 0) {
        topic = String(suggestion.relatedTopics[0]);
      }

      return {
        id: nid('sg'),
        text,
        topic: topic || 'General',
        category: validCategories.includes(suggestion.category as string)
          ? (suggestion.category as Suggestion['category'])
          : 'idea',
        priority: validPriorities.includes(suggestion.priority as string)
          ? (suggestion.priority as Suggestion['priority'])
          : 'medium',
      };
    })
    .filter((s): s is Suggestion => s !== null);
}
