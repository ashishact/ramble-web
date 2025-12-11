/**
 * Observer Program Schema
 *
 * Defines the structure for observer program metadata stored in the database.
 * Similar to extraction programs, we track observer configurations that can be
 * loaded dynamically at runtime.
 */

import { z } from 'zod';
import { ObserverTypeSchema, TriggerTypeSchema } from './observer';
import { LLMTierSchema } from '../types/llmTiers';

// ============================================================================
// Observer Program Schema
// ============================================================================

export const ObserverProgramSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: ObserverTypeSchema, // 'pattern', 'contradiction', 'consolidation', etc.
  description: z.string(),

  // Runtime configuration
  active: z.boolean(),
  priority: z.number().int(), // Execution order priority (higher = earlier)

  // Trigger configuration
  triggers: z.array(TriggerTypeSchema), // ['new_claim', 'session_end', etc.]
  claimTypeFilter: z.string().nullable(), // JSON array of claim types to filter on

  // LLM configuration (if this observer uses LLM)
  usesLlm: z.boolean(),
  llmTier: LLMTierSchema.nullable(), // Uses tier abstraction (small/medium/large)
  llmTemperature: z.number().min(0).max(2).nullable(),
  llmMaxTokens: z.number().int().positive().nullable(),

  // Prompt template (supports ${VARIABLE} replacement)
  promptTemplate: z.string().nullable(),

  // Output schema (JSON schema for expected output)
  outputSchemaJson: z.string().nullable(),

  // Detection logic (JavaScript function body as string - for advanced users)
  shouldRunLogic: z.string().nullable(), // Function that returns boolean
  processLogic: z.string().nullable(), // Function that processes and returns results

  // Metadata
  isCore: z.boolean(), // Core vs user-created
  version: z.number().int().positive(),
  createdAt: z.number(),
  updatedAt: z.number(),

  // Analytics
  runCount: z.number().int().nonnegative(),
  successRate: z.number().min(0).max(1),
  avgProcessingTimeMs: z.number().nonnegative(),
});

export const CreateObserverProgramSchema = ObserverProgramSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).partial({
  active: true,
  version: true,
  isCore: true,
  runCount: true,
  successRate: true,
  avgProcessingTimeMs: true,
});

export const UpdateObserverProgramSchema = ObserverProgramSchema.omit({
  id: true,
  createdAt: true,
  type: true, // Cannot change type after creation
}).partial();
