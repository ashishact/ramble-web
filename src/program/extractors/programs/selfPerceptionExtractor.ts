/**
 * Self-Perception Extractor
 *
 * Extracts how the person sees themselves - identity, strengths, weaknesses, roles.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class SelfPerceptionExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_self_perception',
    name: 'Self-Perception Extraction',
    description: 'Extracts how the person sees themselves',
    claim_types: ['self_perception'],
    patterns: [
      // Identity statements
      { id: 'i_am', type: 'keyword', pattern: "I am|I'm a|I'm the kind of|I'm someone who", weight: 0.9 },
      // Strengths/weaknesses
      { id: 'good_at', type: 'keyword', pattern: 'good at|bad at|strength|weakness|talented|struggle with', weight: 0.8 },
      // Tendencies
      { id: 'tendency', type: 'keyword', pattern: 'I tend to|I usually|I always|I never', weight: 0.7 },
      // Self-description
      { id: 'describe', type: 'keyword', pattern: 'describe myself|see myself|consider myself|think of myself', weight: 0.9 },
      // Comparison
      { id: 'compare', type: 'keyword', pattern: 'better than|worse than|like most people|unlike others', weight: 0.6 },
      // Role identity
      { id: 'role', type: 'keyword', pattern: 'as a|my role|my job|my responsibility', weight: 0.6 },
    ],
    llm_provider: 'groq',
    llm_options: { temperature: 0.2, max_tokens: 1500 },
    min_confidence: 0.5,
    priority: 72,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract self-perceptions - how the person sees and describes themselves.

${contextSection}
${inputSection}

For each self-perception:
- statement: What they believe about themselves
- perception_type: "identity"|"strength"|"weakness"|"tendency"|"role"|"comparison"
- valence: positive, negative, or neutral view of self
- confidence: How certain they seem (0-1)

Respond with JSON array:
[
  {
    "statement": "The self-perception",
    "subject": "self",
    "perception_type": "strength",
    "valence": "positive",
    "confidence": 0.8
  }
]

If no self-perceptions found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    const valenceMap: Record<string, number> = {
      'positive': 0.5,
      'neutral': 0,
      'negative': -0.5,
    };

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const valence = obj.valence as string;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || 'self',
          claim_type: 'self_perception',
          temporality: 'slowly_decaying',
          abstraction: 'specific',
          source_type: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotional_valence: valenceMap[valence] || 0,
          emotional_intensity: 0.5,
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

const selfPerceptionExtractor = new SelfPerceptionExtractor();
registerExtractor(selfPerceptionExtractor);
export { selfPerceptionExtractor };
