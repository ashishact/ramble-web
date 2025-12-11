/**
 * Concern Observer
 *
 * Tracks worries, concerns, and their evolution.
 * Detects new concerns, ongoing concerns, and possibly resolved concerns.
 */

import type { ObserverOutput, Claim } from '../types';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { BaseObserver } from './baseObserver';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('ConcernObserver');

// ============================================================================
// Concern Observer Implementation
// ============================================================================

export class ConcernObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'concern_observer',
    name: 'Concern Observer',
    description: 'Tracks worries and their evolution',
    triggers: ['new_claim', 'session_end'],
    claimTypeFilter: ['concern', 'emotion'],
    priority: 4,
    usesLLM: false,
  };

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();
    const outputs: ObserverOutput[] = [];

    try {
      // Find concern-related claims
      const concernClaims = this.findConcernClaims(context);

      if (concernClaims.length === 0) {
        return this.successResult(outputs, startTime);
      }

      for (const claim of concernClaims) {
        // Check if this relates to an existing concern pattern
        const existingConcern = this.findExistingConcern(context, claim);

        if (existingConcern) {
          // Concern continues
          const output = this.createOutput(
            context,
            'concern_continued',
            {
              existingPatternId: existingConcern.id,
              newClaimId: claim.id,
              subject: claim.subject,
              intensity: claim.emotionalIntensity,
            },
            [claim.id, existingConcern.id]
          );
          outputs.push(output);
        } else {
          // New concern detected
          const output = this.createOutput(
            context,
            'concern_new',
            {
              claimId: claim.id,
              subject: claim.subject,
              statement: claim.statement,
              intensity: claim.emotionalIntensity,
              stakes: claim.stakes,
            },
            [claim.id]
          );
          outputs.push(output);
        }
      }

      // On session end, check for possibly resolved concerns
      if (context.triggeringClaims.length === 0) {
        const resolvedOutputs = await this.checkForResolvedConcerns(context);
        outputs.push(...resolvedOutputs);
      }

      logger.info('Concern observation complete', {
        newConcerns: outputs.filter((o) => o.output_type === 'concern_new').length,
        continuedConcerns: outputs.filter((o) => o.output_type === 'concern_continued').length,
        resolvedConcerns: outputs.filter((o) => o.output_type === 'concern_possibly_resolved')
          .length,
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
   * Find claims that indicate concerns
   */
  private findConcernClaims(context: ObserverContext): Claim[] {
    const allClaims =
      context.triggeringClaims.length > 0
        ? context.triggeringClaims
        : context.recentClaims;

    return allClaims.filter(
      (claim) =>
        claim.claim_type === 'concern' ||
        (claim.emotionalValence < -0.3 && claim.emotionalIntensity > 0.5)
    );
  }

  /**
   * Find existing concern pattern that matches this claim
   */
  private findExistingConcern(
    context: ObserverContext,
    claim: Claim
  ): { id: string } | null {
    // Look for existing patterns about the same subject
    const patterns = context.store.patterns.getAll();

    for (const pattern of patterns) {
      if (
        pattern.pattern_type === 'concern' &&
        pattern.description.toLowerCase().includes(claim.subject.toLowerCase())
      ) {
        return { id: pattern.id };
      }
    }

    return null;
  }

  /**
   * Check for concerns that may have been resolved
   */
  private async checkForResolvedConcerns(
    context: ObserverContext
  ): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];

    // Get all concern patterns
    const concernPatterns = context.store.patterns
      .getAll()
      .filter((p) => p.pattern_type === 'concern');

    for (const pattern of concernPatterns) {
      // Get recent claims about this concern's subject
      const recentRelated = context.recentClaims.filter(
        (c) =>
          c.subject.toLowerCase().includes(pattern.description.toLowerCase()) ||
          pattern.description.toLowerCase().includes(c.subject.toLowerCase())
      );

      // Check for resolution indicators
      const resolutionIndicators = recentRelated.filter(
        (c) =>
          c.emotionalValence > 0.3 ||
          c.statement.toLowerCase().includes('resolved') ||
          c.statement.toLowerCase().includes('better') ||
          c.statement.toLowerCase().includes('figured out') ||
          c.statement.toLowerCase().includes('not worried')
      );

      if (resolutionIndicators.length > 0) {
        const output = this.createOutput(
          context,
          'concern_possibly_resolved',
          {
            patternId: pattern.id,
            description: pattern.description,
            evidence: resolutionIndicators.map((c) => ({
              id: c.id,
              statement: c.statement,
            })),
          },
          [pattern.id, ...resolutionIndicators.map((c) => c.id)]
        );
        outputs.push(output);
      }
    }

    return outputs;
  }
}
