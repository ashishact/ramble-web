/**
 * Concern Extractor
 *
 * Extracts worries, fears, and concerns from conversation.
 * Concerns represent potential problems the person is aware of.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext } from '../types';
import { registerExtractor } from '../registry';

class ConcernExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'concern_extractor',
    name: 'Concern Extractor',
    description: 'Extracts worries, fears, and concerns',
    claimTypes: ['concern'],
    patterns: [
      // Direct concern expressions
      { id: 'worried', type: 'keyword', pattern: 'worried', weight: 1.0 },
      { id: 'concerned', type: 'keyword', pattern: 'concerned', weight: 1.0 },
      { id: 'afraid', type: 'keyword', pattern: 'afraid', weight: 1.0 },
      { id: 'scared', type: 'keyword', pattern: 'scared', weight: 1.0 },
      { id: 'nervous', type: 'keyword', pattern: 'nervous', weight: 0.8 },
      { id: 'anxious', type: 'keyword', pattern: 'anxious', weight: 0.9 },

      // Fear expressions
      { id: 'fear_that', type: 'regex', pattern: 'fear\\s+(?:that|of)', weight: 1.0 },
      { id: 'what_if', type: 'regex', pattern: 'what\\s+if', weight: 0.8 },
      { id: 'might_not', type: 'regex', pattern: 'might\\s+not', weight: 0.5 },

      // Problem indicators
      { id: 'problem', type: 'keyword', pattern: 'problem', weight: 0.7 },
      { id: 'issue', type: 'keyword', pattern: 'issue', weight: 0.6 },
      { id: 'trouble', type: 'keyword', pattern: 'trouble', weight: 0.7 },
      { id: 'struggling', type: 'keyword', pattern: 'struggling', weight: 0.8 },

      // Uncertainty about outcomes
      { id: 'not_sure', type: 'regex', pattern: "(?:not|n't)\\s+sure\\s+(?:if|about|whether)", weight: 0.6 },
      { id: 'dont_know', type: 'regex', pattern: "(?:don't|do not)\\s+know\\s+(?:if|how|whether)", weight: 0.5 },

      // Risk language
      { id: 'risk', type: 'keyword', pattern: 'risk', weight: 0.8 },
      { id: 'danger', type: 'keyword', pattern: 'danger', weight: 0.9 },
      { id: 'threat', type: 'keyword', pattern: 'threat', weight: 0.8 },

      // Negative outcomes
      { id: 'fail', type: 'regex', pattern: '(?:might|could|will)\\s+fail', weight: 0.8 },
      { id: 'lose', type: 'regex', pattern: '(?:might|could|will)\\s+lose', weight: 0.8 },
      { id: 'miss', type: 'regex', pattern: '(?:might|could|will)\\s+miss', weight: 0.7 },
    ],
    llm_tier: 'small',
    llm_options: {
      temperature: 0.3,
      max_tokens: 800,
    },
    min_confidence: 0.5,
    priority: 85, // High priority - concerns need attention
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at identifying concerns and worries in conversation.

A CONCERN is something that worries or troubles someone. Look for:
- Explicit worries ("I'm worried about...", "I'm concerned that...")
- Fears and anxieties ("I'm afraid that...", "What if...?")
- Problems being faced ("I'm struggling with...", "The issue is...")
- Uncertainties about outcomes ("I'm not sure if...", "I don't know whether...")
- Anticipated negative consequences

For each concern:
- What is the source of worry (subject)?
- How serious does it seem (stakes)?
- How likely do they think it is (confidence)?
- Is it about something immediate or long-term (temporality)?

${contextSection}

${inputSection}

${outputInstructions}

For concerns:
- emotional_valence: Usually negative (-0.3 to -1.0)
- emotional_intensity: Based on how worried they seem
- stakes: How serious the potential problem is
- temporality: "fast_decaying" for immediate concerns, "slowly_decaying" for ongoing worries`;
  }
}

// Create and register the extractor
const concernExtractor = new ConcernExtractor();
registerExtractor(concernExtractor);

export { concernExtractor };
