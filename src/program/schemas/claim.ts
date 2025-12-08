/**
 * Claim Schema
 *
 * Claims are the core unit of knowledge in the system.
 * Each claim represents a statement extracted from conversation.
 */

import { z } from 'zod';

/**
 * Claim type - categorizes the nature of the claim
 */
export const ClaimTypeSchema = z.enum([
  'factual',
  'belief',
  'intention',
  'assessment',
  'preference',
  'causal',
  'question',
  'decision',
  'emotion',
  'goal',
  'value',
  'relationship',
  'self_perception',
  'habit',
  'memory_reference',
  'concern',
  'learning',
  'change_marker',
  'hypothetical',
  'commitment',
]);

/**
 * Temporality - how long the claim remains valid
 */
export const TemporalitySchema = z.enum([
  'eternal', // Always true (math facts, etc.)
  'slowly_decaying', // Changes over years
  'fast_decaying', // Changes over days/weeks
  'point_in_time', // True only at a specific moment
]);

/**
 * Abstraction level - how general the claim is
 */
export const AbstractionSchema = z.enum([
  'specific', // About a specific instance
  'general', // General pattern
  'universal', // Universal claim
]);

/**
 * Source type - where the claim came from
 */
export const SourceTypeSchema = z.enum([
  'direct', // Directly stated
  'inferred', // Inferred from context
  'corrected', // Corrected from earlier statement
]);

/**
 * Claim state - lifecycle state
 */
export const ClaimStateSchema = z.enum([
  'active', // Currently valid
  'stale', // May no longer be valid
  'dormant', // Not recently referenced
  'superseded', // Replaced by a newer claim
]);

/**
 * Stakes level - importance of the claim
 */
export const StakesSchema = z.enum(['low', 'medium', 'high', 'existential']);

/**
 * Main claim schema
 */
export const ClaimSchema = z.object({
  id: z.string(),
  statement: z.string(),
  subject: z.string(),
  claim_type: ClaimTypeSchema,
  temporality: TemporalitySchema,
  abstraction: AbstractionSchema,
  source_type: SourceTypeSchema,
  initial_confidence: z.number().min(0).max(1),
  current_confidence: z.number().min(0).max(1),
  state: ClaimStateSchema,
  emotional_valence: z.number().min(-1).max(1), // -1 negative, 0 neutral, 1 positive
  emotional_intensity: z.number().min(0).max(1),
  stakes: StakesSchema,
  valid_from: z.number(), // Unix timestamp ms
  valid_until: z.number().nullable(),
  created_at: z.number(),
  last_confirmed: z.number(),
  confirmation_count: z.number().int().nonnegative(),
  extraction_program_id: z.string(),
  superseded_by: z.string().nullable(),
  elaborates: z.string().nullable(), // Links to another claim this elaborates
  thought_chain_id: z.string().nullable(),
});

/**
 * Schema for creating a new claim
 */
export const CreateClaimSchema = ClaimSchema.omit({
  id: true,
  created_at: true,
  last_confirmed: true,
  confirmation_count: true,
  state: true,
  current_confidence: true,
  superseded_by: true,
}).extend({
  state: ClaimStateSchema.default('active'),
  confirmation_count: z.number().int().nonnegative().default(1),
  superseded_by: z.string().nullable().default(null),
});

/**
 * Schema for updating a claim
 */
export const UpdateClaimSchema = ClaimSchema.partial().omit({ id: true, created_at: true });

/**
 * Claim to source unit relationship (many-to-many)
 */
export const ClaimSourceSchema = z.object({
  id: z.string(),
  claim_id: z.string(),
  unit_id: z.string(),
});

/**
 * Schema for creating a claim source
 */
export const CreateClaimSourceSchema = ClaimSourceSchema.omit({ id: true });
