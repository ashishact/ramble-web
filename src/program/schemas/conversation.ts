/**
 * Conversation Unit Schema
 *
 * Raw conversation units - immutable once created.
 */

import { z } from 'zod';

/**
 * Source type for conversation units
 */
export const ConversationSourceSchema = z.enum(['speech', 'text']);

/**
 * Conversation unit schema - immutable raw input
 */
export const ConversationUnitSchema = z.object({
  id: z.string(),
  session_id: z.string(),
  timestamp: z.number(), // Unix timestamp ms
  raw_text: z.string(),
  sanitized_text: z.string(),
  source: ConversationSourceSchema,
  preceding_context_summary: z.string(),
  created_at: z.number(), // Unix timestamp ms
  processed: z.boolean(), // Has extraction run?
});

/**
 * Schema for creating a new conversation unit
 */
export const CreateConversationUnitSchema = ConversationUnitSchema.omit({
  id: true,
  created_at: true,
  processed: true,
}).extend({
  processed: z.boolean().default(false),
});

/**
 * Schema for updating a conversation unit (only processed flag can change)
 */
export const UpdateConversationUnitSchema = z.object({
  processed: z.boolean().optional(),
});
