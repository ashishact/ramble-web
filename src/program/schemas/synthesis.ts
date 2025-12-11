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
  synthesisType: z.string(), // e.g., 'daily_summary', 'goal_report', 'concern_analysis'
  cacheKey: z.string(), // Unique key for cache lookup
  contentJson: z.string(), // Serialized synthesis content
  sourceClaimsJson: z.string(), // JSON array of claim IDs used to generate this
  createdAt: z.number(), // When this cache entry was created
  stale: z.boolean(),
  ttlSeconds: z.number(), // Time-to-live in seconds
});

export const CreateSynthesisCacheSchema = SynthesisCacheSchema.omit({
  id: true,
  createdAt: true,
}).partial({
  stale: true,
});

export const UpdateSynthesisCacheSchema = SynthesisCacheSchema.omit({
  id: true,
  createdAt: true,
}).partial();
