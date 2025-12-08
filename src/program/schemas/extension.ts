/**
 * Extension Schema
 *
 * Defines the structure for custom extensions (extractors, view synthesizers, observers).
 * Extensions allow runtime customization of the extraction and synthesis pipeline.
 */

import { z } from 'zod';

// ============================================================================
// Extension Type
// ============================================================================

export const ExtensionTypeSchema = z.enum([
  'view_synthesizer',
  'extractor',
  'observer',
]);

// ============================================================================
// Extension Status
// ============================================================================

export const ExtensionStatusSchema = z.enum([
  'draft',
  'verified',
  'production',
]);

// ============================================================================
// Extension Schema
// ============================================================================

export const ExtensionSchema = z.object({
  id: z.string(),
  extension_type: ExtensionTypeSchema,
  name: z.string().min(1),
  description: z.string(),
  config_json: z.string(), // Serialized JSON config
  system_prompt: z.string(),
  user_prompt_template: z.string(), // Contains {VARIABLE} placeholders
  variables_schema_json: z.string(), // JSON schema for variables
  status: ExtensionStatusSchema,
  version: z.number().int().positive(),
  created_at: z.number(),
  verified_at: z.number().nullable(),
});

export const CreateExtensionSchema = ExtensionSchema.omit({
  id: true,
  created_at: true,
}).partial({
  status: true,
  version: true,
  verified_at: true,
});

export const UpdateExtensionSchema = ExtensionSchema.omit({
  id: true,
  created_at: true,
}).partial();
