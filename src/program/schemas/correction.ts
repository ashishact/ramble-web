/**
 * Correction Schema
 *
 * User-provided spelling/word corrections learned from explicit feedback.
 * Stored lowercase for matching, with original case preserved.
 */

import { z } from 'zod';

/**
 * Correction schema - learned spelling corrections
 */
export const CorrectionSchema = z.object({
  id: z.string(),
  wrong_text: z.string(), // Lowercase normalized
  correct_text: z.string(), // Correct replacement
  original_case: z.string(), // Original case of correct_text
  usage_count: z.number().int().nonnegative(),
  created_at: z.number(),
  last_used: z.number(),
  source_unit_id: z.string().nullable(), // Conversation unit where learned
});

/**
 * Schema for creating a new correction
 */
export const CreateCorrectionSchema = CorrectionSchema.omit({
  id: true,
  created_at: true,
  last_used: true,
  usage_count: true,
}).extend({
  usage_count: z.number().int().nonnegative().optional().default(0),
});

/**
 * Schema for updating a correction
 */
export const UpdateCorrectionSchema = z.object({
  correct_text: z.string().optional(),
  original_case: z.string().optional(),
  usage_count: z.number().int().nonnegative().optional(),
  last_used: z.number().optional(),
});
