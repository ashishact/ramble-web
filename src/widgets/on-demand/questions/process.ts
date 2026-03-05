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
import { analyzeTreeGaps, type TreeGap } from './treeGapAnalysis';
// (no localStorage key needed — storage is WatermelonDB via widgetRecordStore)

// ============================================================================
// Zod Schemas for validation
// ============================================================================

const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  topic: z.string(), // "Domain / Topic" format
  category: z.enum(['gap', 'depth', 'staleness', 'missing_info', 'follow_up', 'clarification', 'action', 'explore']),
  priority: z.enum(['high', 'medium', 'low']),
  targetEntity: z.string().optional(),
  targetNode: z.string().optional(),
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

const CONVERSATION_ONLY_SYSTEM_PROMPT = `You analyze a user's conversation to identify GAPS — missing information they should provide.

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

Return 1 question — only if there is a real gap. If previous questions are provided, find NEW gaps.

JSON format:
{
  "questions": [
    { "text": "When is that due?", "topic": "Work / Project", "category": "missing_info", "priority": "high" }
  ]
}

topic = "Domain / Topic" format

SHORT questions that prompt more input. No solutions.`;

const TREE_GUIDED_SYSTEM_PROMPT = `You analyze a user's conversation AND knowledge gaps to generate targeted questions.

You have two signal sources:
1. **Conversation context** — what the user recently said
2. **Knowledge gaps** — structural holes in their knowledge trees (provided as a list)

Your job: generate SHORT questions (10-20 words) that prompt the user to SPEAK MORE. Connect every question to what the user recently said — don't ask about gaps in isolation.

Categories:
- gap: Missing information in a knowledge tree node (empty or very thin)
- depth: Entity mentioned many times but tree has little content — dig deeper
- staleness: Information that hasn't been updated in a while — refresh it
- follow_up: What naturally comes next in conversation
- clarification: Vague or ambiguous things

Priority rules:
1. Gaps in recently mentioned entities > co-occurring entities > staleness
2. A gap in the latest input is higher priority than older context

Optional fields — include when the question targets a specific tree node:
- targetEntity: the entity name the question is about
- targetNode: the tree node label (e.g. "Location", "Role")

Return 1 to 3 questions — only as many as there are real gaps. Prefer gap/depth/staleness over follow_up when knowledge gaps exist.

JSON format:
{
  "questions": [
    { "text": "Where exactly is that office located?", "topic": "Work / Company", "category": "gap", "priority": "high", "targetEntity": "Acme Corp", "targetNode": "Location" }
  ]
}

topic = "Domain / Topic" format

SHORT questions that prompt more input. No solutions.`;

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
        category: 'follow_up',
        priority: 'medium',
      }],
      availableTopics: [],
      generatedAt: Date.now(),
    };
  }

  // Extract conversation entity IDs for tree gap analysis
  const conversationEntityIds = wmData.entities.map(e => e.id);

  // Analyze knowledge tree gaps
  let treeGaps: TreeGap[] = [];
  try {
    treeGaps = await analyzeTreeGaps(conversationEntityIds, 8);
  } catch (e) {
    console.warn('Tree gap analysis failed, falling back to conversation-only:', e);
  }

  // Filter gaps by topic if focused
  if (focusTopic && treeGaps.length > 0) {
    const topicLower = focusTopic.toLowerCase();
    treeGaps = treeGaps.filter(g =>
      g.entityName.toLowerCase().includes(topicLower) ||
      g.nodePath.toLowerCase().includes(topicLower)
    );
  }

  // Choose system prompt based on whether we have tree gaps
  const hasTreeGaps = treeGaps.length > 0;
  const systemPrompt = hasTreeGaps ? TREE_GUIDED_SYSTEM_PROMPT : CONVERSATION_ONLY_SYSTEM_PROMPT;

  // Format context for LLM (exclude memories - conversations already contain the info)
  const contextPrompt = workingMemory.formatForLLM({ ...wmData, memories: [] });

  // Build knowledge gaps section
  const gapsSection = hasTreeGaps
    ? `\n## Knowledge Gaps\n${treeGaps.map((g, i) =>
        `${i + 1}. [${g.mode}] ${g.entityName} (${g.entityType}) → ${g.nodePath}: ${g.detail}`
      ).join('\n')}\n`
    : '';

  // Build previous questions section if available
  const previousSection = previousQuestions && previousQuestions.length > 0
    ? `\n## Previous Questions (already shown to user - ask NEW things)\n${previousQuestions.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`
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
${latestSection}${gapsSection}${previousSection}
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

const VALID_CATEGORIES: Question['category'][] = ['gap', 'depth', 'staleness', 'missing_info', 'follow_up', 'clarification', 'action', 'explore'];
const VALID_PRIORITIES: Question['priority'][] = ['high', 'medium', 'low'];

function normalizeQuestions(data: unknown): Question[] {
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;
  // Accept both 'questions' and 'suggestions' keys from LLM response for backwards compatibility
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions :
                       Array.isArray(obj.suggestions) ? obj.suggestions : [];

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

      // Normalize category
      const rawCategory = question.category as string;
      const category: Question['category'] = VALID_CATEGORIES.includes(rawCategory as Question['category'])
        ? (rawCategory as Question['category'])
        : 'follow_up';

      return {
        id: `question-${index}-${Date.now()}`,
        text,
        topic: topic || 'General',
        category,
        priority: VALID_PRIORITIES.includes(question.priority as Question['priority'])
          ? (question.priority as Question['priority'])
          : 'medium',
        ...(typeof question.targetEntity === 'string' && { targetEntity: question.targetEntity }),
        ...(typeof question.targetNode === 'string' && { targetNode: question.targetNode }),
      };
    })
    .filter((s): s is Question => s !== null);
}
