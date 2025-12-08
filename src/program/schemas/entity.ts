/**
 * Entity Schema
 *
 * Named entities extracted from conversation (people, places, organizations, etc.)
 */

import { z } from 'zod';

/**
 * Entity type - categorizes the entity
 */
export const EntityTypeSchema = z.enum([
  'person',
  'organization',
  'product',
  'place',
  'project',
  'role',
  'event',
  'concept',
]);

/**
 * Entity schema
 */
export const EntitySchema = z.object({
  id: z.string(),
  canonical_name: z.string(),
  entity_type: EntityTypeSchema,
  aliases: z.string(), // JSON array as string for TinyBase compatibility
  created_at: z.number(),
  last_referenced: z.number(),
  mention_count: z.number().int().nonnegative(),
});

/**
 * Schema for creating a new entity
 */
export const CreateEntitySchema = EntitySchema.omit({
  id: true,
  created_at: true,
  last_referenced: true,
  mention_count: true,
}).extend({
  mention_count: z.number().int().nonnegative().default(1),
});

/**
 * Schema for updating an entity
 */
export const UpdateEntitySchema = EntitySchema.partial().omit({ id: true, created_at: true });

/**
 * Helper to parse aliases from JSON string
 */
export function parseAliases(aliasesJson: string): string[] {
  try {
    const parsed = JSON.parse(aliasesJson);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Helper to serialize aliases to JSON string
 */
export function serializeAliases(aliases: string[]): string {
  return JSON.stringify(aliases);
}
