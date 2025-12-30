/**
 * Extract Primitives Handler
 *
 * Task: extract_primitives
 * Input: unit:preprocessed event
 * Output: primitives:extracted event
 *
 * Steps:
 * 1. Get unit and spans from DB
 * 2. Gather context (known entities, recent propositions)
 * 3. Run LLM extraction
 * 4. Save propositions, stances, relations, entity mentions to DB
 * 5. Save extraction traces for debugging
 * 6. Emit primitives:extracted event
 */

import type { TaskCheckpoint, Entity } from '../../types';
import type { Proposition, Stance, Relation, Span } from '../../schemas/primitives';
import type { PipelineTaskHandler, TaskContext, ExtractPrimitivesResult } from './types';
import type { UnitPreprocessedPayload } from '../events/types';
import { emitPrimitivesExtracted } from '../events/eventBus';
import {
  extractPrimitives,
  type PrimitiveExtractionInput,
  type PrimitiveExtractionOutput,
} from '../../extractors/primitiveExtractor';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ExtractPrimitivesHandler');

/**
 * Extract primitives handler implementation
 */
export class ExtractPrimitivesHandler implements PipelineTaskHandler<UnitPreprocessedPayload, ExtractPrimitivesResult> {
  readonly taskType = 'extract_primitives' as const;

  async execute(
    payload: UnitPreprocessedPayload,
    context: TaskContext,
    _checkpoint: TaskCheckpoint | null
  ): Promise<ExtractPrimitivesResult> {
    const { store, eventBus } = context;
    const { unitId, sessionId, spanIds } = payload;

    logger.info('Starting extraction', { unitId, spanCount: spanIds.length });

    // IDEMPOTENCY CHECK: If propositions already exist for this unit, skip LLM call
    // This prevents duplicate LLM calls on task retry
    const existingPropositions = await store.propositions.getByConversation(unitId);
    if (existingPropositions.length > 0) {
      logger.info('Propositions already exist, skipping LLM call', {
        unitId,
        existingCount: existingPropositions.length,
      });

      // Get stances via propositions (stances link to propositions, not directly to conversation)
      const stanceIds: string[] = [];
      for (const prop of existingPropositions) {
        const stances = await store.stances.getByProposition(prop.id);
        stanceIds.push(...stances.map((s) => s.id));
      }

      // Get relations that reference these propositions
      const relationIds: string[] = [];
      for (const prop of existingPropositions) {
        const sourceRels = await store.relations.getBySource(prop.id);
        const targetRels = await store.relations.getByTarget(prop.id);
        relationIds.push(...sourceRels.map((r) => r.id));
        relationIds.push(...targetRels.map((r) => r.id));
      }
      // Dedupe relation IDs
      const uniqueRelationIds = [...new Set(relationIds)];

      const result: ExtractPrimitivesResult = {
        unitId,
        sessionId,
        propositionIds: existingPropositions.map((p) => p.id),
        stanceIds,
        relationIds: uniqueRelationIds,
        rawEntityMentions: [], // Entity mentions already processed in resolve step
        llmMetadata: {
          model: 'skipped-already-extracted',
          tokensUsed: 0,
          processingTimeMs: 0,
        },
      };

      emitPrimitivesExtracted(eventBus, result);
      return result;
    }

    // Get unit
    const unit = await store.conversations.getById(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    // Get spans
    await context.checkpoint('get_spans');
    const spans: Span[] = [];
    for (const spanId of spanIds) {
      const span = await store.spans.getById(spanId);
      if (span) spans.push(span);
    }

    // Get context
    await context.checkpoint('get_context');
    const knownEntities = await this.getKnownEntities(store);
    const recentPropositions = await this.getRecentPropositions(store);

    // Build extraction input
    const extractionInput: PrimitiveExtractionInput = {
      utterance: {
        id: unit.id,
        rawText: unit.rawText,
        sessionId: unit.sessionId,
        timestamp: unit.timestamp,
        speaker: unit.speaker || 'user',
      },
      spans: spans.map((s) => ({
        id: s.id,
        charStart: s.charStart,
        charEnd: s.charEnd,
        textExcerpt: s.textExcerpt,
        patternId: s.patternId,
      })),
      knownEntities: knownEntities.map((e) => ({
        id: e.id,
        canonicalName: e.canonicalName,
        type: e.type,
        aliases: e.aliases,
      })),
      recentPropositions,
      llmTier: 'small',
    };

    // Run LLM extraction
    await context.checkpoint('llm_call');
    const extractionResult = await extractPrimitives(extractionInput);

    // Store results
    await context.checkpoint('store_results');
    const storedResults = await this.storeResults(extractionResult, unit, spans, store);

    // Save extraction traces
    await context.checkpoint('save_traces');
    await this.saveExtractionTraces(
      storedResults.propositions,
      storedResults.stances,
      spans,
      unit,
      extractionResult.metadata,
      store
    );

    // Convert raw entity mentions to the format needed for resolve step
    // Note: CreateEntityMention from primitiveExtractor has spanId, but charStart/charEnd
    // are only available if we look up the span. For simplicity, we omit those here
    // and the resolveAndDeriveHandler will link to spans as needed.
    const rawEntityMentions = extractionResult.entityMentions.map((m) => ({
      text: m.text,
      mentionType: m.mentionType,
      suggestedType: m.suggestedType,
      spanId: m.spanId,
    }));

    logger.info('Extraction complete', {
      unitId,
      propositions: storedResults.propositions.length,
      stances: storedResults.stances.length,
      relations: storedResults.relations.length,
      entityMentions: rawEntityMentions.length,
    });

    // Build result
    const result: ExtractPrimitivesResult = {
      unitId,
      sessionId,
      propositionIds: storedResults.propositions.map((p) => p.id),
      stanceIds: storedResults.stances.map((s) => s.id),
      relationIds: storedResults.relations.map((r) => r.id),
      rawEntityMentions,
      llmMetadata: {
        model: extractionResult.metadata.model,
        tokensUsed: extractionResult.metadata.tokensUsed,
        processingTimeMs: extractionResult.metadata.processingTimeMs,
      },
    };

    // CRITICAL: Save is complete, NOW emit event
    emitPrimitivesExtracted(eventBus, result);

    return result;
  }

  /**
   * Get known entities for context
   */
  private async getKnownEntities(
    store: TaskContext['store']
  ): Promise<Array<{ id: string; canonicalName: string; type: string; aliases: string[] }>> {
    const entities = await store.entities.getRecent(20);
    return entities.map((e: Entity) => {
      let aliases: string[] = [];
      try {
        aliases = JSON.parse(e.aliases || '[]');
      } catch {
        // Invalid JSON, use empty array
      }
      return {
        id: e.id,
        canonicalName: e.canonicalName,
        type: e.entityType,
        aliases,
      };
    });
  }

  /**
   * Get recent propositions for relation detection
   */
  private async getRecentPropositions(
    store: TaskContext['store']
  ): Promise<Array<{ id: string; content: string; subject: string }>> {
    const propositions = await store.propositions.getRecent(10);
    return propositions.map((p) => ({
      id: p.id,
      content: p.content,
      subject: p.subject,
    }));
  }

  /**
   * Store extraction results in primitive stores
   * Note: Entity mentions are NOT stored here - they're passed to the resolve step
   */
  private async storeResults(
    result: PrimitiveExtractionOutput,
    unit: { id: string },
    spans: Span[],
    store: TaskContext['store']
  ): Promise<{
    propositions: Proposition[];
    stances: Stance[];
    relations: Relation[];
  }> {
    const propositions: Proposition[] = [];
    const stances: Stance[] = [];
    const relations: Relation[] = [];

    // Map temp IDs to real IDs
    const propIdMap = new Map<string, string>();

    // Store propositions
    for (const propData of result.propositions) {
      // Find span IDs for this proposition
      const propSpanIds = propData.spanIds.filter((id) =>
        spans.some((s) => s.id === id)
      );

      const prop = await store.propositions.create({
        ...propData,
        spanIds: propSpanIds,
        conversationId: unit.id,
      });
      propositions.push(prop);

      // Map the temp ID used in stance to real ID
      const tempIdMatch = propData.conversationId?.match(/prop_\d+_\d+/);
      if (tempIdMatch) {
        propIdMap.set(propData.conversationId!, prop.id);
      }
    }

    // Store stances (update proposition IDs)
    for (let i = 0; i < result.stances.length; i++) {
      const stanceData = result.stances[i];
      const realPropId = propositions[i]?.id || stanceData.propositionId;

      const stance = await store.stances.create({
        ...stanceData,
        propositionId: realPropId,
      });
      stances.push(stance);
    }

    // Store relations (update proposition IDs)
    for (const relData of result.relations) {
      // Try to map temp IDs to real IDs
      const sourceId = propIdMap.get(relData.sourceId) || relData.sourceId;
      const targetId = propIdMap.get(relData.targetId) || relData.targetId;

      // Only create if both propositions exist
      const sourceExists = propositions.some((p) => p.id === sourceId);
      const targetExists = propositions.some((p) => p.id === targetId);

      if (sourceExists && targetExists) {
        const relation = await store.relations.create({
          ...relData,
          sourceId,
          targetId,
        });
        relations.push(relation);
      }
    }

    // Entity mentions are NOT stored here - passed to resolve step
    return { propositions, stances, relations };
  }

  /**
   * Save extraction traces for debugging
   */
  private async saveExtractionTraces(
    propositions: Proposition[],
    _stances: Stance[],
    spans: Span[],
    unit: { id: string; rawText: string },
    metadata: {
      llmPrompt: string;
      llmResponse: string;
      model: string;
      tokensUsed: number;
      processingTimeMs: number;
    },
    store: TaskContext['store']
  ): Promise<void> {
    try {
      for (const proposition of propositions) {
        const propSpans = spans.filter((s) =>
          proposition.spanIds?.includes(s.id)
        );
        const firstSpan = propSpans[0];

        await store.extractionTraces.create({
          targetType: 'proposition',
          targetId: proposition.id,
          conversationId: unit.id,
          inputText: unit.rawText,
          spanId: firstSpan?.id || null,
          charStart: firstSpan?.charStart ?? null,
          charEnd: firstSpan?.charEnd ?? null,
          matchedPattern: firstSpan?.patternId || null,
          matchedText: firstSpan?.textExcerpt || null,
          llmPrompt: metadata.llmPrompt,
          llmResponse: metadata.llmResponse,
          llmModel: metadata.model,
          llmTokensUsed: metadata.tokensUsed,
          processingTimeMs: metadata.processingTimeMs,
          extractorId: 'primitive-extractor',
          error: null,
        });
      }
    } catch (error) {
      logger.warn('Failed to save extraction traces', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Create a new extract primitives handler
 */
export function createExtractPrimitivesHandler(): ExtractPrimitivesHandler {
  return new ExtractPrimitivesHandler();
}
