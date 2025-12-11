/**
 * Observer Schema
 *
 * Observer outputs and related types.
 */

import { z } from 'zod';

/**
 * Observer type
 */
export const ObserverTypeSchema = z.enum([
  'pattern_observer',
  'concern_observer',
  'goal_observer',
  'contradiction_observer',
  'narrative_observer',
  'relationship_observer',
  'consolidation_observer',
  'mind_model_observer',
]);

/**
 * Observer trigger type
 */
export const TriggerTypeSchema = z.enum([
  'new_claim',
  'claim_update',
  'session_end',
  'schedule',
  'manual',
]);

/**
 * Observer trigger schema
 */
export const ObserverTriggerSchema = z.object({
  type: TriggerTypeSchema,
  claimType: z.string().optional(), // For new_claim triggers
  pattern: z.string().optional(), // For schedule triggers (cron-like)
});

/**
 * Observer output schema (stored in database)
 * Note: Matches WatermelonDB schema in src/db/schema.ts
 */
export const ObserverOutputSchema = z.object({
  id: z.string(),
  observerType: ObserverTypeSchema,
  outputType: z.string(),
  contentJson: z.string(), // JSON serialized content
  sourceClaimsJson: z.string(), // JSON array of claim IDs
  sessionId: z.string().nullable(),
  createdAt: z.number(),
});

/**
 * Schema for creating an observer output
 */
export const CreateObserverOutputSchema = ObserverOutputSchema.omit({
  id: true,
  createdAt: true,
});

/**
 * Schema for updating an observer output
 */
export const UpdateObserverOutputSchema = ObserverOutputSchema.partial().omit({
  id: true,
  createdAt: true,
});

/**
 * Contradiction schema
 * Note: Database uses createdAt, resolutionExplanation instead of detectedAt, resolutionNotes
 * The store maps between these for backwards compatibility
 */
export const ContradictionSchema = z.object({
  id: z.string(),
  claimAId: z.string(),
  claimBId: z.string(),
  detectedAt: z.number(), // Maps to createdAt in DB
  contradictionType: z.enum(['direct', 'temporal', 'implication']), // Not stored in DB, defaults to 'direct'
  resolved: z.boolean(),
  resolutionType: z.string().nullable(),
  resolutionNotes: z.string().nullable(), // Maps to resolutionExplanation in DB
  resolvedAt: z.number().nullable(),
});

/**
 * Schema for creating a contradiction
 */
export const CreateContradictionSchema = ContradictionSchema.omit({
  id: true,
  detectedAt: true,
  resolved: true,
  resolutionType: true,
  resolutionNotes: true,
  resolvedAt: true,
}).extend({
  resolved: z.boolean().default(false),
  resolutionType: z.string().nullable().default(null),
  resolutionNotes: z.string().nullable().default(null),
  resolvedAt: z.number().nullable().default(null),
});

/**
 * Pattern schema (recurring patterns detected)
 * Note: Database uses createdAt, lastObserved instead of firstDetected, lastDetected
 * The store maps between these for backwards compatibility
 */
export const PatternSchema = z.object({
  id: z.string(),
  patternType: z.string(),
  description: z.string(),
  evidenceClaimsJson: z.string(), // JSON array of claim IDs
  firstDetected: z.number(), // Maps to createdAt in DB
  lastDetected: z.number(), // Maps to lastObserved in DB
  occurrenceCount: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

/**
 * Schema for creating a pattern
 */
export const CreatePatternSchema = PatternSchema.omit({
  id: true,
  firstDetected: true,
  lastDetected: true,
  occurrenceCount: true,
}).extend({
  occurrenceCount: z.number().int().positive().default(1),
});

/**
 * Value schema (core values/principles)
 * Note: Database only has createdAt, not firstExpressed/lastConfirmed/confirmationCount
 * The store provides defaults for backwards compatibility
 */
export const ValueSchema = z.object({
  id: z.string(),
  statement: z.string(),
  domain: z.string(), // work, relationships, health, etc.
  importance: z.number().min(0).max(1),
  sourceClaimId: z.string(),
  firstExpressed: z.number(), // Maps to createdAt in DB
  lastConfirmed: z.number(), // Not stored, defaults to createdAt
  confirmationCount: z.number().int().nonnegative(), // Not stored, defaults to 1
});

/**
 * Schema for creating a value
 */
export const CreateValueSchema = ValueSchema.omit({
  id: true,
  firstExpressed: true,
  lastConfirmed: true,
  confirmationCount: true,
}).extend({
  confirmationCount: z.number().int().nonnegative().default(1),
});

/**
 * Helper to parse source claims from JSON
 */
export function parseSourceClaims(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Helper to serialize source claims to JSON
 */
export function serializeSourceClaims(claimIds: string[]): string {
  return JSON.stringify(claimIds);
}
