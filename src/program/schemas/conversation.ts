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
  sessionId: z.string(),
  timestamp: z.number(), // Unix timestamp ms
  rawText: z.string(),
  sanitizedText: z.string(),
  source: ConversationSourceSchema,
  precedingContextSummary: z.string(),
  createdAt: z.number(), // Unix timestamp ms
  processed: z.boolean(), // Has extraction run?
});

/**
 * Schema for creating a new conversation unit
 */
export const CreateConversationUnitSchema = ConversationUnitSchema.omit({
  id: true,
  createdAt: true,
  processed: true,
}).extend({
  processed: z.boolean().default(false),
});

/**
 * Schema for updating a conversation unit
 * Note: rawText and sanitizedText can be updated for corrections
 */
export const UpdateConversationUnitSchema = z.object({
  processed: z.boolean().optional(),
  rawText: z.string().optional(),
  sanitizedText: z.string().optional(),
});
