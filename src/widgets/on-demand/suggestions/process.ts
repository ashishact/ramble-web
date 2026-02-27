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
import { widgetRecordStore } from '../../../db/stores';
import type { MeetingSegment } from '../../../program/kernel/meetingStatus';

// (no localStorage key needed — storage is WatermelonDB via widgetRecordStore)

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
// WatermelonDB Persistence
// ============================================================================

const WIDGET_TYPE = 'suggestion';

/**
 * Save suggestions to WatermelonDB (fire-and-forget — never throws).
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
 * Load the latest suggestions from WatermelonDB with Zod validation.
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

const SYSTEM_PROMPT = `You analyze a user's memory and provide ACTIONABLE SUGGESTIONS - things they could do.

Your job is to SUGGEST SOLUTIONS and ACTIONS. Help the user by proposing what they should do.
- Provide concrete, actionable advice
- Suggest ways to accomplish their goals
- Offer optimizations or better approaches

STYLE:
- Clear and actionable (10-30 words)
- Suggestions and solutions, NOT questions

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
    { "text": "Consider setting up a weekly check-in with the team.", "topic": "Work / Project", "category": "action", "priority": "high" }
  ]
}

topic = "Domain / Topic" format (e.g., "Work / Planning", "Health / Exercise")

Actionable suggestions only. Be helpful and specific.`;

const TOPIC_FOCUSED_PROMPT = `Provide actionable suggestions about the topic specified in the user message.

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
    { "text": "Suggestion about the topic.", "topic": "Domain / Topic", "category": "action", "priority": "high" }
  ]
}

topic = "Domain / Topic" format

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

  const userPrompt = `Current time: ${wmData.userContext.currentTime}

## Current Working Memory
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
// Meeting mode prompts
// ============================================================================

const MEETING_SYSTEM_PROMPT = `You are a real-time meeting assistant. Help the user know what to SAY during a live meeting.

AUDIO SOURCES:
- [MIC] = the user (person you are helping)
- [SYSTEM] = remote participants (Zoom / Meet / Teams audio)

TASK: Based on the live transcript, generate 4 concrete things the user could SAY OR DO right now in response to what's being discussed.

Focus on:
- Direct responses to what [SYSTEM] participants just said
- Points the user could raise based on the current discussion
- Ideas or alternatives the user could contribute
- Action items the user could propose or commit to

AVOID:
- Restating what [MIC] already said
- Passive observations — make them actionable things to say
- Repeating suggestions already shown

Categories:
- action: Something to do or commit to right now
- next_step: A next step to propose to the group
- idea: A contribution or alternative angle to suggest
- optimization: A better approach or improvement to offer
- reminder: Something from earlier in the meeting worth bringing back up

Priority: high = say this now, medium = worth saying soon, low = if there's time

Return exactly 4 suggestions, last = most immediately relevant to the latest exchange.

JSON format:
{
  "suggestions": [
    { "text": "...", "topic": "Meeting / SubTopic", "category": "action", "priority": "high" }
  ]
}

topic = "Meeting / SubTopic" format. Phrase suggestions as things the user would actually say or do (10–30 words).`;

// ============================================================================
// Meeting mode process
// ============================================================================

/**
 * Generate response suggestions for the user based on the live meeting transcript.
 * Called during an active meeting when mode === 'meeting'.
 * Uses the last 40 segments for context, prefixed with [MIC] / [SYSTEM] labels.
 */
export async function generateMeetingSuggestions(
  segments: MeetingSegment[],
  previousSuggestions?: string[]
): Promise<SuggestionResult> {
  if (segments.length === 0) {
    return { suggestions: [], availableTopics: [], generatedAt: Date.now() };
  }

  const recentSegments = segments.slice(-40);
  const transcript = recentSegments
    .map(s => `[${s.audioType === 'mic' ? 'MIC' : 'SYSTEM'}] ${s.text}`)
    .join('\n');

  const previousSection = previousSuggestions && previousSuggestions.length > 0
    ? `\n## Suggestions already shown — do NOT repeat:\n${previousSuggestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
    : '';

  const userPrompt = `Current time: ${new Date().toLocaleTimeString()}

## Live Meeting Transcript (most recent last):
${transcript}
${previousSection}
Generate 4 things the user could say or do right now. Respond with JSON only.`;

  try {
    const response = await callLLM({
      tier: 'small',
      prompt: userPrompt,
      systemPrompt: MEETING_SYSTEM_PROMPT,
      options: { temperature: 0.7, max_tokens: 800 },
    });

    const { data, error } = parseLLMJSON(response.content);
    if (error || !data) {
      console.error('[Meeting Suggestions] Failed to parse response:', error);
      return { suggestions: [], availableTopics: [], generatedAt: Date.now() };
    }

    const suggestions = normalizeSuggestions(data);
    const availableTopics = [...new Set(
      suggestions.map(s => s.topic).filter(t => t !== 'General' && t !== 'Meeting')
    )];

    return { suggestions, availableTopics, generatedAt: Date.now() };
  } catch (error) {
    console.error('[Meeting Suggestions] Generation failed:', error);
    return { suggestions: [], availableTopics: [], generatedAt: Date.now() };
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

      // Handle topic - prefer new format, fall back to first relatedTopic
      let topic = typeof suggestion.topic === 'string' ? suggestion.topic.trim() : '';
      if (!topic && Array.isArray(suggestion.relatedTopics) && suggestion.relatedTopics.length > 0) {
        topic = String(suggestion.relatedTopics[0]);
      }

      return {
        id: `suggestion-${index}-${Date.now()}`,
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
