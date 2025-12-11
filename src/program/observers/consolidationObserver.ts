/**
 * Consolidation Observer
 *
 * Handles memory consolidation at session end.
 * Identifies claims that should be promoted to long-term memory
 * based on emotional intensity, stakes, repetition, and explicit markers.
 */

import type { ObserverOutput, Claim } from '../types';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { BaseObserver } from './baseObserver';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('ConsolidationObserver');

// Threshold for consolidation to long-term memory
const CONSOLIDATION_THRESHOLD = 0.6;

// ============================================================================
// Consolidation Observer Implementation
// ============================================================================

interface ConsolidationFactors {
  emotionalIntensity: number;
  highStakes: boolean;
  repetitionBonus: number;
  explicitImportance: boolean;
}

export class ConsolidationObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'consolidation_observer',
    name: 'Consolidation Observer',
    description: 'Memory consolidation at session end',
    triggers: ['session_end'],
    priority: 1, // Run last
    usesLLM: false,
  };

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();
    const outputs: ObserverOutput[] = [];

    try {
      // Get claims from the current session
      const sessionClaims = this.getSessionClaims(context);

      if (sessionClaims.length === 0) {
        return this.successResult(outputs, startTime);
      }

      let consolidatedCount = 0;
      let totalScore = 0;

      for (const claim of sessionClaims) {
        const score = this.calculateConsolidationScore(claim);
        totalScore += score;

        if (score >= CONSOLIDATION_THRESHOLD) {
          const factors = this.getConsolidationFactors(claim);

          const output = this.createOutput(
            context,
            'consolidate_to_long_term',
            {
              claimId: claim.id,
              statement: claim.statement,
              subject: claim.subject,
              score,
              factors,
              recommendation: this.getConsolidationRecommendation(score, factors),
            },
            [claim.id]
          );
          outputs.push(output);
          consolidatedCount++;
        }
      }

      // Create session summary output
      if (sessionClaims.length > 0) {
        const summaryOutput = this.createOutput(
          context,
          'consolidation_summary',
          {
            sessionId: context.sessionId,
            totalClaims: sessionClaims.length,
            consolidatedClaims: consolidatedCount,
            averageScore: totalScore / sessionClaims.length,
            topSubjects: this.getTopSubjects(sessionClaims),
            emotionalHighlights: this.getEmotionalHighlights(sessionClaims),
          },
          sessionClaims.slice(0, 10).map((c) => c.id)
        );
        outputs.push(summaryOutput);
      }

      logger.info('Consolidation observation complete', {
        sessionClaims: sessionClaims.length,
        consolidated: consolidatedCount,
        threshold: CONSOLIDATION_THRESHOLD,
      });

      return this.successResult(outputs, startTime);
    } catch (error) {
      return this.errorResult(
        error instanceof Error ? error.message : 'Unknown error',
        startTime
      );
    }
  }

  /**
   * Get claims from the current session
   */
  private getSessionClaims(context: ObserverContext): Claim[] {
    // Use recent claims as proxy for session claims
    // In production, would filter by session_id via claim_sources
    return context.recentClaims;
  }

  /**
   * Calculate how important this claim is to consolidate
   */
  private calculateConsolidationScore(claim: Claim): number {
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

  /**
   * Get breakdown of consolidation factors
   */
  private getConsolidationFactors(claim: Claim): ConsolidationFactors {
    const statement = claim.statement.toLowerCase();

    return {
      emotionalIntensity: claim.emotionalIntensity,
      highStakes: claim.stakes === 'high' || claim.stakes === 'existential',
      repetitionBonus: Math.min(claim.confirmationCount * 0.1, 0.2),
      explicitImportance:
        statement.includes('important') ||
        statement.includes('remember') ||
        statement.includes('never forget'),
    };
  }

  /**
   * Get recommendation based on score and factors
   */
  private getConsolidationRecommendation(
    score: number,
    factors: ConsolidationFactors
  ): string {
    if (score >= 0.9) {
      return 'Critical - should be permanently retained';
    }
    if (score >= 0.8) {
      return 'Very important - high retention priority';
    }
    if (score >= 0.7) {
      return 'Important - moderate retention priority';
    }
    if (factors.highStakes) {
      return 'Retain due to high stakes';
    }
    if (factors.emotionalIntensity > 0.7) {
      return 'Retain due to emotional significance';
    }
    return 'Standard retention';
  }

  /**
   * Get most discussed subjects in session
   */
  private getTopSubjects(claims: Claim[]): Array<{ subject: string; count: number }> {
    const subjectCounts: Record<string, number> = {};

    for (const claim of claims) {
      subjectCounts[claim.subject] = (subjectCounts[claim.subject] || 0) + 1;
    }

    return Object.entries(subjectCounts)
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  /**
   * Get emotional highlights from session
   */
  private getEmotionalHighlights(
    claims: Claim[]
  ): Array<{ statement: string; valence: number; intensity: number }> {
    return claims
      .filter((c) => c.emotionalIntensity > 0.6)
      .sort((a, b) => b.emotionalIntensity - a.emotionalIntensity)
      .slice(0, 5)
      .map((c) => ({
        statement: c.statement,
        valence: c.emotionalValence,
        intensity: c.emotionalIntensity,
      }));
  }
}
