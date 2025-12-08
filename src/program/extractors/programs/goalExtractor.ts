/**
 * Goal Extractor
 *
 * Extracts goals, objectives, and aspirations from conversation.
 * Goals are desired future states the person wants to achieve.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext } from '../types';
import { registerExtractor } from '../registry';

class GoalExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'goal_extractor',
    name: 'Goal Extractor',
    description: 'Extracts goals, objectives, and aspirations',
    claim_types: ['goal'],
    patterns: [
      // Goal keywords
      { id: 'goal', type: 'keyword', pattern: 'goal', weight: 1.0 },
      { id: 'objective', type: 'keyword', pattern: 'objective', weight: 1.0 },
      { id: 'target', type: 'keyword', pattern: 'target', weight: 0.8 },
      { id: 'aim', type: 'keyword', pattern: 'aim', weight: 0.8 },

      // Aspiration patterns
      { id: 'want_to_be', type: 'regex', pattern: 'want\\s+to\\s+(?:be|become)', weight: 1.0 },
      { id: 'dream_of', type: 'regex', pattern: 'dream\\s+of', weight: 0.9 },
      { id: 'aspire', type: 'keyword', pattern: 'aspire', weight: 1.0 },
      { id: 'hope_to', type: 'regex', pattern: 'hope\\s+to', weight: 0.8 },
      { id: 'wish', type: 'regex', pattern: '(?:I|we)\\s+wish', weight: 0.7 },

      // Achievement patterns
      { id: 'achieve', type: 'keyword', pattern: 'achieve', weight: 1.0 },
      { id: 'accomplish', type: 'keyword', pattern: 'accomplish', weight: 1.0 },
      { id: 'reach', type: 'regex', pattern: 'reach\\s+(?:my|our|the)', weight: 0.7 },
      { id: 'hit', type: 'regex', pattern: 'hit\\s+(?:my|our|the)', weight: 0.6 },

      // Success patterns
      { id: 'succeed', type: 'keyword', pattern: 'succeed', weight: 0.8 },
      { id: 'success', type: 'keyword', pattern: 'success', weight: 0.7 },
      { id: 'make_it', type: 'regex', pattern: 'make\\s+it\\s+(?:to|in)', weight: 0.6 },

      // Improvement patterns
      { id: 'improve', type: 'keyword', pattern: 'improve', weight: 0.7 },
      { id: 'get_better', type: 'regex', pattern: 'get\\s+better\\s+at', weight: 0.7 },
      { id: 'learn_to', type: 'regex', pattern: 'learn\\s+(?:to|how\\s+to)', weight: 0.6 },

      // Timeframe indicators
      { id: 'by_end', type: 'regex', pattern: 'by\\s+(?:the\\s+)?end\\s+of', weight: 0.5 },
      { id: 'within', type: 'regex', pattern: 'within\\s+(?:\\d+|a|the\\s+next)', weight: 0.5 },
      { id: 'someday', type: 'keyword', pattern: 'someday', weight: 0.4 },
      { id: 'eventually', type: 'keyword', pattern: 'eventually', weight: 0.4 },
    ],
    llm_provider: 'groq',
    llm_options: {
      temperature: 0.3,
      max_tokens: 1000,
    },
    min_confidence: 0.6,
    priority: 90, // High priority - goals are important
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at identifying goals and aspirations in conversation.

A GOAL is a desired future state someone wants to achieve. Look for:
- Explicit goals ("My goal is to...", "I want to achieve...")
- Aspirations and dreams ("I dream of...", "I aspire to...")
- Achievement desires ("I want to succeed at...", "I hope to accomplish...")
- Improvement goals ("I want to get better at...", "I want to learn...")
- Avoidance goals ("I want to stop...", "I need to avoid...")

For each goal, determine:
- What they want to achieve (the statement)
- The timeframe (short-term, medium-term, long-term, life goal)
- How important it is to them (stakes)
- Any implicit blockers or challenges mentioned

${contextSection}

${inputSection}

${outputInstructions}

For goals, consider:
- temporality: "slowly_decaying" for long-term goals, "fast_decaying" for short-term
- stakes: Based on how important this goal seems to the person
- abstraction: "specific" for concrete goals, "general" for life aspirations`;
  }
}

// Create and register the extractor
const goalExtractor = new GoalExtractor();
registerExtractor(goalExtractor);

export { goalExtractor };
