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
  claimId: z.string(),           // Which claim this tracks
  unitId: z.string(),            // Which conversation unit
  unitText: z.string(),          // Full text of the unit
  textExcerpt: z.string(),       // The exact text the LLM focused on
  charStart: z.number().int().nullable(), // Character position (start)
  charEnd: z.number().int().nullable(),   // Character position (end)
  patternId: z.string().nullable(),       // Which pattern matched
  llmPrompt: z.string(),         // The prompt sent to LLM
  llmResponse: z.string(),       // Raw LLM response
  createdAt: z.number(),         // When this was captured
});

export type SourceTracking = z.infer<typeof SourceTrackingSchema>;

/**
 * Schema for creating source tracking
 */
export const CreateSourceTrackingSchema = SourceTrackingSchema.omit({
  id: true,
  createdAt: true,
});

export type CreateSourceTracking = z.infer<typeof CreateSourceTrackingSchema>;
