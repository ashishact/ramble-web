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
  wrongText: z.string(), // Lowercase normalized
  correctText: z.string(), // Correct replacement
  originalCase: z.string(), // Original case of correctText
  usageCount: z.number().int().nonnegative(),
  createdAt: z.number(),
  lastUsed: z.number(),
  sourceUnitId: z.string().nullable(), // Conversation unit where learned
});

/**
 * Schema for creating a new correction
 */
export const CreateCorrectionSchema = CorrectionSchema.omit({
  id: true,
  createdAt: true,
  lastUsed: true,
  usageCount: true,
}).extend({
  usageCount: z.number().int().nonnegative().optional().default(0),
});

/**
 * Schema for updating a correction
 */
export const UpdateCorrectionSchema = z.object({
  correctText: z.string().optional(),
  originalCase: z.string().optional(),
  usageCount: z.number().int().nonnegative().optional(),
  lastUsed: z.number().optional(),
});
