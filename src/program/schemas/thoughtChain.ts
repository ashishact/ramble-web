/**
 * Thought Chain Schema
 *
 * Thought chains organize related claims into coherent topics/threads.
 */

import { z } from 'zod';

/**
 * Chain state - lifecycle of a thought chain
 */
export const ChainStateSchema = z.enum([
  'active', // Currently being discussed
  'dormant', // Not recently referenced
  'concluded', // Explicitly concluded
]);

/**
 * Thought chain schema
 */
export const ThoughtChainSchema = z.object({
  id: z.string(),
  topic: z.string(),
  started_at: z.number(),
  last_extended: z.number(),
  branches_from: z.string().nullable(), // Parent chain ID
  state: ChainStateSchema,
});

/**
 * Schema for creating a new thought chain
 */
export const CreateThoughtChainSchema = ThoughtChainSchema.omit({
  id: true,
  started_at: true,
  last_extended: true,
  state: true,
}).extend({
  state: ChainStateSchema.default('active'),
});

/**
 * Schema for updating a thought chain
 */
export const UpdateThoughtChainSchema = ThoughtChainSchema.partial().omit({
  id: true,
  started_at: true,
});

/**
 * Chain to claim relationship (ordered)
 */
export const ChainClaimSchema = z.object({
  id: z.string(),
  chain_id: z.string(),
  claim_id: z.string(),
  position: z.number().int().nonnegative(),
});

/**
 * Schema for creating a chain-claim relationship
 */
export const CreateChainClaimSchema = ChainClaimSchema.omit({ id: true });
