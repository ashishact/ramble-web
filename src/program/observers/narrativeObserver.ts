/**
 * Narrative Observer
 *
 * Identifies recurring stories, self-narratives, and identity themes.
 * Runs periodically to analyze patterns in self-perception and memory references.
 */

import type { ObserverOutput, Claim } from '../types';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { BaseObserver } from './baseObserver';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';
import { callLLM } from '../pipeline/llmClient';

const logger = createLogger('NarrativeObserver');

// ============================================================================
// Narrative Observer Implementation
// ============================================================================

export class NarrativeObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'narrative_observer',
    name: 'Narrative Observer',
    description: 'Identifies recurring stories and self-narratives',
    triggers: ['schedule'],
    priority: 2,
    usesLLM: true,
  };

  // Only run weekly-ish (after many claims)
  shouldRun(context: ObserverContext): boolean {
    // Check if we have enough claims to analyze
    const allClaims = context.store.claims.getAll();
    const selfClaims = allClaims.filter(
      (c) => c.claimType === 'self_perception' || c.claimType === 'memory_reference'
    );

    // Need at least 10 self/memory claims to analyze narratives
    return selfClaims.length >= 10;
  }

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();
    const outputs: ObserverOutput[] = [];

    try {
      // Get self-perception claims
      const allClaims = context.store.claims.getAll();
      const selfClaims = allClaims
        .filter((c) => c.claimType === 'self_perception')
        .slice(-50);

      // Get memory references
      const memoryClaims = allClaims
        .filter((c) => c.claimType === 'memory_reference')
        .slice(-50);

      if (selfClaims.length === 0 && memoryClaims.length === 0) {
        return this.successResult(outputs, startTime);
      }

      // Use LLM to analyze narratives
      const analysis = await this.analyzeNarratives(selfClaims, memoryClaims);

      if (analysis) {
        const sourceIds = [
          ...selfClaims.map((c) => c.id),
          ...memoryClaims.map((c) => c.id),
        ].slice(0, 20);

        const output = this.createOutput(
          context,
          'narrative_analysis',
          {
            dominantSelfNarratives: analysis.selfNarratives,
            recurringStories: analysis.recurringStories,
            identityThemes: analysis.identityThemes,
            claimCount: selfClaims.length + memoryClaims.length,
            analysisTimestamp: now(),
          },
          sourceIds
        );
        outputs.push(output);
      }

      logger.info('Narrative observation complete', {
        selfClaimsAnalyzed: selfClaims.length,
        memoryClaimsAnalyzed: memoryClaims.length,
        hasAnalysis: analysis !== null,
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
   * Use LLM to analyze self-narratives and stories
   */
  private async analyzeNarratives(
    selfClaims: Claim[],
    memoryClaims: Claim[]
  ): Promise<{
    selfNarratives: string[];
    recurringStories: string[];
    identityThemes: string[];
  } | null> {
    const selfStatements = selfClaims.map((c) => `- ${c.statement}`).join('\n');
    const memoryStatements = memoryClaims.map((c) => `- ${c.statement}`).join('\n');

    const prompt = `Analyze these self-perception statements and memory references to identify narrative patterns.

SELF-PERCEPTION STATEMENTS:
${selfStatements || '(none)'}

MEMORY REFERENCES:
${memoryStatements || '(none)'}

Identify:
1. Dominant self-narratives (recurring ways they describe themselves)
2. Recurring stories (memories or experiences they reference multiple times)
3. Identity themes (core themes about who they are)

Respond with JSON:
{
  "selfNarratives": ["narrative 1", "narrative 2"],
  "recurringStories": ["story theme 1", "story theme 2"],
  "identityThemes": ["theme 1", "theme 2"]
}

If insufficient data for any category, use empty array.`;

    try {
      const response = await callLLM({
        tier: 'small',
        systemPrompt: 'You are a narrative analyst. Identify patterns in self-perception and storytelling. Respond only with valid JSON.',
        prompt,
        options: {
          temperature: 0.3,
          max_tokens: 1000,
        },
      });

      // Parse JSON response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          selfNarratives: parsed.selfNarratives || [],
          recurringStories: parsed.recurringStories || [],
          identityThemes: parsed.identityThemes || [],
        };
      }
    } catch (error) {
      logger.error('Failed to analyze narratives', { error });
    }

    return null;
  }
}
