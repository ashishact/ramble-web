/**
 * Entity Resolver (Layer 2)
 *
 * Resolves Layer 1 EntityMentions to canonical Layer 2 Entities.
 *
 * Resolution strategies:
 * 1. Exact name match - "John" matches existing Entity "John"
 * 2. Alias match - "Johnny" matches Entity with alias "Johnny"
 * 3. Pronoun resolution - "he" resolves to most recent male person entity
 * 4. Definite description - "the project" resolves to most salient project
 * 5. Create new - If no match, create new canonical Entity
 */

import type { IProgramStore } from '../interfaces/store'
import type { EntityMention, CreateEntityMention, SuggestedEntityType } from '../schemas/primitives'
import type { Entity, EntityType } from '../types'
import type { VocabularyEntityType } from '../schemas/vocabulary'
import { createSTTEntityMatcher } from './sttEntityMatcher'
import { createLogger } from '../utils/logger'

const logger = createLogger('Pipeline')

// ============================================================================
// Types
// ============================================================================

export interface EntityResolutionInput {
  /** Entity mentions to resolve */
  mentions: CreateEntityMention[]
  /** Store for entity lookup and creation */
  store: IProgramStore
  /** Session ID for context */
  sessionId: string
}

export interface EntityResolutionOutput {
  /** Resolved mentions with entityId filled in */
  resolvedMentions: EntityMention[]
  /** Newly created entities */
  newEntities: Entity[]
  /** Resolution stats */
  stats: {
    total: number
    matchedExisting: number
    createdNew: number
    pronounsResolved: number
  }
}

interface RecentEntityContext {
  entities: Entity[]
  lastMalePerson?: Entity
  lastFemalePerson?: Entity
  lastNeutralEntity?: Entity
  lastProject?: Entity
  lastOrganization?: Entity
}

// ============================================================================
// Main Resolver
// ============================================================================

/**
 * Resolve entity mentions to canonical entities
 */
export async function resolveEntities(
  input: EntityResolutionInput
): Promise<EntityResolutionOutput> {
  const { mentions, store } = input

  const resolvedMentions: EntityMention[] = []
  const newEntities: Entity[] = []
  const stats = {
    total: mentions.length,
    matchedExisting: 0,
    createdNew: 0,
    pronounsResolved: 0,
  }

  // Get recent entities for pronoun resolution context
  const recentContext = await buildRecentContext(store)

  for (const mention of mentions) {
    const resolution = await resolveMention(mention, recentContext, store)

    if (resolution.isNew && resolution.entity) {
      newEntities.push(resolution.entity)
      stats.createdNew++
    } else if (resolution.entity) {
      stats.matchedExisting++
      if (mention.mentionType === 'pronoun') {
        stats.pronounsResolved++
      }
    }

    // Store the mention with resolved entity ID
    const storedMention = await store.entityMentions.create({
      ...mention,
      resolvedEntityId: resolution.entity?.id,
    })
    resolvedMentions.push(storedMention)

    // Update context for subsequent pronoun resolution
    if (resolution.entity) {
      updateContext(recentContext, resolution.entity, mention)
    }
  }

  logger.debug('Entity resolution complete', stats)

  return { resolvedMentions, newEntities, stats }
}

// ============================================================================
// Resolution Logic
// ============================================================================

interface ResolutionResult {
  entity: Entity | null
  isNew: boolean
}

async function resolveMention(
  mention: CreateEntityMention,
  context: RecentEntityContext,
  store: IProgramStore
): Promise<ResolutionResult> {
  // Strategy based on mention type
  switch (mention.mentionType) {
    case 'pronoun':
      return resolvePronoun(mention, context)

    case 'proper_noun':
      return resolveProperNoun(mention, store)

    case 'self_reference':
      return resolveSelfReference(mention, store)

    case 'common_noun':
    case 'definite_description':
      return resolveDescription(mention, context, store)

    default:
      return resolveByName(mention, store)
  }
}

/**
 * Resolve pronouns using recent context
 */
function resolvePronoun(
  mention: CreateEntityMention,
  context: RecentEntityContext
): ResolutionResult {
  const text = mention.text.toLowerCase()

  // Personal pronouns
  if (['he', 'him', 'his'].includes(text)) {
    return { entity: context.lastMalePerson || null, isNew: false }
  }
  if (['she', 'her', 'hers'].includes(text)) {
    return { entity: context.lastFemalePerson || null, isNew: false }
  }
  if (['it', 'its'].includes(text)) {
    return { entity: context.lastNeutralEntity || null, isNew: false }
  }
  if (['they', 'them', 'their'].includes(text)) {
    // Could be plural or gender-neutral singular - use last entity
    return { entity: context.entities[0] || null, isNew: false }
  }

  // Can't resolve - return null (mention will have no resolvedEntityId)
  return { entity: null, isNew: false }
}

/**
 * Resolve proper nouns by exact/alias match, STT vocabulary, or create new
 */
async function resolveProperNoun(
  mention: CreateEntityMention,
  store: IProgramStore
): Promise<ResolutionResult> {
  // Try exact match
  const existing = await store.entities.getByName(mention.text)
  if (existing) {
    // Update mention count
    await store.entities.update(existing.id, {
      mentionCount: existing.mentionCount + 1,
      lastReferenced: Date.now(),
    })
    return { entity: existing, isNew: false }
  }

  // Try alias match
  const byAlias = await findByAlias(mention.text, store)
  if (byAlias) {
    await store.entities.update(byAlias.id, {
      mentionCount: byAlias.mentionCount + 1,
      lastReferenced: Date.now(),
    })
    return { entity: byAlias, isNew: false }
  }

  // Try STT vocabulary match (phonetic + fuzzy)
  const sttMatcher = createSTTEntityMatcher(store.vocabulary)
  const entityType = mapSuggestedToEntityType(mention.suggestedType) as VocabularyEntityType
  const sttMatch = await sttMatcher.match(mention.text, entityType)

  if (sttMatch.matched && sttMatch.vocabularyEntry) {
    const vocab = sttMatch.vocabularyEntry

    // Find the entity with correct spelling
    let entity = await store.entities.getByName(vocab.correctSpelling)
    if (!entity && vocab.sourceEntityId) {
      entity = await store.entities.getById(vocab.sourceEntityId)
    }

    if (entity) {
      // Add STT variant as alias if not already present
      const aliases = JSON.parse(entity.aliases || '[]') as string[]
      const sttVariant = sttMatch.sttVariant
      if (!aliases.includes(sttVariant) &&
          sttVariant.toLowerCase() !== entity.canonicalName.toLowerCase()) {
        aliases.push(sttVariant)
        await store.entities.update(entity.id, {
          aliases: JSON.stringify(aliases),
          mentionCount: entity.mentionCount + 1,
          lastReferenced: Date.now(),
        })
      } else {
        await store.entities.update(entity.id, {
          mentionCount: entity.mentionCount + 1,
          lastReferenced: Date.now(),
        })
      }

      // Update vocabulary usage stats
      await store.vocabulary.incrementUsageCount(vocab.id)
      await store.vocabulary.incrementVariantCount(vocab.id, sttVariant)

      logger.debug('STT match resolved', {
        sttText: mention.text,
        canonical: vocab.correctSpelling,
        matchType: sttMatch.matchType,
        confidence: sttMatch.confidence,
      })

      return { entity, isNew: false }
    }

    // Vocabulary exists but no entity - create entity with correct spelling
    const newEntity = await store.entities.create({
      canonicalName: vocab.correctSpelling,
      entityType: vocab.entityType as EntityType,
      aliases: JSON.stringify([sttMatch.sttVariant]),
    })

    // Link vocabulary to new entity
    await store.vocabulary.update(vocab.id, { sourceEntityId: newEntity.id })

    return { entity: newEntity, isNew: true }
  }

  // Create new entity with STT text as canonical
  const newEntity = await store.entities.create({
    canonicalName: mention.text,
    entityType: mapSuggestedToEntityType(mention.suggestedType),
    aliases: JSON.stringify([]),
  })

  return { entity: newEntity, isNew: true }
}

/**
 * Resolve self-references ("I", "me", "myself")
 */
async function resolveSelfReference(
  _mention: CreateEntityMention,
  store: IProgramStore
): Promise<ResolutionResult> {
  // Look for existing "self" entity or the user entity
  const selfEntity = await store.entities.getByName('self')
  if (selfEntity) {
    await store.entities.update(selfEntity.id, {
      mentionCount: selfEntity.mentionCount + 1,
      lastReferenced: Date.now(),
    })
    return { entity: selfEntity, isNew: false }
  }

  // Create self entity
  const newEntity = await store.entities.create({
    canonicalName: 'self',
    entityType: 'person',
    aliases: JSON.stringify(['I', 'me', 'myself', 'my']),
  })

  return { entity: newEntity, isNew: true }
}

/**
 * Resolve definite descriptions and common nouns
 */
async function resolveDescription(
  mention: CreateEntityMention,
  context: RecentEntityContext,
  store: IProgramStore
): Promise<ResolutionResult> {
  // Try to match by type in recent context
  const entityType = mapSuggestedToEntityType(mention.suggestedType)

  // Look for recent entity of same type
  const recentOfType = context.entities.find(
    e => e.entityType === entityType
  )

  if (recentOfType) {
    await store.entities.update(recentOfType.id, {
      mentionCount: recentOfType.mentionCount + 1,
      lastReferenced: Date.now(),
    })
    return { entity: recentOfType, isNew: false }
  }

  // Create new entity with the description as name
  const newEntity = await store.entities.create({
    canonicalName: mention.text,
    entityType,
    aliases: JSON.stringify([]),
  })

  return { entity: newEntity, isNew: true }
}

/**
 * Generic name-based resolution
 */
async function resolveByName(
  mention: CreateEntityMention,
  store: IProgramStore
): Promise<ResolutionResult> {
  const existing = await store.entities.getByName(mention.text)
  if (existing) {
    await store.entities.update(existing.id, {
      mentionCount: existing.mentionCount + 1,
      lastReferenced: Date.now(),
    })
    return { entity: existing, isNew: false }
  }

  const newEntity = await store.entities.create({
    canonicalName: mention.text,
    entityType: mapSuggestedToEntityType(mention.suggestedType),
    aliases: JSON.stringify([]),
  })

  return { entity: newEntity, isNew: true }
}

// ============================================================================
// Helper Functions
// ============================================================================

async function buildRecentContext(store: IProgramStore): Promise<RecentEntityContext> {
  // Get recent entities for context (last 10)
  const entities = await store.entities.getRecent(10)

  const context: RecentEntityContext = {
    entities,
  }

  // Find last entities of specific types for pronoun resolution
  for (const entity of entities) {
    if (entity.entityType === 'person') {
      // For now, treat all persons as potential pronoun antecedents
      // In future, could use name heuristics or metadata for gender
      if (!context.lastMalePerson) {
        context.lastMalePerson = entity
      }
      if (!context.lastFemalePerson) {
        context.lastFemalePerson = entity
      }
    } else if (entity.entityType === 'project' && !context.lastProject) {
      context.lastProject = entity
    } else if (entity.entityType === 'organization' && !context.lastOrganization) {
      context.lastOrganization = entity
    } else if (!context.lastNeutralEntity) {
      context.lastNeutralEntity = entity
    }
  }

  return context
}

function updateContext(
  context: RecentEntityContext,
  entity: Entity,
  mention: CreateEntityMention
): void {
  // Add to front of entities list
  context.entities = [entity, ...context.entities.filter(e => e.id !== entity.id)].slice(0, 10)

  // Update type-specific refs
  if (entity.entityType === 'person') {
    // Use mention text to guess gender (simple heuristic)
    const text = mention.text.toLowerCase()
    if (['he', 'him', 'his'].includes(text)) {
      context.lastMalePerson = entity
    } else if (['she', 'her', 'hers'].includes(text)) {
      context.lastFemalePerson = entity
    } else {
      // Default to both for proper nouns
      context.lastMalePerson = entity
      context.lastFemalePerson = entity
    }
  } else if (entity.entityType === 'project') {
    context.lastProject = entity
  } else if (entity.entityType === 'organization') {
    context.lastOrganization = entity
  } else {
    context.lastNeutralEntity = entity
  }
}

async function findByAlias(name: string, store: IProgramStore): Promise<Entity | null> {
  // Get all entities and check aliases
  const entities = await store.entities.getRecent(100)
  const lowerName = name.toLowerCase()

  for (const entity of entities) {
    try {
      const aliases = JSON.parse(entity.aliases || '[]') as string[]
      if (aliases.some(a => a.toLowerCase() === lowerName)) {
        return entity
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null
}

/**
 * Map Layer 1 SuggestedEntityType to Layer 2 EntityType
 */
function mapSuggestedToEntityType(suggested: SuggestedEntityType): EntityType {
  const mapping: Record<SuggestedEntityType, EntityType> = {
    person: 'person',
    organization: 'organization',
    project: 'project',
    artifact: 'product',
    event: 'event',
    concept: 'concept',
    place: 'place',
    self: 'person',
  }
  return mapping[suggested] || 'concept'
}
