/**
 * Base Observer
 *
 * Abstract base class for all observers.
 * Provides common functionality for output creation and result handling.
 */

import type { ObserverOutput, CreateObserverOutput, Claim } from '../types';
import type { ObserverConfig, ObserverContext, ObserverResult, Observer } from './types';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('Observer');

// ============================================================================
// Base Observer Implementation
// ============================================================================

export abstract class BaseObserver implements Observer {
  abstract config: ObserverConfig;

  /**
   * Check if observer should run - can be overridden by subclasses
   */
  shouldRun(context: ObserverContext): boolean {
    // Check if we have triggering claims and they match our filter
    if (this.config.claimTypeFilter && this.config.claimTypeFilter.length > 0) {
      if (context.triggeringClaims.length === 0) {
        return false;
      }

      const hasMatchingClaim = context.triggeringClaims.some((claim) =>
        this.config.claimTypeFilter!.includes(claim.claimType)
      );

      if (!hasMatchingClaim) {
        return false;
      }
    }

    return true;
  }

  /**
   * Run the observer - must be implemented by subclasses
   */
  abstract run(context: ObserverContext): Promise<ObserverResult>;

  /**
   * Create an observer output and save it to the store
   */
  protected createOutput(
    context: ObserverContext,
    outputType: string,
    content: unknown,
    sourceClaimIds: string[]
  ): ObserverOutput {
    const data: CreateObserverOutput = {
      observer_type: this.config.type,
      output_type: outputType,
      content_json: JSON.stringify(content),
      source_claims_json: JSON.stringify(sourceClaimIds),
      stale: false,
    };

    const output = context.store.observerOutputs.create(data);

    logger.debug('Created observer output', {
      observerType: this.config.type,
      outputType,
      id: output.id,
    });

    return output;
  }

  /**
   * Build a successful result
   */
  protected successResult(
    outputs: ObserverOutput[],
    startTime: number
  ): ObserverResult {
    return {
      observerType: this.config.type,
      hasOutput: outputs.length > 0,
      outputs,
      processingTimeMs: now() - startTime,
    };
  }

  /**
   * Build an error result
   */
  protected errorResult(error: string, startTime: number): ObserverResult {
    logger.error('Observer error', {
      observerType: this.config.type,
      error,
    });

    return {
      observerType: this.config.type,
      hasOutput: false,
      outputs: [],
      processingTimeMs: now() - startTime,
      error,
    };
  }

  /**
   * Get claims from the context grouped by type
   */
  protected groupClaimsByType(claims: Claim[]): Record<string, Claim[]> {
    const grouped: Record<string, Claim[]> = {};

    for (const claim of claims) {
      if (!grouped[claim.claimType]) {
        grouped[claim.claimType] = [];
      }
      grouped[claim.claimType].push(claim);
    }

    return grouped;
  }

  /**
   * Filter claims by confidence threshold
   */
  protected filterByConfidence(claims: Claim[], minConfidence: number): Claim[] {
    return claims.filter((c) => c.currentConfidence >= minConfidence);
  }

  /**
   * Get unique subjects from claims
   */
  protected getUniqueSubjects(claims: Claim[]): string[] {
    return [...new Set(claims.map((c) => c.subject))];
  }
}
