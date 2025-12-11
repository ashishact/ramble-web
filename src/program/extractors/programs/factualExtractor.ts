/**
 * Factual Extractor
 *
 * Extracts factual claims about the world from conversation.
 * Facts are objective, verifiable statements.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext } from '../types';
import { registerExtractor } from '../registry';

class FactualExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'factual_extractor',
    name: 'Factual Extractor',
    description: 'Extracts factual claims and information',
    claim_types: ['factual'],
    patterns: [
      // Definite statements
      { id: 'is_a', type: 'regex', pattern: '\\b(?:is|are|was|were)\\s+(?:a|an|the)\\b', weight: 0.4 },
      { id: 'has_have', type: 'regex', pattern: '\\b(?:has|have|had)\\s+(?:a|an|the|\\d)', weight: 0.4 },

      // Quantities and measurements
      { id: 'numbers', type: 'regex', pattern: '\\b\\d+(?:\\.\\d+)?\\s*(?:%|percent|dollars?|years?|months?|days?|hours?|minutes?)', weight: 0.7 },
      { id: 'costs', type: 'regex', pattern: '\\$\\d+(?:,\\d{3})*(?:\\.\\d{2})?', weight: 0.8 },

      // Location/time facts
      { id: 'located', type: 'regex', pattern: '(?:located|based|situated)\\s+(?:in|at|on)', weight: 0.7 },
      { id: 'happened', type: 'regex', pattern: '(?:happened|occurred|took\\s+place)\\s+(?:in|on|at)', weight: 0.7 },

      // Professional/biographical facts
      { id: 'works_at', type: 'regex', pattern: '(?:work|works|worked)\\s+(?:at|for|with)', weight: 0.6 },
      { id: 'studied', type: 'regex', pattern: '(?:studied|graduated|majored)\\s+(?:at|in|from)', weight: 0.6 },
      { id: 'lives_in', type: 'regex', pattern: '(?:live|lives|lived)\\s+(?:in|at|on)', weight: 0.6 },

      // Relationship facts
      { id: 'is_my', type: 'regex', pattern: '\\bis\\s+my\\s+(?:wife|husband|friend|boss|colleague|brother|sister|mother|father)', weight: 0.8 },
      { id: 'married', type: 'regex', pattern: '(?:married|engaged|dating|divorced)', weight: 0.6 },

      // Existence statements
      { id: 'there_is', type: 'regex', pattern: '\\bthere\\s+(?:is|are|was|were)\\b', weight: 0.3 },
    ],
    llm_tier: 'small',
    llm_options: {
      temperature: 0.2,
      max_tokens: 800,
    },
    min_confidence: 0.7, // Higher threshold for facts
    priority: 70,
    always_run: true, // Facts are fundamental
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at extracting factual information from conversation.

FACTUAL claims are objective statements that could be verified. Look for:
- Biographical information (where someone lives, works, studied)
- Relationship information (who they know, family members)
- Quantitative data (numbers, dates, measurements)
- Historical facts (events that happened)
- Current state facts (what exists, where things are)

DO NOT extract:
- Opinions or beliefs (those go to belief_extractor)
- Future plans (those go to intention_extractor)
- Goals or desires (those go to goal_extractor)

For each fact:
- Be conservative with confidence - only high confidence for clear facts
- Set temporality appropriately (eternal for permanent facts, decaying for changeable ones)
- Identify the subject clearly

${contextSection}

${inputSection}

${outputInstructions}

For facts:
- temporality: "eternal" for unchanging facts, "slowly_decaying" for things that might change
- source_type: "direct" if explicitly stated, "inferred" if derived from context
- stakes: Usually "low" unless the fact is particularly significant`;
  }
}

// Create and register the extractor
const factualExtractor = new FactualExtractor();
registerExtractor(factualExtractor);

export { factualExtractor };
