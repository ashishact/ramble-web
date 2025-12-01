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

Your job is to analyze the user's conversation and knowledge base, then suggest:
1. QUESTIONS: Clarifying questions to understand better
2. ESSENTIAL: Critical missing information that should be captured
3. IMPROVEMENT: Ways to enrich or expand on existing knowledge
4. NUDGE: Gentle suggestions toward novel ideas or unexplored directions

GUIDELINES:
- Be curious and exploratory, not judgmental
- Focus on what's interesting or unclear
- Suggest connections between ideas
- Keep suggestions concise and actionable
- Limit to 3-5 most relevant suggestions
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
}`;
}

/**
 * Build the user prompt with context
 */
function buildUserPrompt(
  knowledgeItems: KnowledgeItem[],
  currentState: Record<string, unknown>,
  recentMessages: string[]
): string {
  // Summarize knowledge items
  const knowledgeSummary = knowledgeItems
    .slice(-10) // Last 10 items
    .flatMap(k => k.contents.map(c => `- ${c.text}`))
    .join('\n');

  return `Current session state:
${JSON.stringify(currentState, null, 2)}

Recent messages:
${recentMessages.map(m => `> ${m}`).join('\n')}

Knowledge captured so far:
${knowledgeSummary || 'No knowledge items yet'}

Based on this conversation and knowledge, what suggestions do you have for the user?`;
}

/**
 * Parse the LLM response
 */
function parseResponse(responseText: string): SuggestionResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[SuggestionObserver] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

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
  } catch (error) {
    console.error('[SuggestionObserver] Failed to parse response:', error);
    console.error('[SuggestionObserver] Raw response:', responseText);
    return null;
  }
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

  // Skip if no content
  if (knowledgeItems.length === 0 && messages.length === 0) {
    console.log('[SuggestionObserver] No content to analyze, skipping');
    return;
  }

  // Build prompts
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(knowledgeItems, session.state, recentMessages);

  // Call LLM
  const chatMessages: ChatMessage[] = [
    { role: 'user', content: userPrompt },
  ];

  console.log('[SuggestionObserver] Calling Groq GPT-OSS...');
  const responseText = await groqGptOss.chat(apiKey, chatMessages, systemPrompt);

  // Parse response
  const response = parseResponse(responseText);
  if (!response) {
    console.error('[SuggestionObserver] Failed to parse response, skipping');
    return;
  }

  console.log('[SuggestionObserver] Generated', response.suggestions.length, 'suggestions');

  // Save suggestions if any
  if (response.suggestions.length > 0) {
    const contents: SuggestionContent[] = response.suggestions.map(s => ({
      type: s.type,
      text: s.text,
      priority: Math.min(5, Math.max(1, s.priority)),
    }));

    observerHelpers.addSuggestion(sessionId, contents);
  }

  console.log('[SuggestionObserver] Completed for session:', sessionId);
}
