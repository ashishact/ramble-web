/**
 * Belief Extractor
 *
 * Extracts beliefs, opinions, and worldview statements from conversation.
 * Beliefs are subjective claims about how the world works or should work.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext } from '../types';
import { registerExtractor } from '../registry';

class BeliefExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'belief_extractor',
    name: 'Belief Extractor',
    description: 'Extracts beliefs, opinions, and worldview statements',
    claim_types: ['belief', 'value', 'assessment'],
    patterns: [
      // Opinion indicators
      { id: 'think', type: 'keyword', pattern: 'think', weight: 0.8 },
      { id: 'believe', type: 'keyword', pattern: 'believe', weight: 1.0 },
      { id: 'feel_that', type: 'regex', pattern: 'feel(?:s)?\\s+(?:like|that)', weight: 0.9 },
      { id: 'opinion', type: 'keyword', pattern: 'opinion', weight: 1.0 },
      { id: 'seem', type: 'regex', pattern: '(?:it\\s+)?seems?\\s+(?:like|to)', weight: 0.6 },

      // Value statements
      { id: 'important', type: 'keyword', pattern: 'important', weight: 0.7 },
      { id: 'should', type: 'keyword', pattern: 'should', weight: 0.6 },
      { id: 'ought', type: 'keyword', pattern: 'ought', weight: 0.7 },
      { id: 'right_wrong', type: 'regex', pattern: '(?:is|are)\\s+(?:right|wrong)', weight: 0.8 },

      // Certainty expressions
      { id: 'definitely', type: 'keyword', pattern: 'definitely', weight: 0.5 },
      { id: 'probably', type: 'keyword', pattern: 'probably', weight: 0.5 },
      { id: 'maybe', type: 'keyword', pattern: 'maybe', weight: 0.4 },

      // Worldview indicators
      { id: 'always', type: 'regex', pattern: '(?:people|things|it)\\s+always', weight: 0.7 },
      { id: 'never', type: 'regex', pattern: '(?:people|things|it)\\s+never', weight: 0.7 },
    ],
    llm_provider: 'groq',
    llm_options: {
      temperature: 0.3,
      max_tokens: 800,
    },
    min_confidence: 0.6,
    priority: 80,
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at extracting beliefs, opinions, and values from conversation.

A BELIEF is a subjective claim about how things are or should be. Look for:
- Opinions and personal views ("I think...", "I believe...")
- Value judgments ("X is important", "Y is wrong")
- Worldview statements ("People always...", "The world is...")
- Assessments of situations ("This seems like...", "That appears to be...")

Extract beliefs that are:
- Personally held by the speaker
- About how the world works or should work
- Distinct from factual claims (which are verifiable)

${contextSection}

${inputSection}

${outputInstructions}

For beliefs, use these claim_types:
- "belief" for general opinions and views
- "value" for statements about what is important or right
- "assessment" for evaluative judgments of situations`;
  }
}

// Create and register the extractor
const beliefExtractor = new BeliefExtractor();
registerExtractor(beliefExtractor);

export { beliefExtractor };
