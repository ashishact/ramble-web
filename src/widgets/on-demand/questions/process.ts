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
import type { MeetingSegment } from '../../../program/kernel/meetingStatus';

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

const SYSTEM_PROMPT = `You analyze a user's memory to identify GAPS - missing information they should provide.

Your job is GAP ANALYSIS. You prompt the user to SPEAK MORE, not give solutions.
- Frame everything as SHORT questions or prompts
- Identify what's incomplete, vague, or unexplored
- Encourage the user to add more context

STYLE:
- Brief but clear (10-20 words)
- Questions or prompts, NOT solutions

Categories:
- missing_info: Missing details (deadlines, names, numbers, context)
- follow_up: What naturally comes next in conversation
- clarification: Vague or ambiguous things
- action: Decisions pending or next steps unclear
- explore: Topics to dig deeper into

Priority: high (critical gaps), medium (helpful), low (nice to have)

ORDERING: Return exactly 4 questions. Last one = most relevant to latest message.

IMPORTANT: If previous questions are provided, do NOT repeat them. Find NEW gaps to explore.

JSON format:
{
  "questions": [
    { "text": "When is that due?", "topic": "Work / Project", "category": "missing_info", "priority": "high" }
  ]
}

topic = "Domain / Topic" format (e.g., "Work / Planning", "Health / Exercise")

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

Return exactly 4 questions. Last one = most relevant to latest message.

IMPORTANT: If previous questions are provided, do NOT repeat them. Find NEW gaps.

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

  const userPrompt = `Current time: ${wmData.userContext.currentTime}

## Current Working Memory
${contextPrompt}
${previousSection}
${focusTopic ? `Focus your analysis on the topic: "${focusTopic}"\n` : ''}
Analyze this working memory and identify gaps. Avoid repeating previous questions. Respond with JSON only.`;

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
// Meeting mode prompts
// ============================================================================

const MEETING_SYSTEM_PROMPT = `You are a real-time meeting assistant. Help the user identify the best questions to ask other participants during a live meeting.

AUDIO SOURCES:
- [MIC] = the user (person you are helping)
- [SYSTEM] = remote participants (Zoom / Meet / Teams audio)

TASK: Based on the live transcript, generate 4 targeted questions the user could ASK THE OTHER PARTICIPANTS right now.

Focus on:
- Gaps or ambiguities in what [SYSTEM] participants said
- Claims or decisions that need more detail
- Next steps or ownership that are unclear
- Things raised by [SYSTEM] the user should probe deeper

AVOID:
- Questions about what [MIC] already said (they know what they said)
- Generic filler questions
- Repeating questions already shown

Categories:
- clarification: Something vague or ambiguous a [SYSTEM] participant said
- missing_info: Important information that wasn't covered
- follow_up: Dig deeper into a point [SYSTEM] made
- action: Clarify ownership, next steps, or deadlines
- explore: Open up a related angle worth investigating

Priority: high = urgent or important right now, medium = helpful, low = nice to have

Return exactly 4 questions, last = most immediately relevant to the latest exchange.

JSON format:
{
  "questions": [
    { "text": "...", "topic": "Meeting / SubTopic", "category": "clarification", "priority": "high" }
  ]
}

topic = "Meeting / SubTopic" format. Keep questions concise (10–25 words).`;

// ============================================================================
// Meeting mode process
// ============================================================================

/**
 * Generate questions to ask other meeting participants based on the live transcript.
 * Called during an active meeting when mode === 'meeting'.
 * Uses the last 40 segments for context, prefixed with [MIC] / [SYSTEM] labels.
 */
export async function generateMeetingQuestions(
  segments: MeetingSegment[],
  previousQuestions?: string[]
): Promise<QuestionResult> {
  if (segments.length === 0) {
    return { questions: [], availableTopics: [], generatedAt: Date.now() };
  }

  // Use last 40 segments for focused context
  const recentSegments = segments.slice(-40);
  const transcript = recentSegments
    .map(s => `[${s.audioType === 'mic' ? 'MIC' : 'SYSTEM'}] ${s.text}`)
    .join('\n');

  const previousSection = previousQuestions && previousQuestions.length > 0
    ? `\n## Questions already shown — do NOT repeat:\n${previousQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n`
    : '';

  const userPrompt = `Current time: ${new Date().toLocaleTimeString()}

## Live Meeting Transcript (most recent last):
${transcript}
${previousSection}
Generate 4 questions to ask the [SYSTEM] participants right now. Respond with JSON only.`;

  try {
    const response = await callLLM({
      tier: 'small',
      prompt: userPrompt,
      systemPrompt: MEETING_SYSTEM_PROMPT,
      options: { temperature: 0.7, max_tokens: 800 },
    });

    const { data, error } = parseLLMJSON(response.content);
    if (error || !data) {
      console.error('[Meeting Questions] Failed to parse response:', error);
      return { questions: [], availableTopics: [], generatedAt: Date.now() };
    }

    const questions = normalizeQuestions(data);
    // Derive available topics from the questions' topic fields
    const availableTopics = [...new Set(
      questions.map(q => q.topic).filter(t => t !== 'General' && t !== 'Meeting')
    )];

    return { questions, availableTopics, generatedAt: Date.now() };
  } catch (error) {
    console.error('[Meeting Questions] Generation failed:', error);
    return { questions: [], availableTopics: [], generatedAt: Date.now() };
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
