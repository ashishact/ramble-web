/**
 * Input Processor
 *
 * PARADIGM: BATCH (stop-and-process) ─────────────────────────────────────────
 * This processor runs AFTER a recording ends or text is submitted. It never
 * sees intermediate/streaming text. Called from:
 *   - GlobalSTTController: after native:transcription-final (out-of-app speech)
 *   - ConversationWidget or input handlers: after user types/pastes (in-app)
 *
 * FOCUS CONTEXT: Both in-app and out-of-app — the source param distinguishes:
 *   source: 'speech'   → native app sent a completed utterance
 *   source: 'text'     → user typed directly in Ramble
 *   source: 'pasted'   → user pasted content
 *   source: 'meeting'  → meeting widget committed a segment (batch post-process)
 *
 * NOT used by the Meeting Transcription widget during live streaming —
 * that widget runs its own independent LLM loop (see meeting-transcription/process.ts).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Core processing logic:
 * 1. Build context
 * 2. Call LLM with structured prompt
 * 3. Parse response and update DB
 */

import { callLLM } from '../llmClient';
import { workingMemory, type WorkingMemoryData } from '../WorkingMemory';
import { findPhoneticMatches, findSpellingMatches, formatMatchesForLLM } from '../services/phoneticMatcher';
import { normalizeInput } from '../services/normalizeInput';
import { parseLLMJSON } from '../utils/jsonUtils';
import {
  entityStore,
  topicStore,
  memoryStore,
  goalStore,
  extractionLogStore,
  correctionStore,
  conversationStore,
} from '../../db/stores';
import type { MemoryOrigin } from '../../db/stores/memoryStore';
import type { ConversationSource } from '../../db/models/Conversation';
import { runPlugins, type PluginOutput } from '../plugins';
import { createLogger } from '../utils/logger';

const logger = createLogger('Pipeline');

// ============================================================================
// Constants
// ============================================================================

/**
 * Identifies the model/prompt version used for extraction.
 * Update this string when the system prompt or model changes so memories
 * carry a breadcrumb of how they were created.
 */
const EXTRACTION_VERSION = 'v1-groq-gpt120b';

/**
 * Map conversation source to memory origin.
 * 'text' is the legacy value — treated as 'typed'.
 */
function sourceToOrigin(source: ConversationSource | string): MemoryOrigin {
  switch (source) {
    case 'speech': return 'speech';
    case 'meeting': return 'meeting';
    case 'pasted': return 'pasted';
    case 'document': return 'document';
    case 'typed':
    case 'text':
    default:
      return 'typed';
  }
}

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
  memories: Array<{
    content: string;
    type: string;
    importance?: number;
    subject?: string;
    contradicts?: string[];  // short IDs (m1, m2...) of memories this belief competes with
  }>;
  goals: Array<{ statement: string; type: string; status?: string; progress?: number; shortId?: string }>;
  corrections: Array<{ wrong: string; correct: string }>;
  summary?: string;  // LLM-generated summary for large inputs
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
function normalizeMemory(m: unknown): { content: string; type: string; importance?: number; subject?: string; contradicts?: string[] } | null {
  if (typeof m === 'string' && m.trim()) {
    return { content: m.trim(), type: 'fact' };
  }
  if (m && typeof m === 'object') {
    const obj = m as Record<string, unknown>;
    const content = typeof obj.content === 'string' ? obj.content.trim() : null;
    if (content) {
      // Extract contradiction references — must be an array of non-empty strings
      let contradicts: string[] | undefined;
      if (Array.isArray(obj.contradicts)) {
        const ids = (obj.contradicts as unknown[])
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          .map(id => id.trim());
        if (ids.length > 0) contradicts = ids;
      }
      return {
        content,
        type: typeof obj.type === 'string' ? obj.type : 'fact',
        importance: typeof obj.importance === 'number' ? obj.importance : undefined,
        subject: typeof obj.subject === 'string' ? obj.subject : undefined,
        contradicts,
      };
    }
  }
  return null;
}

/**
 * Normalize a single goal (handles string or object with statement/content)
 * Now supports shortId for referencing existing goals (g1, g2, etc.)
 * For updates via shortId, statement is optional
 */
function normalizeGoal(g: unknown): { statement: string; type: string; status?: string; progress?: number; shortId?: string } | null {
  if (typeof g === 'string' && g.trim()) {
    return { statement: g.trim(), type: 'general' };
  }
  if (g && typeof g === 'object') {
    const obj = g as Record<string, unknown>;
    // Try statement first, then content
    const statement = typeof obj.statement === 'string' ? obj.statement.trim() :
                      typeof obj.content === 'string' ? obj.content.trim() : null;
    const shortId = typeof obj.shortId === 'string' ? obj.shortId : undefined;

    // Allow updates via shortId even without a statement
    if (statement || shortId) {
      return {
        statement: statement || '', // Empty for shortId-only updates
        type: typeof obj.type === 'string' ? obj.type : 'general',
        status: typeof obj.status === 'string' ? obj.status : undefined,
        progress: typeof obj.progress === 'number' ? obj.progress : undefined,
        shortId,
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

  // Extract summary if present
  if (typeof obj.summary === 'string' && obj.summary.trim()) {
    result.summary = obj.summary.trim();
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
2. **topics**: Detect topic switches - what is the user talking about now? Format: "Domain / Topic" (e.g., "Work / Planning", "Health / Exercise"). Reuse existing domains.
3. **memories**: Facts, beliefs, preferences, concerns, or intentions to remember.
4. **goals**: Goals mentioned - can be new goals, progress updates, or completions.
5. **corrections**: STT errors you can identify.

IMPORTANT:
- Check if names in the input might be mishearings of Known Entities listed in the context.
- Speech-to-text often mishears names. If a name sounds similar to a known entity, use the known entity.
- Prefer matching against existing entities rather than creating duplicates.

MEMORIES - Belief competition model:
Working Memory lists existing memories with short IDs like [m1], [m2], etc.
If a new memory CONTRADICTS an existing one (e.g. different person assigned to same task, conflicting facts), include a "contradicts" field with the short IDs of the competing memories.
Do NOT omit or replace the old memory — both beliefs coexist. The system resolves the winner at read time based on confidence.

Example: if [m3] says "Gopi will send the draft" and the user now says Ashish is sending it:
{"content": "Ashish will send the draft", "type": "belief", "contradicts": ["m3"]}

GOALS - Hierarchical namespace. Active goals listed with short IDs (g1, g2, etc.).

Statement format:
- "Namespace / Goal" - Goal must be descriptive sentence
- "Namespace / Goal / Sub-goal" - Sub-goal must be descriptive sentence

The last segment is always the descriptive part (NOT just keywords).

Rules:
- Reuse existing categories - do NOT create many new categories
- Prefer adding depth to existing goals over creating new top-level goals
- Maximum 3 levels

Format:
- {"statement": "Category / Goal sentence", "type": "work|personal|health"} - new goal
- {"shortId": "g1", "status": "achieved"} - mark existing goal complete
- {"shortId": "g1", "status": "progress", "progress": 0-100} - progress update

type = domain/why (work, personal, health)
statement = Category / What you want to achieve

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
 *
 * New two-phase flow:
 *  Phase 1 (cheap) — normalize punctuation/sentences, store on conversation
 *  Phase 2 (existing) — extract entities/topics/memories/goals using normalizedText
 *  Post-save — deterministic auto-reinforce related existing memories (zero LLM calls)
 */
export async function processInput(
  sessionId: string,
  conversationId: string,
  inputText: string,
  source: 'speech' | 'text' = 'text'
): Promise<ProcessingResult> {
  const startTime = Date.now();

  logger.info('Processing input', { sessionId, inputLength: inputText.length, source });

  // ── Phase 1: Normalize input ─────────────────────────────────────────────
  // Fetch the last few conversations to provide sentence context for Phase 1.
  // We only need raw records — no full WorkingMemory fetch required here.
  const recentConvs = await conversationStore.getRecent(3);
  const recentSentences: string[] = recentConvs
    .reverse() // oldest first
    .flatMap(c => {
      const parsed = c.sentencesParsed
      if (parsed.length > 0) {
        return parsed.map(s => s.text)
      }
      // Fallback: split sanitizedText on sentence boundaries
      return c.sanitizedText.split(/(?<=[.!?])\s+/).filter(Boolean)
    })
    .slice(-5);  // Keep last 5 sentences for context

  const { normalizedText, sentences } = await normalizeInput(inputText, recentSentences);

  // Persist Phase 1 output on the conversation record
  await conversationStore.updateNormalized(
    conversationId,
    normalizedText,
    JSON.stringify(sentences)
  );

  // ── Phase 2: Build context + extract ─────────────────────────────────────
  // 1. Build context using unified WorkingMemory (all conversations, no session filter)
  const wmData = await workingMemory.fetch({ size: 'medium' });
  const contextPrompt = workingMemory.formatForLLM(wmData);

  // Use normalizedText for Phase 2 if available (fallback: original inputText)
  const extractionText = normalizedText || inputText;

  // Check if input needs summary (>= 50 words)
  const wordCount = extractionText.split(/\s+/).filter(w => w.length > 0).length;
  const needsSummary = wordCount >= 50;

  // 2. Run correction analysis based on source
  let correctionSection = '';
  if (source === 'speech') {
    // Full phonetic analysis for speech - STT makes phonetic errors
    const phoneticMatches = await findPhoneticMatches(extractionText);
    const phoneticHints = formatMatchesForLLM(phoneticMatches);
    if (phoneticHints) {
      correctionSection = `\n${phoneticHints}\n`;
    }
  } else {
    // Light spelling check for text - just note that typos are possible
    const spellingMatches = await findSpellingMatches(extractionText);
    if (spellingMatches.length > 0) {
      const hints = spellingMatches.map(m => `- "${m.inputWord}" might be "${m.matchedEntity}"`);
      correctionSection = `\n## Possible Typos (verify if relevant)\n${hints.join('\n')}\n`;
    }
  }

  // 3. Build prompt using normalizedText
  const summaryInstruction = needsSummary
    ? '\n\nAlso provide a brief summary (1-2 sentences) in a "summary" field. Keep the original first-person voice - just condense, don\'t rephrase as "the user said".'
    : '';

  const userPrompt = `Current time: ${wmData.userContext.currentTime}

## Context
${contextPrompt}
${correctionSection}
## New Input
${extractionText}

Extract entities, topics, memories, and goals from the new input. Respond with JSON only.${summaryInstruction}`;

  // 4. Call LLM (Phase 2 extraction)
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
      inputText: extractionText,
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
  const origin = sourceToOrigin(source);
  const result = await saveExtraction(sessionId, conversationId, extraction, wmData, origin);

  // 5.1 Save summary if generated
  if (needsSummary && extraction.summary) {
    await conversationStore.updateSummary(conversationId, extraction.summary);
  }

  // 5.2 Deterministic auto-reinforce: boost existing memories that share entities/topics
  // with the newly created memories. Zero LLM calls — pure DB operations.
  if (result.memories.length > 0) {
    const newMemoryIds = new Set(result.memories.map(m => m.id));
    const allEntityIds = result.entities.map(e => e.id);
    const allTopicIds = result.topics.map(t => t.id);

    if (allEntityIds.length > 0 || allTopicIds.length > 0) {
      const relatedMemories = await memoryStore.getForContext(allEntityIds, allTopicIds, 20);
      for (const related of relatedMemories) {
        // Only reinforce memories that were NOT just created in this pass
        if (!newMemoryIds.has(related.id)) {
          await memoryStore.reinforce(related.id);
        }
      }
    }
  }

  // 6. Log success
  await extractionLogStore.create({
    pluginId: 'core-processor',
    conversationId,
    sessionId,
    inputText: extractionText,
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
 * Extraction is already normalized and validated
 * Uses WorkingMemoryData for goal short ID lookups
 */
async function saveExtraction(
  _sessionId: string,
  conversationId: string,
  extraction: NormalizedExtraction,
  wmData: WorkingMemoryData,
  origin: MemoryOrigin = 'typed'
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
      // confidence defaults to origin-based prior inside memoryStore.create()
      origin,
      extractionVersion: EXTRACTION_VERSION,
    });

    result.memories.push({
      id: memory.id,
      content: memory.content,
      type: memory.type,
    });

    // Wire contradiction edges — both memories remain alive, winner resolved at read time
    if (m.contradicts && m.contradicts.length > 0) {
      for (const shortId of m.contradicts) {
        const existing = workingMemory.findMemoryByShortId(wmData, shortId);
        if (existing) {
          await memoryStore.addContradiction(memory.id, existing.id);
        }
      }
    }
  }

  // Handle goals (already normalized)
  // Now supports short IDs (g1, g2...) for referencing existing goals
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
      // Try to find existing goal by short ID first, then by text search
      let existingGoalId: string | null = null;

      if (g.shortId) {
        // Use short ID to find goal from WorkingMemoryData
        const goalRef = workingMemory.findGoalByShortId(wmData, g.shortId);
        if (goalRef) {
          existingGoalId = goalRef.id;
        }
      }

      // Fall back to text search if no short ID or short ID not found
      if (!existingGoalId) {
        const existingGoals = await goalStore.search(g.statement, 1);
        if (existingGoals.length > 0) {
          existingGoalId = existingGoals[0].id;
        }
      }

      if (existingGoalId) {
        if (g.status === 'achieved') {
          await goalStore.updateStatus(existingGoalId, 'achieved');
          result.goalUpdates.push({ id: existingGoalId, type: 'achieved' });
        } else if (g.status === 'progress' && g.progress !== undefined) {
          await goalStore.updateProgress(existingGoalId, g.progress);
          result.goalUpdates.push({ id: existingGoalId, type: 'progress' });
        } else {
          await goalStore.recordReference(existingGoalId);
          result.goalUpdates.push({ id: existingGoalId, type: 'referenced' });
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
