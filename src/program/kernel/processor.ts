/**
 * Input Processor
 *
 * Core processing logic:
 * 1. Build context
 * 2. Call LLM with structured prompt
 * 3. Parse response and update DB
 */

import { callLLM } from '../llmClient';
import { buildContext, formatContextForLLM, type Context } from './contextBuilder';
import { findPhoneticMatches, findSpellingMatches, formatMatchesForLLM } from '../services/phoneticMatcher';
import { parseLLMJSON } from '../utils/jsonUtils';
import {
  entityStore,
  topicStore,
  memoryStore,
  goalStore,
  extractionLogStore,
  correctionStore,
} from '../../db/stores';
import { runPlugins, type PluginOutput } from '../plugins';
import { createLogger } from '../utils/logger';

const logger = createLogger('Pipeline');

// ============================================================================
// Types
// ============================================================================

export interface ProcessingResult {
  // New/updated entities
  entities: Array<{
    id: string;
    name: string;
    type: string;
    isNew: boolean;
  }>;

  // New/updated topics
  topics: Array<{
    id: string;
    name: string;
    isNew: boolean;
  }>;

  // New memories created
  memories: Array<{
    id: string;
    content: string;
    type: string;
  }>;

  // Goal updates
  goalUpdates: Array<{
    id: string;
    type: 'new' | 'progress' | 'achieved' | 'referenced';
  }>;

  // Plugin outputs
  pluginOutputs: PluginOutput[];

  // Raw LLM response for debugging
  rawResponse: string;
}

// ============================================================================
// Normalized Extraction Types
// ============================================================================

// Normalized extraction (after parsing LLM response)
interface NormalizedExtraction {
  entities: Array<{ name: string; type: string }>;
  topics: Array<{ name: string; category?: string }>;
  memories: Array<{ content: string; type: string; importance?: number; subject?: string }>;
  goals: Array<{ statement: string; type: string; status?: string; progress?: number }>;
  corrections: Array<{ wrong: string; correct: string }>;
}

/**
 * Normalize a single entity (handles string or object)
 */
function normalizeEntity(e: unknown): { name: string; type: string } | null {
  if (typeof e === 'string' && e.trim()) {
    return { name: e.trim(), type: 'unknown' };
  }
  if (e && typeof e === 'object') {
    const obj = e as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : null;
    if (name) {
      return { name, type: typeof obj.type === 'string' ? obj.type : 'unknown' };
    }
  }
  return null;
}

/**
 * Normalize a single topic (handles string or object)
 */
function normalizeTopic(t: unknown): { name: string; category?: string } | null {
  if (typeof t === 'string' && t.trim()) {
    return { name: t.trim() };
  }
  if (t && typeof t === 'object') {
    const obj = t as Record<string, unknown>;
    const name = typeof obj.name === 'string' ? obj.name.trim() : null;
    if (name) {
      return { name, category: typeof obj.category === 'string' ? obj.category : undefined };
    }
  }
  return null;
}

/**
 * Normalize a single memory (handles string or object)
 */
function normalizeMemory(m: unknown): { content: string; type: string; importance?: number; subject?: string } | null {
  if (typeof m === 'string' && m.trim()) {
    return { content: m.trim(), type: 'fact' };
  }
  if (m && typeof m === 'object') {
    const obj = m as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content.trim() : null;
    if (content) {
      return {
        content,
        type: typeof obj.type === 'string' ? obj.type : 'fact',
        importance: typeof obj.importance === 'number' ? obj.importance : undefined,
        subject: typeof obj.subject === 'string' ? obj.subject : undefined,
      };
    }
  }
  return null;
}

/**
 * Normalize a single goal (handles string or object with statement/content)
 */
function normalizeGoal(g: unknown): { statement: string; type: string; status?: string; progress?: number } | null {
  if (typeof g === 'string' && g.trim()) {
    return { statement: g.trim(), type: 'general' };
  }
  if (g && typeof g === 'object') {
    const obj = g as Record<string, unknown>;
    // Try statement first, then content
    const statement = typeof obj.statement === 'string' ? obj.statement.trim() :
                      typeof obj.content === 'string' ? obj.content.trim() : null;
    if (statement) {
      return {
        statement,
        type: typeof obj.type === 'string' ? obj.type : 'general',
        status: typeof obj.status === 'string' ? obj.status : undefined,
        progress: typeof obj.progress === 'number' ? obj.progress : undefined,
      };
    }
  }
  return null;
}

/**
 * Normalize a single correction
 */
function normalizeCorrection(c: unknown): { wrong: string; correct: string } | null {
  if (c && typeof c === 'object') {
    const obj = c as Record<string, unknown>;
    const wrong = typeof obj.wrong === 'string' ? obj.wrong.trim() : null;
    const correct = typeof obj.correct === 'string' ? obj.correct.trim() : null;
    if (wrong && correct) {
      return { wrong, correct };
    }
  }
  return null;
}

/**
 * Normalize LLM extraction to consistent format
 * Each item is validated independently - bad items are skipped, good ones are kept
 */
function normalizeExtraction(raw: unknown): NormalizedExtraction {
  const result: NormalizedExtraction = {
    entities: [],
    topics: [],
    memories: [],
    goals: [],
    corrections: [],
  };

  if (!raw || typeof raw !== 'object') {
    return result;
  }

  const obj = raw as Record<string, unknown>;

  // Normalize entities - each independently
  if (Array.isArray(obj.entities)) {
    for (const e of obj.entities) {
      const normalized = normalizeEntity(e);
      if (normalized) result.entities.push(normalized);
    }
  }

  // Normalize topics - each independently
  if (Array.isArray(obj.topics)) {
    for (const t of obj.topics) {
      const normalized = normalizeTopic(t);
      if (normalized) result.topics.push(normalized);
    }
  }

  // Normalize memories - each independently
  if (Array.isArray(obj.memories)) {
    for (const m of obj.memories) {
      const normalized = normalizeMemory(m);
      if (normalized) result.memories.push(normalized);
    }
  }

  // Normalize goals - each independently
  if (Array.isArray(obj.goals)) {
    for (const g of obj.goals) {
      const normalized = normalizeGoal(g);
      if (normalized) result.goals.push(normalized);
    }
  }

  // Normalize corrections - each independently
  if (Array.isArray(obj.corrections)) {
    for (const c of obj.corrections) {
      const normalized = normalizeCorrection(c);
      if (normalized) result.corrections.push(normalized);
    }
  }

  return result;
}

// ============================================================================
// System Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are analyzing a conversation to extract structured knowledge.

Given the user's latest input and the context, extract:

1. **entities**: People, places, organizations, projects, or named concepts.
   Do NOT include: dates, times, numbers, or temporal expressions.
2. **topics**: Themes or subjects being discussed
3. **memories**: Facts, beliefs, preferences, concerns, or intentions to remember
4. **goals**: Goals mentioned - can be new goals, progress updates, or completions
5. **corrections**: STT errors you can identify

IMPORTANT:
- Check if names in the input might be mishearings of Known Entities listed in the context.
- Speech-to-text often mishears names. If a name sounds similar to a known entity, use the known entity.
- Prefer matching against existing entities rather than creating duplicates.

GOALS - Active goals are listed in the context. Goal extraction format:
- {"statement": "...", "type": "personal|work|health|etc"} - for new goals
- {"statement": "...", "status": "achieved"} - when a goal is completed
- {"statement": "...", "status": "progress", "progress": 0-100} - for progress updates

Respond with a JSON object. Only include fields with actual content.

Example response:
{
  "entities": [
    {"name": "Alice", "type": "person"}
  ],
  "memories": [
    {"content": "Alice is the project lead", "type": "fact", "importance": 0.8}
  ]
}

Be concise. Only extract what's clearly stated or strongly implied.`;

// ============================================================================
// Processor
// ============================================================================

/**
 * Process a user input through the core loop
 */
export async function processInput(
  sessionId: string,
  conversationId: string,
  inputText: string,
  source: 'speech' | 'text' = 'text'
): Promise<ProcessingResult> {
  const startTime = Date.now();

  logger.info('Processing input', { sessionId, inputLength: inputText.length, source });

  // 1. Build context
  const context = await buildContext(sessionId, inputText);
  const contextPrompt = formatContextForLLM(context);

  // 2. Run correction analysis based on source
  let correctionSection = '';
  if (source === 'speech') {
    // Full phonetic analysis for speech - STT makes phonetic errors
    const phoneticMatches = await findPhoneticMatches(inputText);
    const phoneticHints = formatMatchesForLLM(phoneticMatches);
    if (phoneticHints) {
      correctionSection = `\n${phoneticHints}\n`;
    }
  } else {
    // Light spelling check for text - just note that typos are possible
    const spellingMatches = await findSpellingMatches(inputText);
    if (spellingMatches.length > 0) {
      const hints = spellingMatches.map(m => `- "${m.inputWord}" might be "${m.matchedEntity}"`);
      correctionSection = `\n## Possible Typos (verify if relevant)\n${hints.join('\n')}\n`;
    }
  }

  // 3. Build prompt
  const userPrompt = `## Context
${contextPrompt}
${correctionSection}
## New Input
${inputText}

Extract entities, topics, memories, and goals from the new input. Respond with JSON only.`;

  // 4. Call LLM
  let llmResponse: string;
  try {
    const response = await callLLM({
      tier: 'small', // Use cheap tier for extraction
      prompt: userPrompt,
      systemPrompt: SYSTEM_PROMPT,
      options: {
        temperature: 0.3, // Low temperature for structured output
        max_tokens: 1000,
      },
    });
    llmResponse = response.content;
  } catch (error) {
    logger.error('LLM call failed', { error });
    throw error;
  }

  // 4. Parse and normalize response (each item validated independently)
  let extraction: NormalizedExtraction;

  // Parse JSON with auto-repair for malformed responses
  const { data: rawJson, error: parseError, repaired } = parseLLMJSON(llmResponse);

  if (parseError || !rawJson) {
    logger.error('Failed to parse LLM response', { error: parseError, response: llmResponse });
    await extractionLogStore.create({
      pluginId: 'core-processor',
      conversationId,
      sessionId,
      inputText,
      output: {},
      llmPrompt: userPrompt,
      llmResponse,
      processingTimeMs: Date.now() - startTime,
      success: false,
      error: `Parse error: ${parseError}`,
    });
    throw new Error(parseError || 'Failed to parse JSON');
  }

  if (repaired) {
    logger.info('Repaired malformed JSON from LLM response');
  }

  // Normalize each item independently - bad items skipped, good ones kept
  extraction = normalizeExtraction(rawJson);

  logger.debug('Normalized extraction', {
    entities: extraction.entities.length,
    topics: extraction.topics.length,
    memories: extraction.memories.length,
    goals: extraction.goals.length,
  });

  // 5. Save to DB (extraction is now normalized and validated)
  const result = await saveExtraction(sessionId, conversationId, extraction, context);

  // 6. Log success
  await extractionLogStore.create({
    pluginId: 'core-processor',
    conversationId,
    sessionId,
    inputText,
    output: extraction as unknown as Record<string, unknown>,
    llmPrompt: userPrompt,
    llmResponse,
    processingTimeMs: Date.now() - startTime,
    success: true,
  });

  // 7. Run plugins
  const pluginOutputs = await runPlugins(inputText, conversationId, sessionId);

  // 8. Handle plugin outputs (e.g., corrections)
  await handlePluginOutputs(pluginOutputs);

  logger.info('Processing complete', {
    entities: result.entities.length,
    topics: result.topics.length,
    memories: result.memories.length,
    goalUpdates: result.goalUpdates.length,
    plugins: pluginOutputs.length,
    timeMs: Date.now() - startTime,
  });

  return {
    ...result,
    pluginOutputs,
    rawResponse: llmResponse,
  };
}

/**
 * Handle outputs from plugins (e.g., save corrections)
 */
async function handlePluginOutputs(outputs: PluginOutput[]): Promise<void> {
  for (const output of outputs) {
    if (!output.success) continue;

    // Handle correction-detector plugin
    if (output.pluginName === 'correction-detector' && output.output.corrections) {
      const corrections = output.output.corrections as Array<{ wrong: string; correct: string }>;
      for (const c of corrections) {
        await correctionStore.findOrCreate(c.wrong, c.correct);
      }
    }
  }
}

/**
 * Save extraction results to DB
 * Extraction is already normalized and validated by Zod
 */
async function saveExtraction(
  _sessionId: string,
  conversationId: string,
  extraction: NormalizedExtraction,
  _context: Context
): Promise<Omit<ProcessingResult, 'rawResponse' | 'pluginOutputs'>> {
  const result: Omit<ProcessingResult, 'rawResponse' | 'pluginOutputs'> = {
    entities: [],
    topics: [],
    memories: [],
    goalUpdates: [],
  };

  // Save entities (already normalized)
  for (const e of extraction.entities) {
    const entity = await entityStore.findOrCreate({
      name: e.name,
      type: e.type,
    });
    const isNew = entity.mentionCount === 1;
    result.entities.push({
      id: entity.id,
      name: entity.name,
      type: entity.type,
      isNew,
    });
  }

  // Save topics (already normalized)
  for (const t of extraction.topics) {
    const topic = await topicStore.findOrCreate({
      name: t.name,
      category: t.category,
    });
    const isNew = topic.mentionCount === 1;
    result.topics.push({
      id: topic.id,
      name: topic.name,
      isNew,
    });
  }

  // Save memories (already normalized)
  for (const m of extraction.memories) {
    // Link to entities and topics we just processed
    const entityIds = result.entities.map((e) => e.id);
    const topicIds = result.topics.map((t) => t.id);

    const memory = await memoryStore.create({
      content: m.content,
      type: m.type,
      subject: m.subject,
      entityIds,
      topicIds,
      sourceConversationIds: [conversationId],
      importance: m.importance ?? 0.5,
      confidence: 0.8,
    });

    result.memories.push({
      id: memory.id,
      content: memory.content,
      type: memory.type,
    });
  }

  // Handle goals (already normalized)
  for (const g of extraction.goals) {
    if (g.status === 'new' || !g.status) {
      // Create new goal
      const goal = await goalStore.create({
        statement: g.statement,
        type: g.type,
        entityIds: result.entities.map((e) => e.id),
        topicIds: result.topics.map((t) => t.id),
      });
      result.goalUpdates.push({ id: goal.id, type: 'new' });
    } else {
      // Try to find and update existing goal
      const existingGoals = await goalStore.search(g.statement, 1);
      if (existingGoals.length > 0) {
        const goal = existingGoals[0];
        if (g.status === 'achieved') {
          await goalStore.updateStatus(goal.id, 'achieved');
          result.goalUpdates.push({ id: goal.id, type: 'achieved' });
        } else if (g.status === 'progress' && g.progress !== undefined) {
          await goalStore.updateProgress(goal.id, g.progress);
          result.goalUpdates.push({ id: goal.id, type: 'progress' });
        } else {
          await goalStore.recordReference(goal.id);
          result.goalUpdates.push({ id: goal.id, type: 'referenced' });
        }
      }
    }
  }

  // Handle corrections
  for (const c of extraction.corrections) {
    await correctionStore.findOrCreate(c.wrong, c.correct);
  }

  return result;
}
