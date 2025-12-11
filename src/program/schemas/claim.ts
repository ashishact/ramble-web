/**
 * Claim Schema
 *
 * Claims are the core unit of knowledge in the system.
 * Each claim represents a statement extracted from conversation.
 */

import { z } from 'zod';
import { MemoryTierSchema } from './memory';

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
  'slowlyDecaying', // Changes over years
  'fastDecaying', // Changes over days/weeks
  'pointInTime', // True only at a specific moment
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
  claimType: ClaimTypeSchema,
  temporality: TemporalitySchema,
  abstraction: AbstractionSchema,
  sourceType: SourceTypeSchema,
  initialConfidence: z.number().min(0).max(1),
  currentConfidence: z.number().min(0).max(1),
  state: ClaimStateSchema,
  emotionalValence: z.number().min(-1).max(1), // -1 negative, 0 neutral, 1 positive
  emotionalIntensity: z.number().min(0).max(1),
  stakes: StakesSchema,
  validFrom: z.number(), // Unix timestamp ms
  validUntil: z.number().nullable(),
  createdAt: z.number(),
  lastConfirmed: z.number(),
  confirmationCount: z.number().int().nonnegative(),
  extractionProgramId: z.string(),
  supersededBy: z.string().nullable(),
  elaborates: z.string().nullable(), // Links to another claim this elaborates

  // Memory system fields
  memoryTier: MemoryTierSchema,        // 'working' | 'longTerm'
  salience: z.number().min(0).max(1),   // Computed salience score
  promotedAt: z.number().nullable(),   // When promoted to LTM
  lastAccessed: z.number(),            // When last viewed in UI (for salience boost)
});

/**
 * Schema for creating a new claim
 * Uses .optional().default() pattern for TypeScript to recognize optional fields
 */
export const CreateClaimSchema = ClaimSchema.omit({
  id: true,
  createdAt: true,
  lastConfirmed: true,
  confirmationCount: true,
  state: true,
  currentConfidence: true,
  supersededBy: true,
  memoryTier: true,
  salience: true,
  promotedAt: true,
  lastAccessed: true,
}).extend({
  state: ClaimStateSchema.optional().default('active'),
  confirmationCount: z.number().int().nonnegative().optional().default(1),
  supersededBy: z.string().nullable().optional().default(null),
  memoryTier: MemoryTierSchema.optional().default('working'),
  salience: z.number().min(0).max(1).optional().default(0),
  promotedAt: z.number().nullable().optional().default(null),
});

/**
 * Schema for updating a claim
 */
export const UpdateClaimSchema = ClaimSchema.partial().omit({ id: true, createdAt: true });

/**
 * Claim to source unit relationship (many-to-many)
 */
export const ClaimSourceSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  unitId: z.string(),
});

/**
 * Schema for creating a claim source
 */
export const CreateClaimSourceSchema = ClaimSourceSchema.omit({ id: true });
