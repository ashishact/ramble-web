/**
 * Resolve and Derive Handler
 *
 * Task: resolve_and_derive
 * Input: primitives:extracted event
 * Output: claims:derived event (also emits entities:resolved)
 *
 * Steps:
 * 1. Resolve entity mentions to canonical entities
 * 2. Get propositions and stances from DB
 * 3. Derive claims from proposition+stance pairs
 * 4. Save claims to DB
 * 5. Emit claims:derived event
 */

import type { TaskCheckpoint, Claim, ConversationUnit } from '../../types';
import type { Proposition, Stance, Span, CreateEntityMention } from '../../schemas/primitives';
import type { PipelineTaskHandler, TaskContext, ResolveAndDeriveResult } from './types';
import type { PrimitivesExtractedPayload } from '../events/types';
import { emitEntitiesResolved, emitClaimsDerived } from '../events/eventBus';
import { resolveEntities } from '../entityResolver';
import { deriveClaim } from '../claimDeriver';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ResolveAndDeriveHandler');

/**
 * Resolve and derive handler implementation
 */
export class ResolveAndDeriveHandler implements PipelineTaskHandler<PrimitivesExtractedPayload, ResolveAndDeriveResult> {
  readonly taskType = 'resolve_and_derive' as const;

  async execute(
    payload: PrimitivesExtractedPayload,
    context: TaskContext,
    _checkpoint: TaskCheckpoint | null
  ): Promise<ResolveAndDeriveResult> {
    const { store, eventBus } = context;
    const { unitId, sessionId, propositionIds, stanceIds, rawEntityMentions } = payload;

    logger.info('Starting resolve and derive', {
      unitId,
      propositions: propositionIds.length,
      stances: stanceIds.length,
      mentions: rawEntityMentions.length,
    });

    // Get unit
    const unit = await store.conversations.getById(unitId);
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`);
    }

    // Step 1: Resolve entity mentions
    await context.checkpoint('resolve_entities');
    const entityMentions: CreateEntityMention[] = rawEntityMentions.map((m) => ({
      text: m.text,
      mentionType: m.mentionType as CreateEntityMention['mentionType'],
      suggestedType: m.suggestedType as CreateEntityMention['suggestedType'],
      spanId: m.spanId || '', // spanId is required, default to empty if not provided
      conversationId: unitId,
      createdAt: Date.now(),
    }));

    const entityResolution = await resolveEntities({
      mentions: entityMentions,
      store,
      sessionId,
    });

    // Emit entities:resolved event
    emitEntitiesResolved(eventBus, {
      unitId,
      sessionId,
      resolvedMentionIds: entityResolution.resolvedMentions.map((m) => m.id),
      newEntityIds: entityResolution.newEntities.map((e) => e.id),
      stats: entityResolution.stats,
    });

    // Step 2: Get propositions and stances
    await context.checkpoint('get_primitives');
    const propositions: Proposition[] = [];
    const stances: Stance[] = [];

    for (const propId of propositionIds) {
      const prop = await store.propositions.getById(propId);
      if (prop) propositions.push(prop);
    }

    for (const stanceId of stanceIds) {
      const stance = await store.stances.getById(stanceId);
      if (stance) stances.push(stance);
    }

    // Get spans for trace generation
    const allSpans = await store.spans.getByConversation(unitId);

    // Step 3: Derive claims
    await context.checkpoint('derive_claims');
    const claims = await this.deriveClaims(
      propositions,
      stances,
      allSpans,
      unit,
      payload.llmMetadata,
      store
    );

    logger.info('Resolve and derive complete', {
      unitId,
      entitiesResolved: entityResolution.stats.matchedExisting + entityResolution.stats.createdNew,
      newEntities: entityResolution.newEntities.length,
      claims: claims.length,
    });

    // Build result
    const result: ResolveAndDeriveResult = {
      unitId,
      sessionId,
      resolvedMentionIds: entityResolution.resolvedMentions.map((m) => m.id),
      newEntityIds: entityResolution.newEntities.map((e) => e.id),
      claimIds: claims.map((c) => c.id),
      stats: entityResolution.stats,
    };

    // CRITICAL: Save is complete, NOW emit event
    emitClaimsDerived(eventBus, {
      unitId,
      sessionId,
      claimIds: result.claimIds,
    });

    return result;
  }

  /**
   * Derive and store claims from propositions and stances
   */
  private async deriveClaims(
    propositions: Proposition[],
    stances: Stance[],
    spans: Span[],
    unit: ConversationUnit,
    llmMetadata: { model: string; tokensUsed: number; processingTimeMs: number },
    store: TaskContext['store']
  ): Promise<Claim[]> {
    const claims: Claim[] = [];

    // Match propositions with their stances
    for (let i = 0; i < propositions.length; i++) {
      const proposition = propositions[i];
      const stance = stances[i];

      if (!proposition || !stance) {
        logger.warn('Missing proposition or stance pair', { index: i });
        continue;
      }

      // Derive claim from primitive pair
      const claimData = deriveClaim(proposition, stance, 'primitive-deriver');

      // Store the claim
      const claim = await store.claims.create(claimData);
      claims.push(claim);

      // Link claim to conversation unit
      await store.claims.addSource({ claimId: claim.id, unitId: unit.id });

      // Save extraction trace for this claim
      const propSpans = spans.filter((s) => proposition.spanIds?.includes(s.id));
      const firstSpan = propSpans[0];

      try {
        await store.extractionTraces.create({
          targetType: 'claim',
          targetId: claim.id,
          conversationId: unit.id,
          inputText: unit.rawText,
          spanId: firstSpan?.id || null,
          charStart: firstSpan?.charStart ?? null,
          charEnd: firstSpan?.charEnd ?? null,
          matchedPattern: firstSpan?.patternId || null,
          matchedText: firstSpan?.textExcerpt || null,
          llmPrompt: '', // LLM metadata from extraction step
          llmResponse: '',
          llmModel: llmMetadata.model,
          llmTokensUsed: llmMetadata.tokensUsed,
          processingTimeMs: llmMetadata.processingTimeMs,
          extractorId: 'claim-deriver',
          error: null,
        });
      } catch (err) {
        logger.warn('Failed to save claim trace', { claimId: claim.id });
      }

      logger.debug('Derived claim', {
        claimId: claim.id,
        propositionId: proposition.id,
        claimType: claim.claimType,
      });
    }

    return claims;
  }
}

/**
 * Create a new resolve and derive handler
 */
export function createResolveAndDeriveHandler(): ResolveAndDeriveHandler {
  return new ResolveAndDeriveHandler();
}
