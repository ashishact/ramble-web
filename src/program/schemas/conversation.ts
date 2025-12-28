/**
 * Conversation Unit Schema
 *
 * Layer 0: Stream - the ground truth input.
 * Raw conversation units - immutable once created.
 */

import { z } from 'zod';

/**
 * Source type for conversation units
 */
export const ConversationSourceSchema = z.enum(['speech', 'text']);

/**
 * Speaker type
 */
export const SpeakerSchema = z.enum(['user', 'agent']);

/**
 * Discourse function - what the utterance is doing
 */
export const DiscourseFunctionSchema = z.enum([
  'assert',    // Making a claim
  'question',  // Asking something
  'command',   // Requesting action
  'express',   // Expressing emotion
  'commit',    // Making a commitment
]);

/**
 * Conversation unit schema - Layer 0 stream input
 */
export const ConversationUnitSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  timestamp: z.number(), // Unix timestamp ms
  rawText: z.string(),
  sanitizedText: z.string(),
  source: ConversationSourceSchema,
  speaker: SpeakerSchema.default('user'),
  discourseFunction: DiscourseFunctionSchema.default('assert'),
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
  speaker: true,
  discourseFunction: true,
}).extend({
  processed: z.boolean().default(false),
  speaker: SpeakerSchema.default('user'),
  discourseFunction: DiscourseFunctionSchema.default('assert'),
});

/**
 * Schema for updating a conversation unit
 * Note: rawText and sanitizedText can be updated for corrections
 */
export const UpdateConversationUnitSchema = z.object({
  processed: z.boolean().optional(),
  rawText: z.string().optional(),
  sanitizedText: z.string().optional(),
  precedingContextSummary: z.string().optional(),
  speaker: SpeakerSchema.optional(),
  discourseFunction: DiscourseFunctionSchema.optional(),
});

// Type exports
export type Speaker = z.infer<typeof SpeakerSchema>;
export type DiscourseFunction = z.infer<typeof DiscourseFunctionSchema>;
