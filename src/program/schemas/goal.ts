/**
 * Goal Schema
 *
 * Goals are first-class entities representing what the person wants to achieve.
 */

import { z } from 'zod';

/**
 * Goal type - categorizes the nature of the goal
 */
export const GoalTypeSchema = z.enum([
  'outcome', // Achieve a specific result
  'process', // Maintain a practice
  'identity', // Become a certain kind of person
  'avoidance', // Prevent something
  'maintenance', // Keep current state
]);

/**
 * Goal timeframe
 */
export const GoalTimeframeSchema = z.enum([
  'immediate', // Today/this week
  'short_term', // This month
  'medium_term', // This quarter/year
  'long_term', // Multi-year
  'life', // Lifetime goal
]);

/**
 * Goal status
 */
export const GoalStatusSchema = z.enum([
  'active',
  'achieved',
  'abandoned',
  'blocked',
  'dormant',
  'superseded',
]);

/**
 * Progress type - how progress is measured
 */
export const ProgressTypeSchema = z.enum([
  'binary', // Done or not done
  'percentage', // 0-100%
  'milestone', // Count of milestones
  'continuous', // Ongoing with no end
]);

/**
 * Blocker type
 */
export const BlockerTypeSchema = z.enum([
  'resource',
  'knowledge',
  'skill',
  'external',
  'internal',
  'dependency',
]);

/**
 * Blocker severity
 */
export const BlockerSeveritySchema = z.enum(['minor', 'significant', 'blocking']);

/**
 * Blocker status
 */
export const BlockerStatusSchema = z.enum(['active', 'resolved', 'accepted']);

/**
 * Milestone status
 */
export const MilestoneStatusSchema = z.enum(['pending', 'achieved', 'skipped']);

/**
 * Goal schema
 */
export const GoalSchema = z.object({
  id: z.string(),
  statement: z.string(),
  goal_type: GoalTypeSchema,
  timeframe: GoalTimeframeSchema,
  status: GoalStatusSchema,
  parent_goal_id: z.string().nullable(),
  created_at: z.number(),
  last_referenced: z.number(),
  priority: z.number().int().min(1).max(10),
  progress_type: ProgressTypeSchema,
  progress_value: z.number().min(0).max(100),
  progress_indicators_json: z.string(), // JSON array
  blockers_json: z.string(), // JSON array of Blocker objects
  source_claim_id: z.string(),
  motivation: z.string().nullable(),
  deadline: z.number().nullable(),
});

/**
 * Schema for creating a new goal
 */
export const CreateGoalSchema = GoalSchema.omit({
  id: true,
  created_at: true,
  last_referenced: true,
  status: true,
  progress_value: true,
  progress_indicators_json: true,
  blockers_json: true,
}).extend({
  status: GoalStatusSchema.default('active'),
  progress_value: z.number().min(0).max(100).default(0),
  progress_indicators_json: z.string().default('[]'),
  blockers_json: z.string().default('[]'),
});

/**
 * Schema for updating a goal
 */
export const UpdateGoalSchema = GoalSchema.partial().omit({ id: true, created_at: true });

/**
 * Milestone schema (stored in goals.progress_indicators_json)
 */
export const MilestoneSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: MilestoneStatusSchema,
  achieved_at: z.number().nullable(),
  evidence_claim_id: z.string().nullable(),
});

/**
 * Blocker schema (stored in goals.blockers_json)
 */
export const BlockerSchema = z.object({
  id: z.string(),
  description: z.string(),
  blocker_type: BlockerTypeSchema,
  severity: BlockerSeveritySchema,
  status: BlockerStatusSchema,
  resolution_path: z.string().nullable(),
});

/**
 * Helper to parse milestones from JSON
 */
export function parseMilestones(json: string): z.infer<typeof MilestoneSchema>[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((m) => MilestoneSchema.parse(m)) : [];
  } catch {
    return [];
  }
}

/**
 * Helper to serialize milestones to JSON
 */
export function serializeMilestones(milestones: z.infer<typeof MilestoneSchema>[]): string {
  return JSON.stringify(milestones);
}

/**
 * Helper to parse blockers from JSON
 */
export function parseBlockers(json: string): z.infer<typeof BlockerSchema>[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.map((b) => BlockerSchema.parse(b)) : [];
  } catch {
    return [];
  }
}

/**
 * Helper to serialize blockers to JSON
 */
export function serializeBlockers(blockers: z.infer<typeof BlockerSchema>[]): string {
  return JSON.stringify(blockers);
}
