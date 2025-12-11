/**
 * Intention Extractor
 *
 * Extracts intentions, plans, and future actions from conversation.
 * Intentions represent what the person wants or plans to do.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext } from '../types';
import { registerExtractor } from '../registry';

class IntentionExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'intention_extractor',
    name: 'Intention Extractor',
    description: 'Extracts intentions, plans, and commitments',
    claim_types: ['intention', 'commitment', 'decision'],
    patterns: [
      // Direct intentions
      { id: 'going_to', type: 'regex', pattern: "(?:I'm|I am|we're|we are)\\s+going\\s+to", weight: 1.0 },
      { id: 'want_to', type: 'regex', pattern: '(?:I|we)\\s+want\\s+to', weight: 0.9 },
      { id: 'plan_to', type: 'regex', pattern: '(?:I|we)\\s+plan\\s+to', weight: 1.0 },
      { id: 'will', type: 'regex', pattern: "(?:I|we)(?:'ll|\\s+will)\\s+", weight: 0.7 },

      // Commitments
      { id: 'promise', type: 'keyword', pattern: 'promise', weight: 1.0 },
      { id: 'commit', type: 'keyword', pattern: 'commit', weight: 1.0 },
      { id: 'swear', type: 'keyword', pattern: 'swear', weight: 0.9 },

      // Decisions
      { id: 'decided', type: 'regex', pattern: "(?:I've|I have|we've|we have)\\s+decided", weight: 1.0 },
      { id: 'going_to_start', type: 'regex', pattern: 'going\\s+to\\s+start', weight: 0.8 },
      { id: 'going_to_stop', type: 'regex', pattern: 'going\\s+to\\s+stop', weight: 0.8 },

      // Future references
      { id: 'tomorrow', type: 'keyword', pattern: 'tomorrow', weight: 0.4 },
      { id: 'next_week', type: 'regex', pattern: 'next\\s+(?:week|month|year)', weight: 0.5 },
      { id: 'soon', type: 'keyword', pattern: 'soon', weight: 0.3 },

      // Tentative plans
      { id: 'might', type: 'regex', pattern: '(?:I|we)\\s+might', weight: 0.5 },
      { id: 'thinking_about', type: 'regex', pattern: 'thinking\\s+(?:about|of)', weight: 0.6 },
      { id: 'considering', type: 'keyword', pattern: 'considering', weight: 0.6 },
    ],
    llm_tier: 'small',
    llm_options: {
      temperature: 0.3,
      max_tokens: 800,
    },
    min_confidence: 0.6,
    priority: 85,
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at extracting intentions, plans, and commitments from conversation.

An INTENTION is a statement about what someone wants or plans to do. Look for:
- Direct intentions ("I'm going to...", "I want to...")
- Plans and scheduled actions ("I plan to...", "Next week I will...")
- Commitments and promises ("I promise...", "I commit to...")
- Decisions made ("I've decided to...", "I'm done with...")

For each intention, determine:
- How certain/committed the person is (confidence)
- When it applies (valid_from/valid_until)
- The stakes involved (how important is this?)

${contextSection}

${inputSection}

${outputInstructions}

For intentions, use these claim_types:
- "intention" for plans and wants
- "commitment" for promises and strong commitments
- "decision" for choices that have been made

Set temporality:
- "point_in_time" for one-time actions
- "fast_decaying" for short-term plans
- "slowly_decaying" for long-term commitments`;
  }
}

// Create and register the extractor
const intentionExtractor = new IntentionExtractor();
registerExtractor(intentionExtractor);

export { intentionExtractor };
