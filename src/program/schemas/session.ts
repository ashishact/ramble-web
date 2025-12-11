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
  startedAt: z.number(), // Unix timestamp ms
  endedAt: z.number().nullable(),
  unitCount: z.number().int().nonnegative(),
  summary: z.string().nullable(),
  moodTrajectoryJson: z.string().nullable(), // JSON array of mood points
});

/**
 * Schema for creating a new session
 */
export const CreateSessionSchema = SessionSchema.omit({
  id: true,
  endedAt: true,
  unitCount: true,
  summary: true,
  moodTrajectoryJson: true,
}).extend({
  endedAt: z.number().nullable().default(null),
  unitCount: z.number().int().nonnegative().default(0),
  summary: z.string().nullable().default(null),
  moodTrajectoryJson: z.string().nullable().default(null),
});

/**
 * Schema for updating a session
 */
export const UpdateSessionSchema = SessionSchema.partial().omit({ id: true });
