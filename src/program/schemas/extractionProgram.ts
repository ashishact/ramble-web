/**
 * Extraction Program Schema
 *
 * Defines the structure for extraction program metadata stored in the database.
 * The actual program code lives in TypeScript files, but we track metadata
 * for analytics, versioning, and runtime configuration.
 */

import { z } from 'zod';
import { LLMTierSchema } from '../types/llmTiers';

// ============================================================================
// Extraction Program Schema
// ============================================================================

export const ExtractionProgramSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  type: z.string(), // e.g., 'entity', 'belief', 'emotion'
  version: z.number().int().positive(),

  // Pattern matching configuration
  patterns_json: z.string(), // JSON array of pattern definitions
  always_run: z.boolean(), // If true, runs on every text (ignores patterns)

  // LLM configuration - uses tier abstraction (small/medium/large)
  llm_tier: LLMTierSchema,
  llm_temperature: z.number().min(0).max(2).nullable(),
  llm_max_tokens: z.number().int().positive().nullable(),

  // Prompt template (supports ${VARIABLE} replacement)
  prompt_template: z.string(), // Template with variables like ${INPUT_TEXT}, ${CONTEXT}

  // Output schema (JSON schema for expected output)
  output_schema_json: z.string(), // JSON schema for expected output

  // Runtime configuration
  priority: z.number().int(), // Execution order priority
  active: z.boolean(),
  min_confidence: z.number().min(0).max(1),

  // Metadata
  is_core: z.boolean(), // Core vs user-created
  claim_types_json: z.string(), // JSON array of claim types this extractor produces

  // Analytics
  success_rate: z.number().min(0).max(1),
  run_count: z.number().int().nonnegative(),
  avg_processing_time_ms: z.number().nonnegative(),

  created_at: z.number(),
  updated_at: z.number(),
});

export const CreateExtractionProgramSchema = ExtractionProgramSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).partial({
  version: true,
  active: true,
  is_core: true,
  success_rate: true,
  run_count: true,
  avg_processing_time_ms: true,
  llm_temperature: true,
  llm_max_tokens: true,
});

export const UpdateExtractionProgramSchema = ExtractionProgramSchema.omit({
  id: true,
  created_at: true,
  type: true, // Cannot change type after creation
}).partial();
