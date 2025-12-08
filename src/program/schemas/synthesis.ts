/**
 * Synthesis Schema
 *
 * Defines the structure for synthesis cache entries.
 * The cache stores generated content (summaries, reports, etc.) to avoid
 * regenerating expensive LLM outputs.
 */

import { z } from 'zod';

// ============================================================================
// Synthesis Cache Schema
// ============================================================================

export const SynthesisCacheSchema = z.object({
  id: z.string(),
  synthesis_type: z.string(), // e.g., 'daily_summary', 'goal_report', 'concern_analysis'
  cache_key: z.string(), // Unique key for cache lookup
  content_json: z.string(), // Serialized synthesis content
  source_claims_json: z.string(), // JSON array of claim IDs used to generate this
  generated_at: z.number(),
  stale: z.boolean(),
  ttl_seconds: z.number(), // Time-to-live in seconds
});

export const CreateSynthesisCacheSchema = SynthesisCacheSchema.omit({
  id: true,
  generated_at: true,
}).partial({
  stale: true,
});

export const UpdateSynthesisCacheSchema = SynthesisCacheSchema.omit({
  id: true,
  generated_at: true,
}).partial();
