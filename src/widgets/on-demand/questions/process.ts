/**
 * Questions Process
 *
 * Analyzes current working memory and identifies gaps - prompting user to provide more info.
 * Results stored in profile-scoped localStorage for persistence across reloads.
 */

import { z } from 'zod';
import { callLLM } from '../../../program/llmClient';
import { workingMemory } from '../../../program/WorkingMemory';
import { parseLLMJSON } from '../../../program/utils/jsonUtils';
import { widgetRecordStore } from '../../../db/stores';
import { eventBus } from '../../../lib/eventBus';
// (no localStorage key needed — storage is WatermelonDB via widgetRecordStore)

// ============================================================================
// Zod Schemas for validation
// ============================================================================

const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  topic: z.string(), // "Domain / Topic" format
  category: z.enum(['missing_info', 'follow_up', 'clarification', 'action', 'explore']),
  priority: z.enum(['high', 'medium', 'low']),
});

const QuestionResultSchema = z.object({
  questions: z.array(QuestionSchema),
  availableTopics: z.array(z.string()),
  generatedAt: z.number(),
});

// ============================================================================
// Types (derived from Zod schemas)
// ============================================================================

export type Question = z.infer<typeof QuestionSchema>;
export type QuestionResult = z.infer<typeof QuestionResultSchema>;

// ============================================================================
// WatermelonDB Persistence
// ============================================================================

const WIDGET_TYPE = 'question';

/**
 * Save questions to WatermelonDB (fire-and-forget — never throws).
 * Appends a new row each call; full generation history is preserved.
 */
export function saveQuestionsToStorage(result: QuestionResult): void {
  widgetRecordStore.create({
    type: WIDGET_TYPE,
    content: result,
    createdAt: result.generatedAt,
  }).then(() => {
    eventBus.emit('questions:updated', { questions: result.questions });
  }).catch(e => console.warn('Failed to save questions to DB:', e));
}

/**
 * Load the latest questions from WatermelonDB with Zod validation.
 * Returns null if not found or invalid.
 */
export async function loadQuestionsFromStorage(): Promise<QuestionResult | null> {
  try {
    const record = await widgetRecordStore.getLatest(WIDGET_TYPE);
    if (!record) return null;

    const validated = QuestionResultSchema.safeParse(record.contentParsed);
    if (validated.success) {
      return validated.data;
    } else {
      console.warn('Invalid questions in DB:', validated.error);
      return null;
    }
  } catch (error) {
    console.warn('Failed to load questions from DB:', error);
    return null;
  }
}

// ============================================================================
// Prompts
// ============================================================================

const SYSTEM_PROMPT = `You analyze a user's conversation to identify GAPS — missing information they should provide.

Your job is GAP ANALYSIS. Prompt the user to SPEAK MORE, not give solutions.
Frame everything as SHORT questions or prompts (10-20 words). Identify what's incomplete, vague, or unexplored.

Context is annotated with relative time (e.g., [just now], [2 min ago], [3 days ago]). The latest input is highlighted separately. Prioritize questions about what the user is currently talking about. Older context is background — only ask about it if the user's latest input relates to it.

Categories:
- missing_info: Missing details (deadlines, names, numbers, context)
- follow_up: What naturally comes next in conversation
- clarification: Vague or ambiguous things
- action: Decisions pending or next steps unclear
- explore: Topics to dig deeper into

Priority is determined by recency and criticalness — a gap in the latest input is higher priority than a gap in older context. high (critical gap in recent input), medium (helpful), low (nice to have, older context).

Return 1 to 4 questions — only as many as there are real gaps. If previous questions are provided, find NEW gaps.

JSON format:
{
  "questions": [
    { "text": "When is that due?", "topic": "Work / Project", "category": "missing_info", "priority": "high" }
  ]
}

topic = "Domain / Topic" format

SHORT questions that prompt more input. No solutions.`;

const TOPIC_FOCUSED_PROMPT = `Analyze gaps in the user's memory about the topic specified in the user message.

Your job is GAP ANALYSIS. Prompt the user to SPEAK MORE about this topic.
- Frame as brief but clear questions or prompts (10-20 words)
- What's missing, vague, or unexplored about this topic?

Categories:
- missing_info: Missing details about this topic
- follow_up: What comes next regarding this topic
- clarification: Vague aspects of this topic
- action: Unclear decisions or next steps
- explore: Related areas to dig into

Priority: high (critical), medium (helpful), low (nice to have)

Return 1 to 4 questions — only as many as there are genuine gaps about this topic. Do NOT repeat previous ones. Find NEW gaps.

JSON format:
{
  "questions": [
    { "text": "Question about the topic?", "topic": "Domain / Topic", "category": "missing_info", "priority": "high" }
  ]
}

topic = "Domain / Topic" format

Brief questions only. No solutions.`;

// ============================================================================
// Process
// ============================================================================

export async function generateQuestions(
  focusTopic?: string,
  previousQuestions?: string[]
): Promise<QuestionResult> {
  // Build context using unified WorkingMemory (use 'small' for questions)
  // No session filter - fetches all conversations chronologically
  const wmData = await workingMemory.fetch({
    size: 'small',
  });

  // Extract available topics for filtering
  const availableTopics = workingMemory.extractTopics(wmData);

  // If context is empty, return early
  if (workingMemory.isEmpty(wmData)) {
    return {
      questions: [{
        id: 'start-1',
        text: 'Start by telling me about your day or what\'s on your mind',
        topic: 'General',
        category: 'explore',
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

  // Build previous questions section if available
  const previousSection = previousQuestions && previousQuestions.length > 0
    ? `\n## Previous Questions (already shown to user - ask NEW things)
${previousQuestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}
`
    : '';

  // Extract the latest conversation text to highlight it explicitly
  const latestConv = wmData.conversations.length > 0
    ? wmData.conversations[wmData.conversations.length - 1].text
    : null;

  const latestSection = latestConv
    ? `\n## Latest Input (anchor your questions here)\n${latestConv}\n`
    : '';

  const userPrompt = `Current time: ${wmData.userContext.currentTime}

## Working Memory
${contextPrompt}
${latestSection}${previousSection}
${focusTopic ? `Focus your analysis on the topic: "${focusTopic}"\n` : ''}
Analyze and identify gaps. Respond with JSON only.`;

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
      console.error('Failed to parse questions response:', error);
      return { questions: [], availableTopics, generatedAt: Date.now() };
    }

    return {
      questions: normalizeQuestions(data),
      availableTopics,
      generatedAt: Date.now(),
    };
  } catch (error) {
    console.error('Questions process failed:', error);
    return { questions: [], availableTopics, generatedAt: Date.now() };
  }
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeQuestions(data: unknown): Question[] {
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  // Accept both 'questions' and 'suggestions' keys from LLM response for backwards compatibility
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions :
                       Array.isArray(obj.suggestions) ? obj.suggestions : [];

  const validCategories = ['missing_info', 'follow_up', 'clarification', 'action', 'explore'];
  const validPriorities = ['high', 'medium', 'low'];

  return rawQuestions
    .map((s, index) => {
      if (!s || typeof s !== 'object') return null;

      const question = s as Record<string, unknown>;
      const text = typeof question.text === 'string' ? question.text.trim() : null;

      if (!text) return null;

      // Handle topic - prefer new format, fall back to first relatedTopic
      let topic = typeof question.topic === 'string' ? question.topic.trim() : '';
      if (!topic && Array.isArray(question.relatedTopics) && question.relatedTopics.length > 0) {
        topic = String(question.relatedTopics[0]);
      }

      return {
        id: `question-${index}-${Date.now()}`,
        text,
        topic: topic || 'General',
        category: validCategories.includes(question.category as string)
          ? (question.category as Question['category'])
          : 'explore',
        priority: validPriorities.includes(question.priority as string)
          ? (question.priority as Question['priority'])
          : 'medium',
      };
    })
    .filter((s): s is Question => s !== null);
}
