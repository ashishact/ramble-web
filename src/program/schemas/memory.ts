/**
 * Memory Schema
 *
 * Schemas for working memory, long-term memory, salience, and decay.
 */

import { z } from 'zod';

// ============================================================================
// Memory Tier
// ============================================================================

/**
 * Memory tier - where a claim lives in the memory hierarchy
 */
export const MemoryTierSchema = z.enum([
  'working',  // In working memory, subject to decay, high salience
  'longTerm', // Promoted to long-term, more stable, slower decay
]);

// ============================================================================
// Salience Factors
// ============================================================================

/**
 * Breakdown of what contributes to a claim's salience
 */
export const SalienceFactorsSchema = z.object({
  recencyFactor: z.number().min(0).max(1),      // Decay-based recency (35%)
  emotionalFactor: z.number().min(0).max(1),    // Emotional intensity (25%)
  stakesFactor: z.number().min(0).max(1),       // Stakes level (20%)
  confirmationFactor: z.number().min(0).max(1), // Confirmation count (15%)
  accessFactor: z.number().min(0).max(1),       // Recent UI access (5%)
});

// ============================================================================
// Top of Mind
// ============================================================================

/**
 * Topic with salience info
 */
export const SalientTopicSchema = z.object({
  topic: z.string(),
  salience: z.number().min(0).max(1),
  lastMentioned: z.number(),
  claimCount: z.number(),
});

/**
 * Entity with salience info
 */
export const SalientEntitySchema = z.object({
  entityId: z.string(),
  entity: z.string(),
  entityType: z.string(),
  salience: z.number().min(0).max(1),
  mentionCount: z.number(),
});

/**
 * Goal with salience info
 */
export const SalientGoalSchema = z.object({
  goalId: z.string(),
  statement: z.string(),
  salience: z.number().min(0).max(1),
  status: z.string(),
  progressValue: z.number(),
});

/**
 * Concern with salience info
 */
export const SalientConcernSchema = z.object({
  claimId: z.string(),
  concern: z.string(),
  salience: z.number().min(0).max(1),
  stakes: z.string(),
  emotionalIntensity: z.number(),
});

/**
 * Open question with salience info
 */
export const SalientQuestionSchema = z.object({
  claimId: z.string(),
  question: z.string(),
  salience: z.number().min(0).max(1),
});

/**
 * High emotional intensity claim
 */
export const EmotionalHighlightSchema = z.object({
  claimId: z.string(),
  statement: z.string(),
  emotionalIntensity: z.number(),
  valence: z.number(),
});

/**
 * TopOfMind - working memory snapshot formatted for UI
 */
export const TopOfMindSchema = z.object({
  topics: z.array(SalientTopicSchema),
  entities: z.array(SalientEntitySchema),
  goals: z.array(SalientGoalSchema),
  concerns: z.array(SalientConcernSchema),
  openQuestions: z.array(SalientQuestionSchema),
  recentHighIntensity: z.array(EmotionalHighlightSchema),
});

// ============================================================================
// Memory Statistics
// ============================================================================

/**
 * Memory system statistics
 */
export const MemoryStatsSchema = z.object({
  workingMemoryCount: z.number(),
  longTermMemoryCount: z.number(),
  totalClaimsCount: z.number(),
  averageSalience: z.number(),
  highSalienceCount: z.number(),      // salience > 0.7
  mediumSalienceCount: z.number(),    // 0.4 < salience <= 0.7
  lowSalienceCount: z.number(),       // salience <= 0.4
  decayingCount: z.number(),          // claims with non-eternal temporality
  staleCount: z.number(),             // claims marked stale
  dormantCount: z.number(),           // claims marked dormant
  promotedThisSession: z.number(),
  lastDecayRun: z.number().nullable(),
  lastConsolidationRun: z.number().nullable(),
});

// ============================================================================
// Decay Configuration
// ============================================================================

/**
 * Decay configuration per temporality type
 */
export const DecayConfigSchema = z.object({
  eternal: z.object({ halfLifeMs: z.number().nullable() }), // null = no decay
  slowlyDecaying: z.object({ halfLifeMs: z.number() }),
  fastDecaying: z.object({ halfLifeMs: z.number() }),
  pointInTime: z.object({ halfLifeMs: z.number() }),
});

/**
 * Default decay configuration
 * - eternal: never decays
 * - slowlyDecaying: 30-day half-life
 * - fastDecaying: 1-day half-life
 * - pointInTime: 1-hour half-life
 */
export const DEFAULT_DECAY_CONFIG = {
  eternal: { halfLifeMs: null },
  slowlyDecaying: { halfLifeMs: 30 * 24 * 60 * 60 * 1000 }, // 30 days
  fastDecaying: { halfLifeMs: 24 * 60 * 60 * 1000 },        // 1 day
  pointInTime: { halfLifeMs: 60 * 60 * 1000 },              // 1 hour
} as const;

// ============================================================================
// Decay Result
// ============================================================================

/**
 * Result of a decay run
 */
export const DecayResultSchema = z.object({
  processedCount: z.number(),
  decayedCount: z.number(),
  staleCount: z.number(),
  dormantCount: z.number(),
  errors: z.array(z.object({
    claimId: z.string(),
    error: z.string(),
  })),
});

// ============================================================================
// Memory Service Configuration
// ============================================================================

/**
 * Salience weight configuration
 */
export const SalienceWeightsSchema = z.object({
  recency: z.number(),      // 0.35 - Most important
  emotional: z.number(),    // 0.25 - Strong emotional impact
  stakes: z.number(),       // 0.20 - High stakes matter
  confirmation: z.number(), // 0.15 - Repeated = important
  access: z.number(),       // 0.05 - Recently accessed
});

/**
 * Memory service configuration
 */
export const MemoryServiceConfigSchema = z.object({
  salienceWeights: SalienceWeightsSchema,
  promotionThreshold: z.number(),       // 0.6 - Score to promote to LTM
  staleThreshold: z.number(),           // 0.2 - Confidence below this = stale
  dormantThreshold: z.number(),         // 0.1 - Below this = dormant
  workingMemoryLimit: z.number(),       // 50 - Max items in working memory view
  topOfMindLimit: z.number(),           // 10 - Items shown in top-of-mind view
  accessBoostDurationMs: z.number(),    // 5 * 60 * 1000 - 5 minutes
  accessBoostFactor: z.number(),        // 1.2 - 20% salience boost
  decayConfig: DecayConfigSchema,
});

/**
 * Default memory service configuration
 */
export const DEFAULT_MEMORY_CONFIG = {
  salienceWeights: {
    recency: 0.35,
    emotional: 0.25,
    stakes: 0.20,
    confirmation: 0.15,
    access: 0.05,
  },
  promotionThreshold: 0.6,
  staleThreshold: 0.2,
  dormantThreshold: 0.1,
  workingMemoryLimit: 50,
  topOfMindLimit: 10,
  accessBoostDurationMs: 5 * 60 * 1000, // 5 minutes
  accessBoostFactor: 1.2,
  decayConfig: DEFAULT_DECAY_CONFIG,
} as const;
