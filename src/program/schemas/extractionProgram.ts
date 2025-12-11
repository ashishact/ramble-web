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
  patternsJson: z.string(), // JSON array of pattern definitions
  alwaysRun: z.boolean(), // If true, runs on every text (ignores patterns)

  // LLM configuration - uses tier abstraction (small/medium/large)
  llmTier: LLMTierSchema,
  llmTemperature: z.number().min(0).max(2).nullable(),
  llmMaxTokens: z.number().int().positive().nullable(),

  // Prompt template (supports ${VARIABLE} replacement)
  promptTemplate: z.string(), // Template with variables like ${INPUT_TEXT}, ${CONTEXT}

  // Output schema (JSON schema for expected output)
  outputSchemaJson: z.string(), // JSON schema for expected output

  // Runtime configuration
  priority: z.number().int(), // Execution order priority
  active: z.boolean(),
  minConfidence: z.number().min(0).max(1),

  // Metadata
  isCore: z.boolean(), // Core vs user-created
  claimTypesJson: z.string(), // JSON array of claim types this extractor produces

  // Analytics
  successRate: z.number().min(0).max(1),
  runCount: z.number().int().nonnegative(),
  avgProcessingTimeMs: z.number().nonnegative(),

  createdAt: z.number(),
  updatedAt: z.number(),
});

export const CreateExtractionProgramSchema = ExtractionProgramSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  version: true,
  active: true,
  isCore: true,
  successRate: true,
  runCount: true,
  avgProcessingTimeMs: true,
  llmTemperature: true,
  llmMaxTokens: true,
});

export const UpdateExtractionProgramSchema = ExtractionProgramSchema.omit({
  id: true,
  createdAt: true,
  type: true, // Cannot change type after creation
}).partial();
