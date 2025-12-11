/**
 * Memory Service
 *
 * Unified service managing working memory and long-term memory with:
 * - Real-time salience calculation
 * - Decay processing
 * - Memory tier promotion
 * - TopOfMind generation
 */

import type { IProgramStore } from '../interfaces/store';
import type {
  Claim,
  Entity,
  Goal,
  TopOfMind,
  MemoryStats,
  SalienceFactors,
  DecayResult,
  MemoryServiceConfig,
  SalientTopic,
  SalientEntity,
  SalientGoal,
  SalientConcern,
  SalientQuestion,
  EmotionalHighlight,
  Stakes,
} from '../types';
import { DEFAULT_MEMORY_CONFIG, DEFAULT_DECAY_CONFIG } from '../schemas/memory';
import { exponentialDecay, now, SALIENCE_HALFLIFE, ACCESS_BOOST_DURATION } from '../utils/time';
import { createLogger } from '../utils/logger';

const logger = createLogger('MemoryService');

// ============================================================================
// Memory Service Implementation
// ============================================================================

export class MemoryService {
  private store: IProgramStore;
  private config: MemoryServiceConfig;
  private promotedThisSession: number = 0;
  private lastDecayRun: number | null = null;
  private lastConsolidationRun: number | null = null;

  constructor(store: IProgramStore, config?: Partial<MemoryServiceConfig>) {
    this.store = store;
    this.config = {
      ...DEFAULT_MEMORY_CONFIG,
      ...config,
      salienceWeights: {
        ...DEFAULT_MEMORY_CONFIG.salienceWeights,
        ...(config?.salienceWeights ?? {}),
      },
      decayConfig: {
        ...DEFAULT_DECAY_CONFIG,
        ...(config?.decayConfig ?? {}),
      },
    };
    logger.info('MemoryService initialized', { config: this.config });
  }

  // ============================================================================
  // Salience Calculation
  // ============================================================================

  /**
   * Calculate current salience for a claim
   * Combines multiple factors with configurable weights
   */
  calculateSalience(claim: Claim): number {
    const factors = this.getSalienceFactors(claim);
    const weights = this.config.salienceWeights;

    let salience =
      weights.recency * factors.recencyFactor +
      weights.emotional * factors.emotionalFactor +
      weights.stakes * factors.stakesFactor +
      weights.confirmation * factors.confirmationFactor +
      weights.access * factors.accessFactor;

    // LTM claims get stability floor - they don't drop below 0.3
    if (claim.memoryTier === 'long_term') {
      salience = Math.max(salience, 0.3);
    }

    return Math.min(Math.max(salience, 0), 1);
  }

  /**
   * Get detailed salience breakdown for debugging/UI
   */
  getSalienceFactors(claim: Claim): SalienceFactors {
    return {
      recencyFactor: this.calculateRecencyFactor(claim),
      emotionalFactor: claim.emotionalIntensity,
      stakesFactor: this.stakesToFactor(claim.stakes),
      confirmationFactor: this.calculateConfirmationFactor(claim),
      accessFactor: this.calculateAccessFactor(claim),
    };
  }

  private calculateRecencyFactor(claim: Claim): number {
    return exponentialDecay(claim.lastConfirmed, SALIENCE_HALFLIFE);
  }

  private stakesToFactor(stakes: Stakes): number {
    const map: Record<Stakes, number> = {
      low: 0.2,
      medium: 0.5,
      high: 0.8,
      existential: 1.0,
    };
    return map[stakes] ?? 0.5;
  }

  private calculateConfirmationFactor(claim: Claim): number {
    // Log scale, capped at 1.0 (log2(16) = 4)
    return Math.min(Math.log2(claim.confirmationCount + 1) / 4, 1.0);
  }

  private calculateAccessFactor(claim: Claim): number {
    const timeSinceAccess = now() - claim.lastAccessed;
    if (timeSinceAccess > ACCESS_BOOST_DURATION) return 0;
    return 1 - timeSinceAccess / ACCESS_BOOST_DURATION;
  }

  /**
   * Bulk update salience for all working memory claims
   */
  updateAllSalience(): void {
    const claims = this.store.claims.getByState('active');
    for (const claim of claims) {
      const salience = this.calculateSalience(claim);
      this.store.claims.updateSalience(claim.id, salience);
    }
    logger.debug('Updated salience for all active claims', { count: claims.length });
  }

  // ============================================================================
  // Working Memory Operations
  // ============================================================================

  /**
   * Get current working memory contents sorted by salience
   */
  getWorkingMemory(): Claim[] {
    const claims = this.store.claims.getByMemoryTier('working');

    // Calculate and update salience for each
    const withSalience = claims.map((claim) => ({
      ...claim,
      salience: this.calculateSalience(claim),
    }));

    // Sort by salience descending
    return withSalience
      .sort((a, b) => b.salience - a.salience)
      .slice(0, this.config.workingMemoryLimit);
  }

  /**
   * Get TopOfMind snapshot - formatted view of working memory
   */
  getTopOfMind(): TopOfMind {
    const allClaims = this.store.claims.getByState('active');
    const allEntities = this.store.entities.getAll();
    const allGoals = this.store.goals.getActive();
    const limit = this.config.topOfMindLimit;

    // Calculate salience for all active claims
    const claimsWithSalience = allClaims.map((c) => ({
      ...c,
      salience: this.calculateSalience(c),
    }));

    return {
      topics: this.getTopTopics(claimsWithSalience, limit),
      entities: this.getTopEntities(allEntities, limit),
      goals: this.getTopGoals(allGoals, claimsWithSalience, limit),
      concerns: this.getTopConcerns(claimsWithSalience, limit),
      openQuestions: this.getTopQuestions(claimsWithSalience, limit),
      recentHighIntensity: this.getEmotionalHighlights(claimsWithSalience, limit),
    };
  }

  private getTopTopics(claims: (Claim & { salience: number })[], limit: number): SalientTopic[] {
    // Group claims by subject
    const topicMap = new Map<string, { claims: (Claim & { salience: number })[] }>();

    for (const claim of claims) {
      const existing = topicMap.get(claim.subject);
      if (existing) {
        existing.claims.push(claim);
      } else {
        topicMap.set(claim.subject, { claims: [claim] });
      }
    }

    // Calculate topic salience as average of claims
    const topics: SalientTopic[] = [];
    for (const [topic, data] of topicMap) {
      const avgSalience = data.claims.reduce((sum, c) => sum + c.salience, 0) / data.claims.length;
      const lastMentioned = Math.max(...data.claims.map((c) => c.lastConfirmed));
      topics.push({
        topic,
        salience: avgSalience,
        lastMentioned,
        claimCount: data.claims.length,
      });
    }

    return topics.sort((a, b) => b.salience - a.salience).slice(0, limit);
  }

  private getTopEntities(entities: Entity[], limit: number): SalientEntity[] {
    // Calculate entity salience based on mention count and recency
    const entitiesWithSalience = entities.map((e) => {
      const recencyFactor = exponentialDecay(e.lastReferenced, SALIENCE_HALFLIFE);
      const mentionFactor = Math.min(Math.log2(e.mentionCount + 1) / 4, 1.0);
      const salience = 0.5 * recencyFactor + 0.5 * mentionFactor;
      return {
        entityId: e.id,
        entity: e.canonicalName,
        entityType: e.entityType,
        salience,
        mentionCount: e.mentionCount,
      };
    });

    return entitiesWithSalience.sort((a, b) => b.salience - a.salience).slice(0, limit);
  }

  private getTopGoals(
    goals: Goal[],
    claims: (Claim & { salience: number })[],
    limit: number
  ): SalientGoal[] {
    // Calculate goal salience based on recency and related claims
    const goalsWithSalience = goals.map((g) => {
      const recencyFactor = exponentialDecay(g.lastReferenced, SALIENCE_HALFLIFE);

      // Find claims that might be related to this goal
      const relatedClaims = claims.filter(
        (c) =>
          c.claimType === 'goal' &&
          c.statement.toLowerCase().includes(g.statement.toLowerCase().slice(0, 20))
      );
      const claimSalience =
        relatedClaims.length > 0
          ? relatedClaims.reduce((sum, c) => sum + c.salience, 0) / relatedClaims.length
          : 0;

      const salience = 0.6 * recencyFactor + 0.4 * claimSalience;

      return {
        goalId: g.id,
        statement: g.statement,
        salience,
        status: g.status,
        progressValue: g.progress_value,
      };
    });

    return goalsWithSalience.sort((a, b) => b.salience - a.salience).slice(0, limit);
  }

  private getTopConcerns(
    claims: (Claim & { salience: number })[],
    limit: number
  ): SalientConcern[] {
    return claims
      .filter((c) => c.claimType === 'concern')
      .sort((a, b) => b.salience - a.salience)
      .slice(0, limit)
      .map((c) => ({
        claimId: c.id,
        concern: c.statement,
        salience: c.salience,
        stakes: c.stakes,
        emotionalIntensity: c.emotionalIntensity,
      }));
  }

  private getTopQuestions(
    claims: (Claim & { salience: number })[],
    limit: number
  ): SalientQuestion[] {
    return claims
      .filter((c) => c.claimType === 'question')
      .sort((a, b) => b.salience - a.salience)
      .slice(0, limit)
      .map((c) => ({
        claimId: c.id,
        question: c.statement,
        salience: c.salience,
      }));
  }

  private getEmotionalHighlights(
    claims: (Claim & { salience: number })[],
    limit: number
  ): EmotionalHighlight[] {
    return claims
      .filter((c) => c.emotionalIntensity > 0.6)
      .sort((a, b) => b.emotionalIntensity - a.emotionalIntensity)
      .slice(0, limit)
      .map((c) => ({
        claimId: c.id,
        statement: c.statement,
        emotionalIntensity: c.emotionalIntensity,
        valence: c.emotionalValence,
      }));
  }

  /**
   * Record access to a claim (viewing it boosts salience)
   */
  recordAccess(claimId: string): void {
    this.store.claims.updateLastAccessed(claimId);
  }

  /**
   * Add new claim to working memory with initial salience
   */
  addToWorkingMemory(claim: Claim): void {
    const salience = this.calculateSalience(claim);
    this.store.claims.updateSalience(claim.id, salience);
  }

  // ============================================================================
  // Long-Term Memory Operations
  // ============================================================================

  /**
   * Get all long-term memory claims
   */
  getLongTermMemory(): Claim[] {
    const claims = this.store.claims.getByMemoryTier('long_term');
    return claims
      .map((c) => ({ ...c, salience: this.calculateSalience(c) }))
      .sort((a, b) => b.salience - a.salience);
  }

  /**
   * Promote claim from working to long-term memory
   */
  promoteToLongTerm(claimId: string, reason?: string): boolean {
    const claim = this.store.claims.getById(claimId);
    if (!claim || claim.memoryTier === 'long_term') {
      return false;
    }

    this.store.claims.promoteToLongTerm(claimId);
    this.promotedThisSession++;
    logger.info('Promoted claim to long-term memory', { claimId, reason });
    return true;
  }

  /**
   * Check if claim should be promoted based on consolidation score
   */
  shouldPromote(claim: Claim): boolean {
    return this.calculateConsolidationScore(claim) >= this.config.promotionThreshold;
  }

  /**
   * Calculate consolidation score for potential LTM promotion
   * (Mirrors ConsolidationObserver logic)
   */
  calculateConsolidationScore(claim: Claim): number {
    let score = 0;

    // Emotional intensity (max 0.3)
    score += claim.emotionalIntensity * 0.3;

    // High stakes (max 0.3)
    if (claim.stakes === 'existential') {
      score += 0.3;
    } else if (claim.stakes === 'high') {
      score += 0.2;
    } else if (claim.stakes === 'medium') {
      score += 0.1;
    }

    // Repeated mentions (max 0.2)
    score += Math.min(claim.confirmationCount * 0.1, 0.2);

    // Explicit importance markers (max 0.2)
    const statement = claim.statement.toLowerCase();
    if (
      statement.includes('important') ||
      statement.includes('remember') ||
      statement.includes('never forget') ||
      statement.includes('crucial') ||
      statement.includes('critical')
    ) {
      score += 0.2;
    }

    // Claim type bonuses
    if (claim.claimType === 'value' || claim.claimType === 'goal') {
      score += 0.1;
    }
    if (claim.claimType === 'commitment' || claim.claimType === 'decision') {
      score += 0.1;
    }

    return Math.min(score, 1);
  }

  // ============================================================================
  // Decay Operations
  // ============================================================================

  /**
   * Run decay process on all applicable claims
   */
  runDecay(): DecayResult {
    const result: DecayResult = {
      processedCount: 0,
      decayedCount: 0,
      staleCount: 0,
      dormantCount: 0,
      errors: [],
    };

    const decayableClaims = this.store.claims.getDecayable();

    for (const claim of decayableClaims) {
      try {
        const decayFactor = this.getDecayFactor(claim);
        const newConfidence = claim.currentConfidence * decayFactor;

        // Update confidence
        this.store.claims.decayConfidence(claim.id, decayFactor);
        result.decayedCount++;

        // Check thresholds and update state
        if (newConfidence < this.config.dormantThreshold) {
          this.store.claims.markDormant(claim.id);
          result.dormantCount++;
        } else if (newConfidence < this.config.staleThreshold) {
          this.store.claims.markStale(claim.id);
          result.staleCount++;
        }

        result.processedCount++;
      } catch (error) {
        result.errors.push({
          claimId: claim.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    this.lastDecayRun = now();
    logger.info('Decay run complete', result);
    return result;
  }

  /**
   * Calculate decay factor for a claim based on its temporality
   */
  getDecayFactor(claim: Claim): number {
    const config = this.config.decayConfig[claim.temporality];
    if (!config.halfLifeMs) {
      return 1; // No decay for eternal claims
    }
    return exponentialDecay(claim.lastConfirmed, config.halfLifeMs);
  }

  // ============================================================================
  // Statistics
  // ============================================================================

  /**
   * Get memory system statistics
   */
  getStats(): MemoryStats {
    const allClaims = this.store.claims.getAll();
    const workingMemory = this.store.claims.getByMemoryTier('working');
    const longTermMemory = this.store.claims.getByMemoryTier('long_term');

    // Calculate salience for all claims
    const claimsWithSalience = allClaims
      .filter((c) => c.state === 'active')
      .map((c) => ({
        ...c,
        salience: this.calculateSalience(c),
      }));

    const totalSalience = claimsWithSalience.reduce((sum, c) => sum + c.salience, 0);
    const averageSalience = claimsWithSalience.length > 0 ? totalSalience / claimsWithSalience.length : 0;

    return {
      workingMemoryCount: workingMemory.filter((c) => c.state === 'active').length,
      longTermMemoryCount: longTermMemory.filter((c) => c.state === 'active').length,
      totalClaimsCount: allClaims.length,
      averageSalience,
      highSalienceCount: claimsWithSalience.filter((c) => c.salience > 0.7).length,
      mediumSalienceCount: claimsWithSalience.filter((c) => c.salience > 0.4 && c.salience <= 0.7).length,
      lowSalienceCount: claimsWithSalience.filter((c) => c.salience <= 0.4).length,
      decayingCount: allClaims.filter((c) => c.temporality !== 'eternal' && c.state === 'active').length,
      staleCount: allClaims.filter((c) => c.state === 'stale').length,
      dormantCount: allClaims.filter((c) => c.state === 'dormant').length,
      promotedThisSession: this.promotedThisSession,
      lastDecayRun: this.lastDecayRun,
      lastConsolidationRun: this.lastConsolidationRun,
    };
  }

  /**
   * Record that consolidation was run
   */
  recordConsolidationRun(): void {
    this.lastConsolidationRun = now();
  }

  /**
   * Reset session counters
   */
  resetSessionCounters(): void {
    this.promotedThisSession = 0;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createMemoryService(
  store: IProgramStore,
  config?: Partial<MemoryServiceConfig>
): MemoryService {
  return new MemoryService(store, config);
}
