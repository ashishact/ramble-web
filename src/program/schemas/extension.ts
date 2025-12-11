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
  extensionType: ExtensionTypeSchema,
  name: z.string().min(1),
  description: z.string(),
  configJson: z.string(), // Serialized JSON config
  systemPrompt: z.string(),
  userPromptTemplate: z.string(), // Contains {VARIABLE} placeholders
  variablesSchemaJson: z.string(), // JSON schema for variables
  llmTier: z.enum(['small', 'medium', 'large']),
  status: ExtensionStatusSchema,
  version: z.number().int().positive(),
  createdAt: z.number(),
  verifiedAt: z.number().nullable(),
});

export const CreateExtensionSchema = ExtensionSchema.omit({
  id: true,
  createdAt: true,
}).partial({
  status: true,
  version: true,
  verifiedAt: true,
  llmTier: true,
});

export const UpdateExtensionSchema = ExtensionSchema.omit({
  id: true,
  createdAt: true,
}).partial();
