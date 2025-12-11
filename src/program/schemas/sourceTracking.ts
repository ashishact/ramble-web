/**
 * Source Tracking Schema
 *
 * Stores debug information about where claims came from.
 * Separate table to keep claim data lightweight.
 */

import { z } from 'zod';

/**
 * Source tracking for debugging claim extraction
 */
export const SourceTrackingSchema = z.object({
  id: z.string(),
  claim_id: z.string(),           // Which claim this tracks
  unit_id: z.string(),            // Which conversation unit
  unit_text: z.string(),          // Full text of the unit
  text_excerpt: z.string(),       // The exact text the LLM focused on
  char_start: z.number().int().nullable(), // Character position (start)
  char_end: z.number().int().nullable(),   // Character position (end)
  pattern_id: z.string().nullable(),       // Which pattern matched
  llm_prompt: z.string(),         // The prompt sent to LLM
  llm_response: z.string(),       // Raw LLM response
  created_at: z.number(),         // When this was captured
});

export type SourceTracking = z.infer<typeof SourceTrackingSchema>;

/**
 * Schema for creating source tracking
 */
export const CreateSourceTrackingSchema = SourceTrackingSchema.omit({
  id: true,
  created_at: true,
});

export type CreateSourceTracking = z.infer<typeof CreateSourceTrackingSchema>;
