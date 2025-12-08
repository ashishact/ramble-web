/**
 * Contradiction Observer
 *
 * Detects contradictions between claims - when the person says things
 * that conflict with what they said before.
 */

import type { Claim, CreateContradiction } from '../types';
import { BaseObserver } from './baseObserver';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { callLLM } from '../pipeline/llmClient';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('Observer');

// ============================================================================
// Contradiction Observer Implementation
// ============================================================================

interface ContradictionCandidate {
  claimA: Claim;
  claimB: Claim;
  similarity: number;
}

interface DetectedContradiction {
  claimAId: string;
  claimBId: string;
  type: 'direct' | 'temporal' | 'implication';
  explanation: string;
}

export class ContradictionObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'contradiction_observer',
    name: 'Contradiction Observer',
    description: 'Detects contradictions between claims',
    triggers: ['new_claim'],
    claimTypeFilter: ['belief', 'intention', 'factual'],
    priority: 80,
    usesLLM: true,
  };

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();

    try {
      // Get new claims to check
      const newClaims = context.triggeringClaims.filter(
        (c) => this.config.claimTypeFilter?.includes(c.claim_type)
      );

      if (newClaims.length === 0) {
        return this.successResult([], startTime);
      }

      // Get existing claims to compare against
      const existingClaims = context.store.claims
        .getRecent(100)
        .filter((c) => !newClaims.some((nc) => nc.id === c.id));

      // Find potential contradictions
      const candidates = this.findCandidates(newClaims, existingClaims);

      if (candidates.length === 0) {
        return this.successResult([], startTime);
      }

      logger.debug('Found contradiction candidates', { count: candidates.length });

      // Use LLM to verify contradictions
      const contradictions = await this.verifyContradictions(candidates);

      // Save detected contradictions
      const outputs = [];
      for (const contradiction of contradictions) {
        const data: CreateContradiction = {
          claim_a_id: contradiction.claimAId,
          claim_b_id: contradiction.claimBId,
          contradiction_type: contradiction.type,
          resolved: false,
          resolution_type: null,
          resolution_notes: null,
          resolved_at: null,
        };

        context.store.observerOutputs.addContradiction(data);

        // Also create an observer output for the contradiction
        const output = this.createOutput(
          context,
          'contradiction_detected',
          {
            contradiction_type: contradiction.type,
            explanation: contradiction.explanation,
          },
          [contradiction.claimAId, contradiction.claimBId]
        );

        outputs.push(output);

        logger.info('Detected contradiction', {
          claimA: contradiction.claimAId,
          claimB: contradiction.claimBId,
          type: contradiction.type,
        });
      }

      return this.successResult(outputs, startTime);
    } catch (error) {
      return this.errorResult(
        error instanceof Error ? error.message : 'Unknown error',
        startTime
      );
    }
  }

  /**
   * Find candidate claim pairs that might contradict
   */
  private findCandidates(
    newClaims: Claim[],
    existingClaims: Claim[]
  ): ContradictionCandidate[] {
    const candidates: ContradictionCandidate[] = [];

    for (const newClaim of newClaims) {
      for (const existing of existingClaims) {
        // Skip same claim type matching for some types
        if (newClaim.claim_type !== existing.claim_type) continue;

        // Skip very low confidence claims
        if (existing.current_confidence < 0.4) continue;

        // Check for subject overlap
        const similarity = this.calculateSimilarity(newClaim, existing);

        if (similarity > 0.3) {
          candidates.push({
            claimA: newClaim,
            claimB: existing,
            similarity,
          });
        }
      }
    }

    // Sort by similarity and take top candidates
    return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, 5);
  }

  /**
   * Calculate similarity between two claims
   */
  private calculateSimilarity(claimA: Claim, claimB: Claim): number {
    // Same subject is a strong signal
    if (claimA.subject.toLowerCase() === claimB.subject.toLowerCase()) {
      return 0.8;
    }

    // Check for keyword overlap
    const wordsA = new Set(claimA.statement.toLowerCase().split(/\s+/));
    const wordsB = new Set(claimB.statement.toLowerCase().split(/\s+/));

    const intersection = [...wordsA].filter((w) => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;

    return union > 0 ? intersection / union : 0;
  }

  /**
   * Use LLM to verify if candidates are actual contradictions
   */
  private async verifyContradictions(
    candidates: ContradictionCandidate[]
  ): Promise<DetectedContradiction[]> {
    if (candidates.length === 0) return [];

    const prompt = this.buildVerificationPrompt(candidates);

    try {
      const response = await callLLM({
        provider: 'groq', // Fast provider for real-time checks
        prompt,
        options: {
          temperature: 0.1,
          max_tokens: 500,
        },
      });

      return this.parseVerificationResponse(response.content, candidates);
    } catch (error) {
      logger.warn('Failed to verify contradictions via LLM', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
      return [];
    }
  }

  /**
   * Build prompt for contradiction verification
   */
  private buildVerificationPrompt(candidates: ContradictionCandidate[]): string {
    const pairs = candidates
      .map(
        (c, i) => `Pair ${i + 1}:
  A: "${c.claimA.statement}" (${c.claimA.claim_type})
  B: "${c.claimB.statement}" (${c.claimB.claim_type})`
      )
      .join('\n\n');

    return `Analyze these claim pairs and identify any contradictions.

${pairs}

For each pair that contradicts, respond with JSON:
{
  "contradictions": [
    {
      "pair": 1,
      "type": "direct|temporal|implication",
      "explanation": "Brief explanation"
    }
  ]
}

Types:
- direct: Claims directly oppose each other
- temporal: Claims about the same thing at different times conflict
- implication: One claim implies the opposite of another

If no contradictions, respond: {"contradictions": []}`;
  }

  /**
   * Parse LLM response for contradictions
   */
  private parseVerificationResponse(
    content: string,
    candidates: ContradictionCandidate[]
  ): DetectedContradiction[] {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const contradictions: DetectedContradiction[] = [];

      for (const c of parsed.contradictions || []) {
        const pairIndex = (c.pair || 1) - 1;
        const candidate = candidates[pairIndex];

        if (candidate) {
          contradictions.push({
            claimAId: candidate.claimA.id,
            claimBId: candidate.claimB.id,
            type: c.type || 'direct',
            explanation: c.explanation || '',
          });
        }
      }

      return contradictions;
    } catch {
      return [];
    }
  }
}
