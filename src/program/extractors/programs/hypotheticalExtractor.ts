/**
 * Hypothetical Extractor
 *
 * Extracts hypothetical scenarios, counterfactuals, and "what if" thinking.
 * Captures imagined possibilities and alternative realities.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class HypotheticalExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_hypothetical',
    name: 'Hypothetical Extraction',
    description: 'Extracts hypothetical scenarios and counterfactuals',
    claimTypes: ['hypothetical'],
    patterns: [
      // Conditional
      { id: 'if_then', type: 'keyword', pattern: 'if I|if we|if they|what if|suppose', weight: 0.9 },
      // Counterfactual
      { id: 'counterfactual', type: 'keyword', pattern: 'if I had|if only|wish I had|should have', weight: 0.85 },
      // Hypothetical
      { id: 'hypothetical', type: 'keyword', pattern: 'imagine|hypothetically|theoretically|in theory', weight: 0.8 },
      // Could/would/might
      { id: 'modal', type: 'keyword', pattern: 'could be|would be|might be|could have', weight: 0.7 },
      // Scenarios
      { id: 'scenario', type: 'keyword', pattern: 'scenario|possibility|alternative|option', weight: 0.6 },
      // Future conditional
      { id: 'future_if', type: 'keyword', pattern: 'if this happens|when this happens|in case', weight: 0.7 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.2, max_tokens: 1500 },
    min_confidence: 0.5,
    priority: 45,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract hypotheticals - "what if" scenarios, counterfactuals, and imagined possibilities.

${contextSection}
${inputSection}

For each hypothetical:
- statement: The hypothetical scenario
- hypothetical_type: "future_possibility"|"counterfactual"|"thought_experiment"|"wish"|"fear"
- likelihood: How likely do they think this is (0-1, or null if counterfactual)
- emotional_charge: What emotion does this hypothetical carry

Respond with JSON array:
[
  {
    "statement": "The hypothetical scenario",
    "subject": "What it's about",
    "hypothetical_type": "future_possibility",
    "likelihood": 0.3,
    "emotional_charge": "hope",
    "confidence": 0.8
  }
]

If no hypotheticals found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    const emotionValence: Record<string, number> = {
      'hope': 0.6,
      'fear': -0.6,
      'regret': -0.5,
      'curiosity': 0.2,
      'anxiety': -0.4,
      'excitement': 0.5,
      'dread': -0.7,
      'longing': 0.1,
    };

    const typeValence: Record<string, number> = {
      'future_possibility': 0.2,
      'counterfactual': -0.2,
      'thought_experiment': 0,
      'wish': 0.3,
      'fear': -0.5,
    };

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const hypotheticalType = obj.hypothetical_type as string;
        const emotionalCharge = obj.emotionalCharge as string;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || 'hypothetical',
          claimType: 'hypothetical',
          temporality: hypotheticalType === 'counterfactual' ? 'point_in_time' : 'fast_decaying',
          abstraction: 'specific',
          source_type: 'direct',
          confidence: (obj.confidence as number) || 0.6,
          emotional_valence: emotionValence[emotionalCharge] ?? typeValence[hypotheticalType] ?? 0,
          emotional_intensity: 0.5,
          stakes: hypotheticalType === 'fear' ? 'high' : 'medium',
        });
      }
    }

    return {
      claims,
      entities: [],
      metadata: { model: '', tokensUsed: 0, processing_time_ms: 0 },
    };
  }
}

const hypotheticalExtractor = new HypotheticalExtractor();
registerExtractor(hypotheticalExtractor);
export { hypotheticalExtractor };
