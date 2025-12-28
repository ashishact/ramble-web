/**
 * Primitives Schema
 *
 * Layer 0: Conversation (stream) - uses ConversationUnit from conversation.ts
 * Layer 1: Proposition, Stance, Relation, Entity, Span
 *
 * These are the fundamental building blocks. Claims and other concepts
 * are derived from these primitives.
 */

import { z } from 'zod'

// Re-export discourse function from conversation schema
export { DiscourseFunctionSchema, type DiscourseFunction } from './conversation'

// ============================================================================
// LAYER 1: PRIMITIVES
// ============================================================================

// --- Proposition: What is said (content without modality) ---

export const PropositionTypeSchema = z.enum([
  'state',        // "The sky is blue"
  'event',        // "I went to the store"
  'process',      // "I'm learning to code"
  'hypothetical', // "If I had more time..."
  'generic',      // "Dogs are loyal"
])

export const PropositionSchema = z.object({
  id: z.string(),
  content: z.string(),           // The statement, stripped of "I think", "I believe", etc.
  subject: z.string(),           // Primary entity this is about
  type: PropositionTypeSchema,
  entityIds: z.array(z.string()),
  spanIds: z.array(z.string()),
  conversationId: z.string(),
  createdAt: z.number(),
})

export const CreatePropositionSchema = PropositionSchema.omit({ id: true })

// --- Stance: How the proposition is held ---

export const EvidenceTypeSchema = z.enum(['direct', 'inferred', 'hearsay', 'assumption'])
export const VolitionalTypeSchema = z.enum(['want', 'intend', 'hope', 'fear', 'prefer'])
export const DeonticSourceSchema = z.enum(['self', 'other', 'circumstance'])
export const DeonticTypeSchema = z.enum(['must', 'should', 'may', 'mustNot'])

export const EpistemicSchema = z.object({
  certainty: z.number().min(0).max(1),  // How sure? 0-1
  evidence: EvidenceTypeSchema,
})

export const VolitionalSchema = z.object({
  valence: z.number().min(-1).max(1),   // Want (+) vs Averse (-)
  strength: z.number().min(0).max(1),   // How strongly?
  type: VolitionalTypeSchema.optional(),
})

export const DeonticSchema = z.object({
  strength: z.number().min(0).max(1),   // Obligation strength
  source: DeonticSourceSchema.optional(),
  type: DeonticTypeSchema.optional(),
})

export const AffectiveSchema = z.object({
  valence: z.number().min(-1).max(1),   // Positive vs negative
  arousal: z.number().min(0).max(1),    // Calm vs excited
  emotions: z.array(z.string()).optional(),
})

export const StanceSchema = z.object({
  id: z.string(),
  propositionId: z.string(),
  holder: z.string(),  // 'speaker' or entity ID

  epistemic: EpistemicSchema,
  volitional: VolitionalSchema,
  deontic: DeonticSchema,
  affective: AffectiveSchema,

  expressedAt: z.number(),
  supersedes: z.string().optional(),  // Previous stance this replaces
})

export const CreateStanceSchema = StanceSchema.omit({ id: true })

// --- Relation: How propositions connect ---

export const RelationCategorySchema = z.enum([
  'causal',        // X causes Y
  'temporal',      // X before/after Y
  'logical',       // X implies Y, X contradicts Y
  'teleological',  // X is for purpose Y
  'compositional', // X is part of Y
  'contrastive',   // X but Y
  'conditional',   // If X then Y
])

export const RelationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),  // Proposition ID
  targetId: z.string(),  // Proposition ID
  category: RelationCategorySchema,
  subtype: z.string(),   // More specific (e.g., "because", "therefore")
  strength: z.number().min(0).max(1),
  spanIds: z.array(z.string()),
  createdAt: z.number(),
})

export const CreateRelationSchema = RelationSchema.omit({ id: true })

// --- EntityMention: Raw entity references in text (Layer 1) ---
// These are the raw mentions: "he", "John", "my boss", "the project"
// Resolution to canonical Entity happens in Layer 2

export const MentionTypeSchema = z.enum([
  'pronoun',              // he, she, it, they, I, you
  'proper_noun',          // John, Google, Paris
  'common_noun',          // the project, my boss, a friend
  'definite_description', // the CEO, the first one
  'self_reference',       // I, me, myself
])

export const SuggestedEntityTypeSchema = z.enum([
  'person',
  'organization',
  'project',
  'artifact',
  'event',
  'concept',
  'place',
  'self',
])

export const EntityMentionSchema = z.object({
  id: z.string(),
  text: z.string(),                          // Raw text: "he", "John", "my boss"
  mentionType: MentionTypeSchema,
  suggestedType: SuggestedEntityTypeSchema,  // Best guess at entity type
  spanId: z.string(),                        // Link to the span in text
  conversationId: z.string(),
  createdAt: z.number(),
  // Resolution (filled in by Layer 2 entity resolver)
  resolvedEntityId: z.string().optional(),   // Link to canonical Entity
})

export const CreateEntityMentionSchema = EntityMentionSchema.omit({ id: true })

// --- Legacy PrimitiveEntity (keeping for backward compat during migration) ---

export const PrimitiveEntityTypeSchema = z.enum([
  'person',
  'organization',
  'project',
  'artifact',
  'event',
  'concept',
  'place',
  'self',
])

export const PrimitiveEntitySchema = z.object({
  id: z.string(),
  canonicalName: z.string(),
  type: PrimitiveEntityTypeSchema,
  aliases: z.array(z.string()),
  attributes: z.record(z.string(), z.unknown()),
  firstSpanId: z.string(),
  mentionCount: z.number().default(1),
  lastMentioned: z.number(),
  createdAt: z.number(),
})

export const CreatePrimitiveEntitySchema = PrimitiveEntitySchema.omit({ id: true })

// --- Span: Text regions (computed in JS, not LLM) ---

export const SpanMatchTypeSchema = z.enum(['pattern', 'rule'])

export const SpanSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  charStart: z.number(),
  charEnd: z.number(),
  textExcerpt: z.string(),
  matchedBy: SpanMatchTypeSchema,
  patternId: z.string().optional(),
  createdAt: z.number(),
})

export const CreateSpanSchema = SpanSchema.omit({ id: true })

// ============================================================================
// DEFAULTS
// ============================================================================

export const DEFAULT_EPISTEMIC: z.infer<typeof EpistemicSchema> = {
  certainty: 0.5,
  evidence: 'inferred',
}

export const DEFAULT_VOLITIONAL: z.infer<typeof VolitionalSchema> = {
  valence: 0,
  strength: 0,
}

export const DEFAULT_DEONTIC: z.infer<typeof DeonticSchema> = {
  strength: 0,
}

export const DEFAULT_AFFECTIVE: z.infer<typeof AffectiveSchema> = {
  valence: 0,
  arousal: 0,
}

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type PropositionType = z.infer<typeof PropositionTypeSchema>
export type Proposition = z.infer<typeof PropositionSchema>
export type CreateProposition = z.infer<typeof CreatePropositionSchema>

export type EvidenceType = z.infer<typeof EvidenceTypeSchema>
export type VolitionalType = z.infer<typeof VolitionalTypeSchema>
export type DeonticSource = z.infer<typeof DeonticSourceSchema>
export type DeonticType = z.infer<typeof DeonticTypeSchema>
export type Epistemic = z.infer<typeof EpistemicSchema>
export type Volitional = z.infer<typeof VolitionalSchema>
export type Deontic = z.infer<typeof DeonticSchema>
export type Affective = z.infer<typeof AffectiveSchema>
export type Stance = z.infer<typeof StanceSchema>
export type CreateStance = z.infer<typeof CreateStanceSchema>

export type RelationCategory = z.infer<typeof RelationCategorySchema>
export type Relation = z.infer<typeof RelationSchema>
export type CreateRelation = z.infer<typeof CreateRelationSchema>

export type MentionType = z.infer<typeof MentionTypeSchema>
export type SuggestedEntityType = z.infer<typeof SuggestedEntityTypeSchema>
export type EntityMention = z.infer<typeof EntityMentionSchema>
export type CreateEntityMention = z.infer<typeof CreateEntityMentionSchema>

// Legacy (kept for backward compat)
export type PrimitiveEntityType = z.infer<typeof PrimitiveEntityTypeSchema>
export type PrimitiveEntity = z.infer<typeof PrimitiveEntitySchema>
export type CreatePrimitiveEntity = z.infer<typeof CreatePrimitiveEntitySchema>

export type SpanMatchType = z.infer<typeof SpanMatchTypeSchema>
export type Span = z.infer<typeof SpanSchema>
export type CreateSpan = z.infer<typeof CreateSpanSchema>
