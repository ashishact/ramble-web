/**
 * Session Schema
 *
 * Defines the structure for conversation sessions.
 */

import { z } from 'zod';

/**
 * Session schema - represents a conversation session
 */
export const SessionSchema = z.object({
  id: z.string(),
  started_at: z.number(), // Unix timestamp ms
  ended_at: z.number().nullable(),
  unit_count: z.number().int().nonnegative(),
  summary: z.string().nullable(),
  mood_trajectory_json: z.string().nullable(), // JSON array of mood points
});

/**
 * Schema for creating a new session
 */
export const CreateSessionSchema = SessionSchema.omit({
  id: true,
  ended_at: true,
  unit_count: true,
  summary: true,
  mood_trajectory_json: true,
}).extend({
  ended_at: z.number().nullable().default(null),
  unit_count: z.number().int().nonnegative().default(0),
  summary: z.string().nullable().default(null),
  mood_trajectory_json: z.string().nullable().default(null),
});

/**
 * Schema for updating a session
 */
export const UpdateSessionSchema = SessionSchema.partial().omit({ id: true });
