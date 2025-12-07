/**
 * Suggestion Observer (2nd Observer)
 *
 * Uses Groq (openai/gpt-oss-120b) for fast inference to:
 * - Generate clarifying questions
 * - Suggest essential missing information
 * - Propose ways to enrich the knowledge
 * - Gently nudge toward novel ideas
 *
 * Runs after Knowledge Observer completes
 */

import { groqGptOss, type Message as ChatMessage } from '../cfGateway';
import {
  observerHelpers,
  type KnowledgeItem,
  type SuggestionContent,
} from '../../stores/observerStore';
import { settingsHelpers } from '../../stores/settingsStore';

// Response schema for LLM
interface SuggestionResponse {
  suggestions: {
    type: 'question' | 'improvement' | 'nudge' | 'essential';
    text: string;
    priority: number; // 1-5, higher is more important
  }[];
}

/**
 * Build the system prompt for suggestion generation
 */
function buildSystemPrompt(): string {
  return `You are an inquisitive assistant helping a user develop their thoughts and ideas.

Your job is to analyze the user's RECENT conversation and knowledge, then suggest ONLY NEW suggestions that haven't been made before.

Suggestion types:
1. QUESTION: Clarifying questions to understand better
2. ESSENTIAL: Critical missing information that should be captured
3. IMPROVEMENT: Ways to enrich or expand on existing knowledge
4. NUDGE: Gentle suggestions toward novel ideas or unexplored directions

CRITICAL RULES:
- Generate ONLY NEW suggestions based on the LATEST messages and knowledge
- You will be given a list of PREVIOUS SUGGESTIONS - DO NOT repeat or rephrase these
- If there's nothing new to suggest, return an empty suggestions array
- Focus on what's NEW, INTERESTING, or UNCLEAR in the recent content
- Keep suggestions concise and actionable
- Limit to 2-4 truly new and relevant suggestions
- Prioritize from 1 (nice to have) to 5 (critical)

Respond ONLY with valid JSON matching this schema:
{
  "suggestions": [
    {
      "type": "question|essential|improvement|nudge",
      "text": "The suggestion text",
      "priority": 1-5
    }
  ]
}

If there are no new suggestions to make, respond with: {"suggestions": []}`;
}

/**
 * Limit messages based on character count
 * Returns messages that fit within the character budget
 */
function limitMessagesByCharCount(messages: string[], maxChars = 2000, maxCount = 5): string[] {
  const result: string[] = [];
  let totalChars = 0;

  // Take from the end (most recent) first
  for (let i = messages.length - 1; i >= 0 && result.length < maxCount; i--) {
    const msg = messages[i];
    if (totalChars + msg.length <= maxChars) {
      result.unshift(msg); // Add to beginning to maintain order
      totalChars += msg.length;
    } else if (result.length === 0) {
      // Always include at least the most recent message (truncated if needed)
      result.unshift(msg.substring(0, maxChars));
      break;
    } else {
      break; // Stop if we can't fit more
    }
  }

  return result;
}

/**
 * Build the user prompt with context
 */
function buildUserPrompt(
  knowledgeItems: KnowledgeItem[],
  currentState: Record<string, unknown>,
  recentMessages: string[],
  previousSuggestions: SuggestionContent[]
): string {
  // Limit messages by character count (max 2000 chars, max 5 messages)
  const limitedMessages = limitMessagesByCharCount(recentMessages, 2000, 5);

  // Summarize only the most recent knowledge items (last 5)
  const knowledgeSummary = knowledgeItems
    .slice(-5)
    .flatMap(k => k.contents.map(c => `- ${c.text}`))
    .join('\n');

  // Format previous suggestions
  const previousSuggestionsText = previousSuggestions.length > 0
    ? previousSuggestions.map(s => `- [${s.type}] ${s.text}`).join('\n')
    : 'None yet';

  return `=== RECENT MESSAGES (newest last) ===
${limitedMessages.map(m => `> ${m}`).join('\n')}

=== RECENT KNOWLEDGE ITEMS ===
${knowledgeSummary || 'No knowledge items yet'}

=== PREVIOUS SUGGESTIONS (DO NOT REPEAT THESE) ===
${previousSuggestionsText}

=== SESSION STATE ===
${JSON.stringify(currentState, null, 2)}

Based on the RECENT messages and knowledge above, generate NEW suggestions that are different from the previous suggestions. Focus on what's new or unclear in the latest content.`;
}

/**
 * Parse the LLM response
 * @throws Error if JSON cannot be parsed
 */
function parseResponse(responseText: string): SuggestionResponse {
  // Try to extract JSON from the response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[SuggestionObserver] No JSON found in response');
    console.error('[SuggestionObserver] Raw response:', responseText);
    throw new Error('No JSON found in LLM response');
  }

  let parsed: SuggestionResponse;

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[SuggestionObserver] Failed to parse JSON:', error);
    console.error('[SuggestionObserver] Raw response:', responseText);
    throw new Error(`Failed to parse JSON: ${error}`);
  }

  // Validate structure
  if (!Array.isArray(parsed.suggestions)) {
    parsed.suggestions = [];
  }

  // Validate each suggestion
  parsed.suggestions = parsed.suggestions.filter((s: {type?: string; text?: string; priority?: number}) => {
    const validTypes = ['question', 'improvement', 'nudge', 'essential'];
    return (
      s &&
      typeof s.text === 'string' &&
      validTypes.includes(s.type || '') &&
      typeof s.priority === 'number'
    );
  });

  return parsed;
}

/**
 * Generate suggestions based on current session state
 */
export async function generateSuggestions(sessionId: string): Promise<void> {
  console.log('[SuggestionObserver] Generating suggestions for session:', sessionId);

  // Get API key
  const apiKey = settingsHelpers.getApiKey('groq');
  if (!apiKey) {
    throw new Error('Groq API key not configured');
  }

  // Get session data
  const session = observerHelpers.getSession(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Get knowledge items and recent messages
  const knowledgeItems = observerHelpers.getKnowledgeItems(sessionId);
  const messages = observerHelpers.getRecentMessages(sessionId, 10);
  const recentMessages = messages.map(m => m.raw);

  // Get previous suggestions (last 10) to avoid repetition
  const existingSuggestions = observerHelpers.getSuggestions(sessionId);
  const previousSuggestions: SuggestionContent[] = existingSuggestions
    .slice(-10) // Take last 10 (most recent, since sorted ascending)
    .flatMap(s => s.contents);

  console.log('[SuggestionObserver] Found', previousSuggestions.length, 'previous suggestion contents to avoid');

  // Skip if no content
  if (knowledgeItems.length === 0 && messages.length === 0) {
    console.log('[SuggestionObserver] No content to analyze, skipping');
    return;
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(knowledgeItems, session.state, recentMessages, previousSuggestions);

  // Call LLM
  const chatMessages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  console.log('[SuggestionObserver] Calling Groq GPT-OSS...');
  console.log('[SuggestionObserver] User prompt:', userPrompt);
  const responseText = await groqGptOss.chat(apiKey, chatMessages, systemPrompt);
  console.log('[SuggestionObserver] Raw response:', responseText);

  // Parse response (will throw on failure)
  const response = parseResponse(responseText);

  console.log('[SuggestionObserver] Parsed response:', JSON.stringify(response, null, 2));
  console.log('[SuggestionObserver] Generated', response.suggestions.length, 'suggestions');

  // Save suggestions if any
  if (response.suggestions.length > 0) {
    const contents: SuggestionContent[] = response.suggestions.map(s => ({
      type: s.type,
      text: s.text,
      priority: Math.min(5, Math.max(1, s.priority)),
    }));

    console.log('[SuggestionObserver] Saving contents to store:', JSON.stringify(contents, null, 2));
    console.log('[SuggestionObserver] SessionId:', sessionId);
    const saved = observerHelpers.addSuggestion(sessionId, contents);
    console.log('[SuggestionObserver] Saved suggestion with id:', saved.id);
  } else {
    console.log('[SuggestionObserver] No suggestions to save (empty array)');
  }

  console.log('[SuggestionObserver] Completed for session:', sessionId);
}
