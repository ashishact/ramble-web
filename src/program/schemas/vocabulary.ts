/**
 * Vocabulary Schema
 *
 * Custom vocabulary for STT entity spelling correction.
 * Stores phonetic codes (Double Metaphone) for fuzzy matching.
 */

import { z } from 'zod';

/**
 * Entity types that can be associated with vocabulary
 */
export const VocabularyEntityTypeSchema = z.enum([
  'person',
  'organization',
  'place',
  'project',
  'product',
  'event',
  'concept',
  'role',
]);

export type VocabularyEntityType = z.infer<typeof VocabularyEntityTypeSchema>;

/**
 * Vocabulary schema - custom vocabulary for STT correction
 */
export const VocabularySchema = z.object({
  id: z.string(),
  correctSpelling: z.string(),
  entityType: VocabularyEntityTypeSchema,
  contextHints: z.string(), // JSON array of common nearby words
  phoneticPrimary: z.string(), // Double Metaphone primary code
  phoneticSecondary: z.string().nullable(), // Double Metaphone secondary code
  usageCount: z.number().int().nonnegative(),
  variantCountsJson: z.string(), // JSON object: { "variant": count }
  createdAt: z.number(),
  lastUsed: z.number().nullable(),
  sourceEntityId: z.string().nullable(), // Link to canonical entity
});

export type Vocabulary = z.infer<typeof VocabularySchema>;

/**
 * Schema for creating a new vocabulary entry
 */
export const CreateVocabularySchema = VocabularySchema.omit({
  id: true,
  createdAt: true,
  lastUsed: true,
  usageCount: true,
  variantCountsJson: true,
}).extend({
  usageCount: z.number().int().nonnegative().optional().default(0),
  variantCountsJson: z.string().optional().default('{}'),
});

export type CreateVocabulary = z.infer<typeof CreateVocabularySchema>;

/**
 * Schema for updating a vocabulary entry
 */
export const UpdateVocabularySchema = z.object({
  correctSpelling: z.string().optional(),
  entityType: VocabularyEntityTypeSchema.optional(),
  contextHints: z.string().optional(),
  phoneticPrimary: z.string().optional(),
  phoneticSecondary: z.string().nullable().optional(),
  usageCount: z.number().int().nonnegative().optional(),
  variantCountsJson: z.string().optional(),
  lastUsed: z.number().nullable().optional(),
  sourceEntityId: z.string().nullable().optional(),
});

export type UpdateVocabulary = z.infer<typeof UpdateVocabularySchema>;

/**
 * Helper to parse context hints JSON
 */
export function parseContextHints(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.filter((s): s is string => typeof s === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Helper to serialize context hints
 */
export function serializeContextHints(hints: string[]): string {
  return JSON.stringify(hints);
}

/**
 * Variant vote tracking
 */
export interface VariantVote {
  variant: string;
  count: number;
}

/**
 * Parse variant counts JSON
 */
export function parseVariantCounts(json: string): Record<string, number> {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, number>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Get sorted variant votes
 */
export function getVariantVotes(json: string): VariantVote[] {
  const counts = parseVariantCounts(json);
  return Object.entries(counts)
    .map(([variant, count]) => ({ variant, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Add a variant count and return updated JSON
 */
export function addVariantCount(json: string, variant: string): string {
  const counts = parseVariantCounts(json);
  const normalizedVariant = variant.toLowerCase().trim();
  counts[normalizedVariant] = (counts[normalizedVariant] || 0) + 1;
  return JSON.stringify(counts);
}
