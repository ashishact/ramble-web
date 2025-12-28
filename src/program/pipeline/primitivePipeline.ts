/**
 * Primitive Pipeline
 *
 * Processes conversation units through the layered architecture:
 * 1. Compute spans via pattern matching (JS, deterministic)
 * 2. Extract primitives via single LLM call (Proposition, Stance, Relation, EntityMention)
 * 3. Store Layer 1 primitives
 * 4. Resolve EntityMentions to canonical Entities (Layer 2)
 * 5. Derive Claims from Proposition + Stance (Layer 2)
 * 6. Store Claims
 *
 * Flow: ConversationUnit → Span → Primitives → EntityResolution → Claims
 */

import type { IProgramStore } from '../interfaces/store'
import type { ConversationUnit, Claim, Entity } from '../types'
import type {
  Proposition,
  Stance,
  Relation,
  EntityMention,
  Span,
  DiscourseFunction,
} from '../schemas/primitives'
import {
  extractPrimitives,
  type PrimitiveExtractionInput,
  type PrimitiveExtractionOutput,
} from '../extractors/primitiveExtractor'
import { resolveEntities } from './entityResolver'
import { findPatternMatches } from '../extractors/patternMatcher'
import { extractorRegistry } from '../extractors/registry'
import { deriveClaim } from './claimDeriver'
import { createLogger } from '../utils/logger'

const logger = createLogger('PrimitivePipeline')

// ============================================================================
// Types
// ============================================================================

export interface PrimitivePipelineInput {
  /** The conversation unit to process */
  unit: ConversationUnit
  /** Store for reading context and writing results */
  store: IProgramStore
}

export interface PrimitivePipelineOutput {
  /** Created propositions (Layer 1) */
  propositions: Proposition[]
  /** Created stances (Layer 1) */
  stances: Stance[]
  /** Created relations (Layer 1) */
  relations: Relation[]
  /** Entity mentions (Layer 1 - raw text references) */
  entityMentions: EntityMention[]
  /** Resolved entities (Layer 2 - canonical) */
  entities: Entity[]
  /** Created spans (Layer 1) */
  spans: Span[]
  /** Derived claims (Layer 2) */
  claims: Claim[]
  /** Processing metadata */
  metadata: {
    processingTimeMs: number
    tokensUsed: number
    spansComputed: number
    claimsDerived: number
    entitiesResolved: number
    llmModel: string
  }
}

// ============================================================================
// Pipeline Implementation
// ============================================================================

/**
 * Run the primitive extraction pipeline on a conversation unit
 */
export async function runPrimitivePipeline(
  input: PrimitivePipelineInput
): Promise<PrimitivePipelineOutput> {
  const startTime = Date.now()
  const { unit, store } = input

  logger.info('Starting primitive pipeline', {
    unitId: unit.id,
    textLength: unit.sanitizedText.length,
  })

  try {
    // Step 1: Compute spans via pattern matching (deterministic, no LLM)
    const spans = await computeSpans(unit, store)

    // Step 2: Get known entities for context
    const knownEntities = await getKnownEntities(store)

    // Step 3: Get recent propositions for relation detection
    const recentPropositions = await getRecentPropositions(store)

    // Step 4: Build extraction input
    const extractionInput: PrimitiveExtractionInput = {
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
      knownEntities: knownEntities.map(e => ({
        id: e.id,
        canonicalName: e.canonicalName,
        type: e.type,
        aliases: e.aliases,
      })),
      recentPropositions,
      llmTier: 'small',
    }

    // Step 5: Run primitive extraction (single LLM call)
    const extractionResult = await extractPrimitives(extractionInput)

    // Step 6: Store Layer 1 primitives (propositions, stances, relations)
    const storedResults = await storeResults(
      extractionResult,
      unit,
      spans,
      store
    )

    // Step 7: Resolve entity mentions to canonical entities (Layer 2)
    const entityResolution = await resolveEntities({
      mentions: extractionResult.entityMentions,
      store,
      sessionId: unit.sessionId,
    })

    // Step 8: Derive Claims from Proposition + Stance (Layer 2)
    const claims = await deriveClaims(
      storedResults.propositions,
      storedResults.stances,
      unit,
      store
    )

    // Step 9: Mark conversation unit as processed
    await store.conversations.markProcessed(unit.id)

    const processingTimeMs = Date.now() - startTime
    logger.info('Primitive pipeline complete', {
      propositions: storedResults.propositions.length,
      stances: storedResults.stances.length,
      claims: claims.length,
      entityMentions: entityResolution.resolvedMentions.length,
      entities: entityResolution.newEntities.length,
      pronounsResolved: entityResolution.stats.pronounsResolved,
      spans: spans.length,
      processingTimeMs,
    })

    return {
      propositions: storedResults.propositions,
      stances: storedResults.stances,
      relations: storedResults.relations,
      entityMentions: entityResolution.resolvedMentions,
      entities: entityResolution.newEntities,
      spans,
      claims,
      metadata: {
        processingTimeMs,
        tokensUsed: extractionResult.metadata.tokensUsed,
        spansComputed: spans.length,
        claimsDerived: claims.length,
        entitiesResolved: entityResolution.stats.matchedExisting + entityResolution.stats.createdNew,
        llmModel: extractionResult.metadata.model,
      },
    }
  } catch (error) {
    logger.error('Primitive pipeline failed', {
      unitId: unit.id,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
    throw error
  }
}

// ============================================================================
// Helper: Infer discourse function from text patterns
// ============================================================================

export function inferDiscourseFunction(text: string): DiscourseFunction {
  const trimmed = text.trim().toLowerCase()

  // Question detection
  if (trimmed.endsWith('?') || /^(what|who|where|when|why|how|is|are|do|does|can|will|should)\b/.test(trimmed)) {
    return 'question'
  }

  // Command detection
  if (/^(please|could you|can you|would you|help me|show me|tell me|give me)\b/.test(trimmed)) {
    return 'command'
  }

  // Commitment detection
  if (/\b(i will|i'll|i promise|i'm going to|i am going to|i commit)\b/.test(trimmed)) {
    return 'commit'
  }

  // Emotion expression detection
  if (/\b(i feel|i'm feeling|i am feeling|i'm so|i am so|i love|i hate|i'm happy|i'm sad|i'm angry)\b/.test(trimmed)) {
    return 'express'
  }

  // Default to assertion
  return 'assert'
}

// ============================================================================
// Step Implementations
// ============================================================================

/**
 * Compute spans using pattern matching from existing extractors
 */
async function computeSpans(
  unit: ConversationUnit,
  store: IProgramStore
): Promise<Span[]> {
  const allExtractors = extractorRegistry.getAll()
  const matchResults = findPatternMatches(unit.sanitizedText, allExtractors)

  const spans: Span[] = []
  const now = Date.now()

  for (const result of matchResults) {
    for (const match of result.matches) {
      // Create span in database
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
 * Get known entities for context (from Layer 2 canonical entities)
 */
async function getKnownEntities(store: IProgramStore): Promise<Array<{
  id: string
  canonicalName: string
  type: string
  aliases: string[]
}>> {
  const entities = await store.entities.getRecent(20)
  return entities.map((e: Entity) => {
    let aliases: string[] = []
    try {
      aliases = JSON.parse(e.aliases || '[]')
    } catch {
      // Invalid JSON, use empty array
    }
    return {
      id: e.id,
      canonicalName: e.canonicalName,
      type: e.entityType,
      aliases,
    }
  })
}

/**
 * Get recent propositions for relation detection
 */
async function getRecentPropositions(store: IProgramStore): Promise<Array<{
  id: string
  content: string
  subject: string
}>> {
  const propositions = await store.propositions.getRecent(10)
  return propositions.map(p => ({
    id: p.id,
    content: p.content,
    subject: p.subject,
  }))
}

/**
 * Store extraction results in primitive stores
 * Note: Entity mentions are handled separately by resolveEntities()
 */
async function storeResults(
  result: PrimitiveExtractionOutput,
  unit: ConversationUnit,
  spans: Span[],
  store: IProgramStore
): Promise<{
  propositions: Proposition[]
  stances: Stance[]
  relations: Relation[]
}> {
  const propositions: Proposition[] = []
  const stances: Stance[] = []
  const relations: Relation[] = []

  // Map temp IDs to real IDs
  const propIdMap = new Map<string, string>()

  // Store propositions
  for (const propData of result.propositions) {
    // Find span IDs for this proposition
    const propSpanIds = propData.spanIds.filter(id =>
      spans.some(s => s.id === id)
    )

    const prop = await store.propositions.create({
      ...propData,
      spanIds: propSpanIds,
      conversationId: unit.id,
    })
    propositions.push(prop)

    // Map the temp ID used in stance to real ID
    const tempIdMatch = propData.conversationId?.match(/prop_\d+_\d+/)
    if (tempIdMatch) {
      propIdMap.set(propData.conversationId, prop.id)
    }
  }

  // Store stances (update proposition IDs)
  for (let i = 0; i < result.stances.length; i++) {
    const stanceData = result.stances[i]
    const realPropId = propositions[i]?.id || stanceData.propositionId

    const stance = await store.stances.create({
      ...stanceData,
      propositionId: realPropId,
    })
    stances.push(stance)
  }

  // Store relations (update proposition IDs)
  for (const relData of result.relations) {
    // Try to map temp IDs to real IDs
    const sourceId = propIdMap.get(relData.sourceId) || relData.sourceId
    const targetId = propIdMap.get(relData.targetId) || relData.targetId

    // Only create if both propositions exist
    const sourceExists = propositions.some(p => p.id === sourceId)
    const targetExists = propositions.some(p => p.id === targetId)

    if (sourceExists && targetExists) {
      const relation = await store.relations.create({
        ...relData,
        sourceId,
        targetId,
      })
      relations.push(relation)
    }
  }

  // Entity mentions are handled by resolveEntities() in the main pipeline
  return { propositions, stances, relations }
}

// ============================================================================
// Layer 2: Claim Derivation
// ============================================================================

/**
 * Derive and store claims from propositions and stances
 *
 * Each Proposition + Stance pair produces one Claim.
 * Claims are the Layer 2 derived concepts built on Layer 1 primitives.
 */
async function deriveClaims(
  propositions: Proposition[],
  stances: Stance[],
  unit: ConversationUnit,
  store: IProgramStore
): Promise<Claim[]> {
  const claims: Claim[] = []

  // Match propositions with their stances
  for (let i = 0; i < propositions.length; i++) {
    const proposition = propositions[i]
    const stance = stances[i]

    if (!proposition || !stance) {
      logger.warn('Missing proposition or stance pair', { index: i })
      continue
    }

    // Derive claim from primitive pair
    const claimData = deriveClaim(proposition, stance, 'primitive-deriver')

    // Store the claim
    const claim = await store.claims.create(claimData)
    claims.push(claim)

    // Link claim to conversation unit
    await store.claims.addSource({ claimId: claim.id, unitId: unit.id })

    logger.debug('Derived claim', {
      claimId: claim.id,
      propositionId: proposition.id,
      claimType: claim.claimType,
    })
  }

  return claims
}
