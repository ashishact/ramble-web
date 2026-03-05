/**
 * Input Processor — Unified Pipeline (System I + System II)
 *
 * ARCHITECTURE: Both System I (fast/shallow) and System II (slow/deep) run
 * the SAME extraction pipeline. The difference is context depth, not logic.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * System I (fast thinking):
 *   - Fires on each intermediate chunk during live recording
 *   - Small WorkingMemory context
 *   - Saves to DB for time travel, but no durability guarantee
 *   - Fire-and-forget — if fails, ok
 *   - Emits processing:system-i event
 *
 * System II (slow thinking):
 *   - Fires after recording ends with complete text
 *   - Medium WorkingMemory context with hint-based retrieval
 *   - Durable via task queue — retries on failure
 *   - Large text splitting (> ~12000 chars) into sentence-boundary chunks
 *   - Emits processing:system-ii event
 *
 * Both modes use the SAME:
 *   - SYSTEM_PROMPT for extraction
 *   - saveExtraction() for DB persistence
 *   - normalizeInput() for correction + hint extraction
 *
 * Core flow:
 * 1. Normalize input (corrections + hint extraction)
 * 2. Retrieve context using hints (two-pass architecture)
 * 3. Build working memory with hint-matched context
 * 4. Call LLM with structured prompt
 * 5. Parse response and save to DB
 * 6. Auto-reinforce related memories
 * 7. Emit processing event
 */

import { callLLM } from '../llmClient';
import { workingMemory, type WorkingMemoryData } from '../WorkingMemory';
import { normalizeInput, type NormalizeResult } from '../services/normalizeInput';
import { retrieveContext } from './contextRetrieval';
import { parseLLMJSON } from '../utils/jsonUtils';
import { eventBus } from '../../lib/eventBus';
import {
  entityStore,
  topicStore,
  memoryStore,
  goalStore,
  extractionLogStore,
  correctionStore,
  conversationStore,
  cooccurrenceStore,
  taskStore,
} from '../../db/stores';
import type { MemoryOrigin } from '../../db/stores/memoryStore';
import type { ConversationSource } from '../../db/models/Conversation';
import type { ProcessingMode, NormalizationHints } from '../types/recording';
import { runPlugins, type PluginOutput } from '../plugins';
import { createLogger } from '../utils/logger';
import { resolveTemporalExpression } from './temporalResolver';
import { filterEligibleEntities } from '../knowledgeTree/entityFilter';
import { buildExtractionSystemPrompt, buildMeetingExtractionSystemPrompt } from './extractionPrompt';
import { resolveEntity } from '../entityResolution/entityResolver';
import { fullEntityMerge } from '../entityResolution/entityMerge';
import type { SessionContext } from '../entityResolution/types';
import { telemetry } from '../telemetry';

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
    type: 'new' | 'progress' | 'achieved' | 'referenced' | 'edited' | 'abandoned';
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
    validFrom?: string;      // ISO date or relative expression (resolved before DB write)
    validUntil?: string;     // ISO date or relative expression (resolved before DB write)
  }>;
  goals: Array<{ statement: string; type: string; status?: string; progress?: number; shortId?: string }>;
  corrections: Array<{ wrong: string; correct: string }>;
  retractions: string[];     // short IDs (m1, m2...) of memories to retract (intent: retract)
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
function normalizeMemory(m: unknown): { content: string; type: string; importance?: number; subject?: string; contradicts?: string[]; validFrom?: string; validUntil?: string } | null {
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
        validFrom: typeof obj.validFrom === 'string' ? obj.validFrom : undefined,
        validUntil: typeof obj.validUntil === 'string' ? obj.validUntil : undefined,
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
    retractions: [],
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

  // Normalize retractions — array of short IDs (e.g. ["m1", "m3"])
  if (Array.isArray(obj.retractions)) {
    for (const r of obj.retractions) {
      if (typeof r === 'string' && r.trim()) {
        result.retractions.push(r.trim());
      }
    }
  }

  // Extract summary if present
  if (typeof obj.summary === 'string' && obj.summary.trim()) {
    result.summary = obj.summary.trim();
  }

  return result;
}

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
  source: 'speech' | 'text' | 'meeting' = 'text',
  options?: {
    mode?: ProcessingMode           // 'system-i' | 'system-ii' (default: 'system-ii')
    recordingId?: string
    chunkIndex?: number
    hints?: NormalizationHints      // Pre-computed hints (skips normalization if provided)
    isMeeting?: boolean             // Use meeting-specific extraction prompt
  }
): Promise<ProcessingResult> {
  const mode = options?.mode ?? 'system-ii';
  const startTime = Date.now();

  logger.info('Processing input', { sessionId, inputLength: inputText.length, source, mode });

  // ── Phase 1: Normalize input ─────────────────────────────────────────────
  // If hints are pre-computed (e.g. submitChunk already ran normalization),
  // skip normalization to avoid duplicate LLM calls.
  telemetry.emit('normalize', 'phase1-normalize', 'start', {
    mode,
    hasPrecomputedHints: !!options?.hints,
    inputText: inputText,
  });
  let normalizedText: string
  let sentences: NormalizeResult['sentences']
  let hints: NormalizationHints

  if (options?.hints) {
    // Pre-computed hints from caller (chunked processing or System I submitChunk path)
    normalizedText = inputText
    sentences = []
    hints = options.hints

    // Persist normalization data on conversation record (intent, normalized text)
    // so chunked conversations are fully annotated like single-pass ones.
    await conversationStore.updateNormalized(
      conversationId,
      normalizedText,
      '[]',
      hints.intent
    );
  } else {
    // Full normalization with correction pipeline
    const recentConvs = await conversationStore.getRecent(3);
    const recentSentences: string[] = recentConvs
      .reverse() // oldest first
      .flatMap(c => {
        const parsed = c.sentencesParsed
        if (parsed.length > 0) {
          return parsed.map(s => s.text)
        }
        return c.sanitizedText.split(/(?<=[.!?])\s+/).filter(Boolean)
      })
      .slice(-5);

    const normalizeResult = await normalizeInput(inputText, recentSentences, source);
    normalizedText = normalizeResult.normalizedText;
    sentences = normalizeResult.sentences;
    hints = normalizeResult.hints;

    // Persist Phase 1 output on the conversation record (including intent)
    await conversationStore.updateNormalized(
      conversationId,
      normalizedText,
      JSON.stringify(sentences),
      hints.intent
    );
  }

  telemetry.emit('normalize', 'phase1-normalize', 'end', {
    intent: hints.intent,
    normalizedText: normalizedText,
    entityHints: hints.entityHints.map(h => h.name),
    topicHints: hints.topicHints.map(h => h.name),
    corrections: hints.correctionsApplied.map(c => `${c.from} → ${c.to}`),
  }, { status: 'success' });

  const intent = hints.intent
  logger.info('Intent classified', { intent, conversationId });

  // ── Query intent: skip extraction entirely ─────────────────────────────
  // The user is asking a question, not providing knowledge.
  // Prevents "The user wants to know about X" being saved as a memory.
  if (intent === 'query') {
    logger.info('Query intent detected, skipping extraction', { conversationId });
    return { entities: [], topics: [], memories: [], goalUpdates: [], pluginOutputs: [], rawResponse: '' };
  }

  // ── Phase 2: Build context + extract ─────────────────────────────────────
  // Two-pass context retrieval: use hints to find relevant DB records,
  // then merge them into WorkingMemory for the extraction LLM call.
  telemetry.emit('context', 'phase2-context', 'start', { mode });
  const wmSize = mode === 'system-i' ? 'small' : 'medium';
  const retrieved = await retrieveContext(hints, wmSize);
  const wmData = await workingMemory.fetchWithHints({ size: wmSize }, retrieved);
  const contextPrompt = workingMemory.formatForLLM(wmData);
  telemetry.emit('context', 'phase2-context', 'end', {
    entities: wmData.entities.length,
    entityNames: wmData.entities.slice(0, 8).map((e: { name: string }) => e.name),
    memories: wmData.memories.length,
    topics: wmData.topics?.length ?? 0,
    contextChars: contextPrompt.length,
  }, { status: 'success' });

  // Use normalizedText for Phase 2 if available (fallback: original inputText)
  const extractionText = normalizedText || inputText;

  // Check if input needs summary (>= 50 words)
  const wordCount = extractionText.split(/\s+/).filter(w => w.length > 0).length;
  const needsSummary = wordCount >= 50;

  // 2. Build correction hints from normalization (phonetic/spelling already handled by normalizeInput)
  let correctionSection = '';
  if (hints.correctionsApplied.length > 0) {
    const lines = hints.correctionsApplied.map(c => `- "${c.from}" → "${c.to}"`);
    correctionSection = `\n## Applied Corrections\n${lines.join('\n')}\n`;
  }

  // 3. Build prompt using normalizedText
  const summaryInstruction = needsSummary
    ? '\n\nAlso provide a brief summary (1-2 sentences) in a "summary" field. Keep the original first-person voice - just condense, don\'t rephrase as "the user said".'
    : '';

  const userPrompt = `## Context
${contextPrompt}
${correctionSection}
Current time: ${wmData.userContext.currentTime}

## New Input
${extractionText}

Extract entities, topics, memories, and goals from the new input. Respond with JSON only.${summaryInstruction}`;

  // 4. Call LLM (Phase 2 extraction)
  // Meeting mode: use meeting-specific prompt + higher token budget (multi-speaker, denser)
  const systemPrompt = options?.isMeeting
    ? buildMeetingExtractionSystemPrompt()
    : buildExtractionSystemPrompt(intent);
  const maxTokens = options?.isMeeting ? 4000 : 3000;

  telemetry.emit('extraction', 'phase3-llm-extraction', 'start', {
    promptLength: userPrompt.length,
    extractionText,
    promptPreview: userPrompt,
    systemPromptPreview: systemPrompt,
    tier: 'small',
  }, { isLLM: true });
  let llmResponse: string;
  try {
    const response = await callLLM({
      tier: 'small', // Use cheap tier for extraction
      prompt: userPrompt,
      systemPrompt,
      category: 'extraction',
      options: {
        temperature: 0.3, // Low temperature for structured output
        max_tokens: maxTokens,
      },
    });
    llmResponse = response.content;
    telemetry.emit('extraction', 'phase3-llm-extraction', 'end', {
      responseLength: llmResponse.length,
      tokensUsed: response.tokens_used.total,
      responsePreview: llmResponse,
      durationMs: response.processing_time_ms,
      model: response.model,
      inputTokens: response.tokens_used.prompt,
      outputTokens: response.tokens_used.completion,
    }, { status: 'success', isLLM: true });
  } catch (error) {
    telemetry.emit('extraction', 'phase3-llm-extraction', 'end', {
      error: error instanceof Error ? error.message : 'Unknown',
    }, { status: 'error' });
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
  telemetry.emit('save', 'phase4-save-extraction', 'start');
  const origin = sourceToOrigin(source);
  const result = await saveExtraction(sessionId, conversationId, extraction, wmData, origin);
  telemetry.emit('save', 'phase4-save-extraction', 'end', {
    entities: result.entities.length,
    entityNames: result.entities.slice(0, 10).map(e => `${e.name} [${e.type}]${e.isNew ? ' NEW' : ''}`),
    memories: result.memories.length,
    memoryPreviews: result.memories.map(m => `[${m.type}] ${m.content}`),
    topics: result.topics.length,
    topicNames: result.topics.slice(0, 10).map(t => t.name),
    goals: result.goalUpdates.length,
    goalDetails: result.goalUpdates.slice(0, 5).map(g => `${g.id} (${g.type})`),
    corrections: extraction.corrections.map(c => `${c.wrong} → ${c.correct}`),
    retractions: extraction.retractions,
    summary: extraction.summary,
  }, { status: 'success' });

  // 5.1 Save summary if generated
  if (needsSummary && extraction.summary) {
    await conversationStore.updateSummary(conversationId, extraction.summary);
  }

  // 5.2 Deterministic auto-reinforce: boost existing memories that share entities/topics
  // with the newly created memories. Zero LLM calls — pure DB operations.
  telemetry.emit('reinforce', 'phase5-auto-reinforce', 'start');
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

  telemetry.emit('reinforce', 'phase5-auto-reinforce', 'end', undefined, { status: 'success' });

  // 5.3 Queue tree curation for eligible entities
  // Only System II (deep processing) triggers tree curation — skip for System I chunks.
  if (mode !== 'system-i' && result.entities.length > 0 && result.memories.length > 0) {
    // Look up entities from DB to get mentionCount, then run eligibility filter
    // (user's entity always qualifies, generics filtered, others need mentionCount >= 2)
    const dbEntities = (await Promise.all(
      result.entities.map(e => entityStore.getById(e.id))
    )).filter((e): e is NonNullable<typeof e> => e !== null)
    const eligible = await filterEligibleEntities(dbEntities)

    if (eligible.length > 0) {
      await taskStore.create({
        taskType: 'edit-trees',
        payload: {
          entityIds: eligible.map(e => e.id),
          topicIds: result.topics.map(t => t.id),
          memoryIds: result.memories.map(m => m.id),
          conversationId,
          intent,
        },
        priority: 5,  // lower priority than base extraction
        sessionId,
      })
    }
  }

  telemetry.emit('follow-up', 'phase6-queue-tasks', 'start');

  // 5.4 Queue timeline extraction (parallel to tree curation — independent task)
  // Timeline extracts real-world events from memories (meetings, trips, deadlines).
  // No entity eligibility filter — the LLM decides if memories are timeline-worthy.
  if (mode !== 'system-i' && result.memories.length > 0) {
    await taskStore.create({
      taskType: 'curate-timeline',
      payload: {
        entityIds: result.entities.map(e => e.id),
        memoryIds: result.memories.map(m => m.id),
        conversationId,
        intent,
      },
      priority: 4,
      sessionId,
    })
  }

  telemetry.emit('follow-up', 'phase6-queue-tasks', 'end', undefined, { status: 'success' });

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

  const processingResult: ProcessingResult = {
    ...result,
    pluginOutputs,
    rawResponse: llmResponse,
  };

  // 9. Emit processing event — widgets subscribe to these
  // Every input now has a recordingId (kernel.submitInput creates one if not
  // provided). System I fires for chunk-level, System II for full-recording.
  if (mode === 'system-i' && options?.recordingId) {
    eventBus.emit('processing:system-i', {
      recordingId: options.recordingId,
      chunkIndex: options.chunkIndex ?? 0,
      result: processingResult,
      hints,
    });
  } else {
    eventBus.emit('processing:system-ii', {
      recordingId: options?.recordingId,
      conversationId,
      result: processingResult,
      context: wmData,
    });
  }

  return processingResult;
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

// findFuzzyEntity() and relinkEntityReferences() removed — replaced by:
//   resolveEntity() from entityResolution/entityResolver.ts (multi-signal resolution)
//   fullEntityMerge() from entityResolution/entityMerge.ts (full cross-DB merge)

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
  // Build session context incrementally as entities are resolved
  const sessionContext: SessionContext = {
    resolvedEntityIds: [],
    resolvedTopicIds: [],
  }

  for (const e of extraction.entities) {
    // If the LLM returned a bare string entity (type defaults to "unknown"),
    // try to inherit type from an existing entity in the DB before giving up.
    if (e.type === 'unknown') {
      const existing = await entityStore.getByName(e.name);
      if (existing) {
        e.type = existing.type;
      } else {
        // Default to 'other' so it still gets saved — better than dropping it
        e.type = 'other';
      }
    }

    // Multi-signal entity resolution: Jaro-Winkler + co-occurrence + topic + temporal + type
    // Wrapped in try-catch so resolution failures fall back to findOrCreate() (old behavior)
    let resolved: Awaited<ReturnType<typeof resolveEntity>> = null;
    try {
      resolved = await resolveEntity(e.name, e.type, sessionContext);
    } catch (err) {
      logger.error('Entity resolution failed, falling back to findOrCreate', {
        name: e.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (resolved) {
      // Use existing entity instead of creating a near-duplicate
      await entityStore.recordMention(resolved.entityId);
      result.entities.push({
        id: resolved.entityId,
        name: resolved.entityName,
        type: resolved.entityType,
        isNew: false,
      });
      sessionContext.resolvedEntityIds.push(resolved.entityId);
      if (resolved.entityName !== e.name) {
        logger.debug('Resolved entity', {
          input: e.name,
          matched: resolved.entityName,
          composite: resolved.score.composite.toFixed(3),
          decision: resolved.score.decision,
        });
      }
      eventBus.emit('tree:activity', {
        type: 'entity-resolved',
        entityName: resolved.entityName,
        entityId: resolved.entityId,
        message: `Entity resolved: "${e.name}" → "${resolved.entityName}" [${resolved.entityType}]`,
        detail: `composite: ${resolved.score.composite.toFixed(3)}, decision: ${resolved.score.decision}`,
        timestamp: Date.now(),
      });
      continue;
    }

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
    sessionContext.resolvedEntityIds.push(entity.id);
    if (isNew) {
      eventBus.emit('tree:activity', {
        type: 'entity-created',
        entityName: entity.name,
        entityId: entity.id,
        message: `Entity created: "${entity.name}" [${entity.type}]`,
        timestamp: Date.now(),
      });
    }
  }

  // Co-occurrence increment: track which entities appear together in this extraction.
  // Zero LLM cost — just counter increments during the existing extraction flow.
  const savedEntityIds = result.entities.map(e => e.id);
  if (savedEntityIds.length >= 2) {
    const snippet = extraction.memories[0]?.content?.slice(0, 100) ?? '';
    for (let i = 0; i < savedEntityIds.length; i++) {
      for (let j = i + 1; j < savedEntityIds.length; j++) {
        await cooccurrenceStore.increment(savedEntityIds[i], savedEntityIds[j], snippet);
      }
    }
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

  // Link entities to topics for tree editor discovery
  // topicStore.addEntity() is idempotent — safe to call even if already linked
  for (const topic of result.topics) {
    for (const entity of result.entities) {
      await topicStore.addEntity(topic.id, entity.id);
    }
  }

  // Save memories (already normalized)
  //
  // NOTE: Memory dedup gate is intentionally bypassed. Previously, we used
  // bigram Dice similarity to reinforce (>=0.95) or supersede (0.80-0.94)
  // existing memories. This caused problems:
  //   - "reinforce" reused the OLD memory ID, so curation loaded stale content
  //   - Naive character-level similarity missed semantic differences
  //     (e.g. "Supermarket" vs "Superatom" scored ~0.82 = supersede, but
  //     "works on X project" vs "works on Y project" could score high enough
  //     to reinforce and lose the correction)
  // Now every extraction creates a fresh memory. The curation LLM sees ALL
  // memories with timestamps and decides what's current. Old memories remain
  // in the DB for history / contradiction tracking.
  //
  // Original dedup code lives in memoryDedup.ts (checkMemoryDuplicate).
  for (const m of extraction.memories) {
    // ── Resolve temporal expressions to absolute timestamps ──────────
    let validFrom: number | undefined;
    let validUntil: number | undefined;
    if (m.validFrom) {
      const resolved = resolveTemporalExpression(m.validFrom, Date.now());
      validFrom = resolved?.validFrom;
    }
    if (m.validUntil) {
      const resolved = resolveTemporalExpression(m.validUntil, Date.now());
      validUntil = resolved?.validUntil;
    }

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
      validFrom,
      validUntil,
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
        } else if (g.status === 'edit' && g.statement) {
          await goalStore.update(existingGoalId, { statement: g.statement });
          await goalStore.recordReference(existingGoalId);
          result.goalUpdates.push({ id: existingGoalId, type: 'edited' });
        } else if (g.status === 'abandoned') {
          await goalStore.updateStatus(existingGoalId, 'abandoned');
          result.goalUpdates.push({ id: existingGoalId, type: 'abandoned' });
        } else {
          await goalStore.recordReference(existingGoalId);
          result.goalUpdates.push({ id: existingGoalId, type: 'referenced' });
        }
      }
    }
  }

  // Handle corrections — save and merge orphan entities when applicable
  for (const c of extraction.corrections) {
    await correctionStore.findOrCreate(c.wrong, c.correct);

    // If the correct name matches an existing entity, merge any orphan entity
    // created under the wrong name into it. This retroactively cleans up
    // duplicate entities caused by STT errors (e.g. "Asha" → "Ashish").
    const targetEntity = await entityStore.getByName(c.correct);
    if (targetEntity) {
      const orphanEntity = await entityStore.getByName(c.wrong);
      if (orphanEntity && orphanEntity.id !== targetEntity.id) {
        logger.info('Merging orphan entity from correction', {
          orphan: orphanEntity.name,
          target: targetEntity.name,
        });
        // Full cross-DB merge: relinks memories, goals, topics, co-occurrences,
        // knowledge nodes, timeline events, then merges entity records
        await fullEntityMerge(targetEntity.id, orphanEntity.id);
      }
    }
  }

  // Handle retractions — mark referenced memories as retracted
  if (extraction.retractions.length > 0) {
    for (const shortId of extraction.retractions) {
      const existing = workingMemory.findMemoryByShortId(wmData, shortId);
      if (existing) {
        await memoryStore.retract(existing.id);
        logger.info('Retracted memory', { shortId, memoryId: existing.id });
      } else {
        logger.warn('Retraction target not found', { shortId });
      }
    }
  }

  return result;
}
