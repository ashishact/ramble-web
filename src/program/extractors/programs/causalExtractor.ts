/**
 * Causal Belief Extractor
 *
 * Extracts causal beliefs - statements about what causes what.
 * Captures cause-effect relationships, mechanisms, and causal reasoning.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class CausalExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_causal',
    name: 'Causal Belief Extraction',
    description: 'Extracts causal beliefs about cause-effect relationships',
    claim_types: ['causal'],
    patterns: [
      // Explicit causation
      { id: 'because', type: 'keyword', pattern: 'because|since|therefore|thus|hence', weight: 0.9 },
      { id: 'caused', type: 'keyword', pattern: 'caused|causes|led to|leads to|resulted in|results in', weight: 0.9 },
      { id: 'due_to', type: 'keyword', pattern: 'due to|owing to|thanks to|on account of', weight: 0.8 },
      // Conditional
      { id: 'conditional', type: 'keyword', pattern: 'if.*then|whenever|every time', weight: 0.8 },
      // Mechanisms
      { id: 'mechanism', type: 'keyword', pattern: 'in order to|so that|to achieve', weight: 0.6 },
      // Preventive
      { id: 'prevent', type: 'keyword', pattern: 'prevents|stops|blocks|avoids|protects', weight: 0.7 },
      // Enabling
      { id: 'enable', type: 'keyword', pattern: 'enables|allows|makes possible|helps', weight: 0.6 },
      // Reason-giving
      { id: 'reason', type: 'keyword', pattern: 'the reason|the cause|what makes|what causes', weight: 0.8 },
    ],
    llm_provider: 'groq',
    llm_options: { temperature: 0.2, max_tokens: 1500 },
    min_confidence: 0.5,
    priority: 75,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract causal beliefs - statements about what causes what.

${contextSection}
${inputSection}

For each causal relationship, identify:
- cause: What is believed to cause the effect
- effect: What is the result/outcome
- relationship_type: "causes"|"prevents"|"enables"|"correlates"|"contributes_to"
- confidence: How certain is the speaker (0-1)

Respond with JSON array:
[
  {
    "statement": "Full claim in standalone form",
    "subject": "Main topic",
    "cause": "The cause",
    "effect": "The effect",
    "relationship_type": "causes|prevents|enables|correlates|contributes_to",
    "confidence": 0.8,
    "is_personal": true
  }
]

If no causal beliefs found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement && obj.cause && obj.effect) {
        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.cause as string),
          claim_type: 'causal',
          temporality: 'slowly_decaying',
          abstraction: obj.is_personal ? 'specific' : 'general',
          source_type: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotional_valence: 0,
          emotional_intensity: 0,
          stakes: 'medium',
        });
      }
    }

    return {
      claims,
      entities: [],
      metadata: { model: '', tokens_used: 0, processing_time_ms: 0 },
    };
  }
}

const causalExtractor = new CausalExtractor();
registerExtractor(causalExtractor);
export { causalExtractor };
