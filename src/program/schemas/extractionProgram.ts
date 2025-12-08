/**
 * Extraction Program Schema
 *
 * Defines the structure for extraction program metadata stored in the database.
 * The actual program code lives in TypeScript files, but we track metadata
 * for analytics, versioning, and runtime configuration.
 */

import { z } from 'zod';

// ============================================================================
// Extraction Program Schema
// ============================================================================

export const ExtractionProgramSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: z.string(), // e.g., 'entity', 'belief', 'emotion'
  version: z.number().int().positive(),
  patterns_json: z.string(), // JSON array of pattern definitions
  extraction_prompt: z.string(),
  output_schema_json: z.string(), // JSON schema for expected output
  priority: z.number().int(), // Execution order priority
  active: z.boolean(),
  is_core: z.boolean(), // Core vs extension
  success_rate: z.number().min(0).max(1),
  run_count: z.number().int().nonnegative(),
  created_at: z.number(),
});

export const CreateExtractionProgramSchema = ExtractionProgramSchema.omit({
  id: true,
  created_at: true,
}).partial({
  version: true,
  active: true,
  is_core: true,
  success_rate: true,
  run_count: true,
});

export const UpdateExtractionProgramSchema = ExtractionProgramSchema.omit({
  id: true,
  created_at: true,
}).partial();
