/**
 * Observer Program Schema
 *
 * Defines the structure for observer program metadata stored in the database.
 * Similar to extraction programs, we track observer configurations that can be
 * loaded dynamically at runtime.
 */

import { z } from 'zod';
import { ObserverTypeSchema, TriggerTypeSchema } from './observer';

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
  claim_type_filter: z.string().nullable(), // JSON array of claim types to filter on

  // LLM configuration (if this observer uses LLM)
  uses_llm: z.boolean(),
  llm_provider: z.enum(['groq', 'gemini']).nullable(),
  llm_model: z.string().nullable(),
  llm_temperature: z.number().min(0).max(2).nullable(),
  llm_max_tokens: z.number().int().positive().nullable(),

  // Prompt template (supports ${VARIABLE} replacement)
  prompt_template: z.string().nullable(),

  // Output schema (JSON schema for expected output)
  output_schema_json: z.string().nullable(),

  // Detection logic (JavaScript function body as string - for advanced users)
  should_run_logic: z.string().nullable(), // Function that returns boolean
  process_logic: z.string().nullable(), // Function that processes and returns results

  // Metadata
  is_core: z.boolean(), // Core vs user-created
  version: z.number().int().positive(),
  created_at: z.number(),
  updated_at: z.number(),

  // Analytics
  run_count: z.number().int().nonnegative(),
  success_rate: z.number().min(0).max(1),
  avg_processing_time_ms: z.number().nonnegative(),
});

export const CreateObserverProgramSchema = ObserverProgramSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
}).partial({
  active: true,
  version: true,
  is_core: true,
  run_count: true,
  success_rate: true,
  avg_processing_time_ms: true,
});

export const UpdateObserverProgramSchema = ObserverProgramSchema.omit({
  id: true,
  created_at: true,
  type: true, // Cannot change type after creation
}).partial();
