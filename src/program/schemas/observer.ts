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
 */
export const ObserverOutputSchema = z.object({
  id: z.string(),
  observer_type: ObserverTypeSchema,
  output_type: z.string(),
  content_json: z.string(), // JSON serialized content
  source_claims_json: z.string(), // JSON array of claim IDs
  created_at: z.number(),
  stale: z.boolean(),
});

/**
 * Schema for creating an observer output
 */
export const CreateObserverOutputSchema = ObserverOutputSchema.omit({
  id: true,
  created_at: true,
  stale: true,
}).extend({
  stale: z.boolean().default(false),
});

/**
 * Schema for updating an observer output
 */
export const UpdateObserverOutputSchema = ObserverOutputSchema.partial().omit({
  id: true,
  created_at: true,
});

/**
 * Contradiction schema
 */
export const ContradictionSchema = z.object({
  id: z.string(),
  claim_a_id: z.string(),
  claim_b_id: z.string(),
  detected_at: z.number(),
  contradiction_type: z.enum(['direct', 'temporal', 'implication']),
  resolved: z.boolean(),
  resolution_type: z.string().nullable(),
  resolution_notes: z.string().nullable(),
  resolved_at: z.number().nullable(),
});

/**
 * Schema for creating a contradiction
 */
export const CreateContradictionSchema = ContradictionSchema.omit({
  id: true,
  detected_at: true,
  resolved: true,
  resolution_type: true,
  resolution_notes: true,
  resolved_at: true,
}).extend({
  resolved: z.boolean().default(false),
  resolution_type: z.string().nullable().default(null),
  resolution_notes: z.string().nullable().default(null),
  resolved_at: z.number().nullable().default(null),
});

/**
 * Pattern schema (recurring patterns detected)
 */
export const PatternSchema = z.object({
  id: z.string(),
  pattern_type: z.string(),
  description: z.string(),
  evidence_claims_json: z.string(), // JSON array of claim IDs
  first_detected: z.number(),
  last_detected: z.number(),
  occurrence_count: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
});

/**
 * Schema for creating a pattern
 */
export const CreatePatternSchema = PatternSchema.omit({
  id: true,
  first_detected: true,
  last_detected: true,
  occurrence_count: true,
}).extend({
  occurrence_count: z.number().int().positive().default(1),
});

/**
 * Value schema (core values/principles)
 */
export const ValueSchema = z.object({
  id: z.string(),
  statement: z.string(),
  domain: z.string(), // work, relationships, health, etc.
  importance: z.number().min(0).max(1),
  source_claim_id: z.string(),
  first_expressed: z.number(),
  last_confirmed: z.number(),
  confirmation_count: z.number().int().nonnegative(),
});

/**
 * Schema for creating a value
 */
export const CreateValueSchema = ValueSchema.omit({
  id: true,
  first_expressed: true,
  last_confirmed: true,
  confirmation_count: true,
}).extend({
  confirmation_count: z.number().int().nonnegative().default(1),
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
