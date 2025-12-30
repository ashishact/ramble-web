/**
 * Unit Pipeline - Simple Sequential Processor
 *
 * One unit → One pipeline run → All steps sequential
 * No events, no subscriptions, no complexity.
 *
 * Steps:
 * 1. Preprocess (sanitize, corrections, spans)
 * 2. Extract primitives (LLM call)
 * 3. Resolve entities + derive claims
 * 4. Mark complete
 */

import type { IProgramStore } from '../interfaces/store'
import type { ConversationUnit } from '../types'
import type { Span, CreateEntityMention } from '../schemas/primitives'
import { extractPrimitives, type PrimitiveExtractionInput } from '../extractors/primitiveExtractor'
import { resolveEntities } from './entityResolver'
import { deriveClaim } from './claimDeriver'
import { findPatternMatches } from '../extractors/patternMatcher'
import { extractorRegistry } from '../extractors/registry'
import { createLogger } from '../utils/logger'
import { now } from '../utils/time'

const logger = createLogger('UnitPipeline')

export interface PipelineResult {
  unitId: string
  success: boolean
  error?: string
  stats: {
    spans: number
    propositions: number
    stances: number
    relations: number
    entities: number
    claims: number
    processingTimeMs: number
  }
}

/**
 * Process a single unit through the entire pipeline.
 * This is the ONLY entry point for processing.
 * One call = one complete pipeline run.
 */
export async function processUnit(
  store: IProgramStore,
  unitId: string
): Promise<PipelineResult> {
  const startTime = Date.now()

  logger.info('Processing unit', { unitId })

  try {
    // Get unit
    const unit = await store.conversations.getById(unitId)
    if (!unit) {
      throw new Error(`Unit not found: ${unitId}`)
    }

    // Check if already processed (idempotency)
    if (unit.processed) {
      logger.info('Unit already processed, skipping', { unitId })
      return {
        unitId,
        success: true,
        stats: { spans: 0, propositions: 0, stances: 0, relations: 0, entities: 0, claims: 0, processingTimeMs: 0 }
      }
    }

    // Step 1: Compute spans (pattern matching)
    logger.debug('Step 1: Computing spans', { unitId })
    const spans = await computeSpans(store, unit)

    // Step 2: Check if primitives already exist (idempotency for LLM)
    const existingPropositions = await store.propositions.getByConversation(unitId)

    let propositionIds: string[] = []
    let stanceIds: string[] = []
    let relationIds: string[] = []
    let entityMentionData: CreateEntityMention[] = []

    if (existingPropositions.length > 0) {
      // Already extracted - use existing data
      logger.info('Primitives already exist, skipping LLM', { unitId, count: existingPropositions.length })
      propositionIds = existingPropositions.map(p => p.id)

      for (const prop of existingPropositions) {
        const stances = await store.stances.getByProposition(prop.id)
        stanceIds.push(...stances.map(s => s.id))
      }
    } else {
      // Step 2: Extract primitives (LLM call)
      logger.debug('Step 2: Extracting primitives', { unitId })
      const extractionResult = await runExtraction(store, unit, spans)
      propositionIds = extractionResult.propositionIds
      stanceIds = extractionResult.stanceIds
      relationIds = extractionResult.relationIds
      entityMentionData = extractionResult.entityMentions
    }

    // Step 3: Resolve entities
    logger.debug('Step 3: Resolving entities', { unitId })
    const entityResult = await resolveEntities({
      mentions: entityMentionData,
      store,
      sessionId: unit.sessionId,
    })

    // Step 4: Derive claims from propositions + stances
    logger.debug('Step 4: Deriving claims', { unitId })
    const claimIds = await deriveClaims(store, unitId, unit.sessionId, propositionIds)

    // Step 5: Mark complete
    logger.debug('Step 5: Marking complete', { unitId })
    await store.conversations.markProcessed(unitId)

    const processingTimeMs = Date.now() - startTime

    logger.info('Unit processed successfully', {
      unitId,
      spans: spans.length,
      propositions: propositionIds.length,
      stances: stanceIds.length,
      relations: relationIds.length,
      entities: entityResult.newEntities.length,
      claims: claimIds.length,
      processingTimeMs,
    })

    return {
      unitId,
      success: true,
      stats: {
        spans: spans.length,
        propositions: propositionIds.length,
        stances: stanceIds.length,
        relations: relationIds.length,
        entities: entityResult.newEntities.length,
        claims: claimIds.length,
        processingTimeMs,
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Pipeline failed', { unitId, error: errorMessage })

    return {
      unitId,
      success: false,
      error: errorMessage,
      stats: { spans: 0, propositions: 0, stances: 0, relations: 0, entities: 0, claims: 0, processingTimeMs: Date.now() - startTime }
    }
  }
}

/**
 * Compute spans using pattern matching
 */
async function computeSpans(
  store: IProgramStore,
  unit: ConversationUnit
): Promise<Span[]> {
  const text = unit.sanitizedText || unit.rawText
  const allExtractors = extractorRegistry.getAll()
  const matchResults = findPatternMatches(text, allExtractors)

  const spans: Span[] = []
  const now = Date.now()

  for (const result of matchResults) {
    for (const match of result.matches) {
      const span = await store.spans.create({
        conversationId: unit.id,
        charStart: match.position.start,
        charEnd: match.position.end,
        textExcerpt: match.text,
        matchedBy: 'pattern',
        patternId: match.patternId,
        createdAt: now,
      })
      spans.push(span)
    }
  }

  return spans
}

/**
 * Run LLM extraction and store results
 */
async function runExtraction(
  store: IProgramStore,
  unit: ConversationUnit,
  spans: Span[]
): Promise<{
  propositionIds: string[]
  stanceIds: string[]
  relationIds: string[]
  entityMentions: CreateEntityMention[]
}> {
  // Get context
  const knownEntities = await store.entities.getRecent(20)
  const recentPropositions = await store.propositions.getRecent(10)

  // Build input
  const input: PrimitiveExtractionInput = {
    utterance: {
      id: unit.id,
      rawText: unit.rawText,
      sessionId: unit.sessionId,
      timestamp: unit.timestamp,
      speaker: unit.speaker || 'user',
    },
    spans: spans.map(s => ({
      id: s.id,
      charStart: s.charStart,
      charEnd: s.charEnd,
      textExcerpt: s.textExcerpt,
      patternId: s.patternId,
    })),
    knownEntities: knownEntities.map(e => {
      let aliases: string[] = []
      try { aliases = JSON.parse(e.aliases || '[]') } catch { /* ignore */ }
      return { id: e.id, canonicalName: e.canonicalName, type: e.entityType, aliases }
    }),
    recentPropositions: recentPropositions.map(p => ({
      id: p.id,
      content: p.content,
      subject: p.subject,
    })),
    llmTier: 'small',
  }

  // Call LLM
  const result = await extractPrimitives(input)

  // Store propositions
  const propositionIds: string[] = []
  const propIdMap = new Map<string, string>()

  for (const propData of result.propositions) {
    const propSpanIds = propData.spanIds.filter(id => spans.some(s => s.id === id))
    const prop = await store.propositions.create({
      ...propData,
      spanIds: propSpanIds,
      conversationId: unit.id,
    })
    propositionIds.push(prop.id)
    if (propData.conversationId) {
      propIdMap.set(propData.conversationId, prop.id)
    }
  }

  // Store stances
  const stanceIds: string[] = []
  for (let i = 0; i < result.stances.length; i++) {
    const stanceData = result.stances[i]
    const realPropId = propositionIds[i] || stanceData.propositionId
    const stance = await store.stances.create({
      ...stanceData,
      propositionId: realPropId,
    })
    stanceIds.push(stance.id)
  }

  // Store relations
  const relationIds: string[] = []
  for (const relData of result.relations) {
    const sourceId = propIdMap.get(relData.sourceId) || relData.sourceId
    const targetId = propIdMap.get(relData.targetId) || relData.targetId

    const sourceExists = propositionIds.includes(sourceId)
    const targetExists = propositionIds.includes(targetId)

    if (sourceExists && targetExists) {
      const relation = await store.relations.create({
        ...relData,
        sourceId,
        targetId,
      })
      relationIds.push(relation.id)
    }
  }

  // Return entity mentions for resolution (not stored yet)
  const entityMentions: CreateEntityMention[] = result.entityMentions.map(m => ({
    conversationId: unit.id,
    text: m.text,
    mentionType: m.mentionType as CreateEntityMention['mentionType'],
    suggestedType: m.suggestedType as CreateEntityMention['suggestedType'],
    spanId: m.spanId,
    createdAt: now(),
  }))

  return { propositionIds, stanceIds, relationIds, entityMentions }
}

/**
 * Derive claims from propositions + stances
 */
async function deriveClaims(
  store: IProgramStore,
  unitId: string,
  _sessionId: string,
  propositionIds: string[]
): Promise<string[]> {
  const claimIds: string[] = []

  for (const propId of propositionIds) {
    const proposition = await store.propositions.getById(propId)
    if (!proposition) continue

    const stances = await store.stances.getByProposition(propId)
    if (stances.length === 0) continue

    // Use the first stance (primary stance for the proposition)
    const stance = stances[0]

    // Derive the claim
    const claimData = deriveClaim(proposition, stance)

    // Create the claim
    const claim = await store.claims.create(claimData)

    // Link claim to conversation unit
    await store.claims.addSource({
      claimId: claim.id,
      unitId,
    })

    claimIds.push(claim.id)
  }

  return claimIds
}
