/**
 * Decision Extractor
 *
 * Extracts decisions - choices that have been made or are being made.
 * Captures what was chosen, alternatives rejected, and reasoning.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

type Stakes = 'low' | 'medium' | 'high' | 'existential';

class DecisionExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_decision',
    name: 'Decision Extraction',
    description: 'Extracts decisions and choices made',
    claim_types: ['decision'],
    patterns: [
      // Made decisions
      { id: 'decided', type: 'keyword', pattern: "I decided|I've decided|decision is|my decision", weight: 0.95 },
      { id: 'chose', type: 'keyword', pattern: 'chose|picked|selected|went with|opted for', weight: 0.85 },
      // Final language
      { id: 'final', type: 'keyword', pattern: "that's final|made up my mind|settled on|going with", weight: 0.9 },
      // Comparative
      { id: 'comparative', type: 'keyword', pattern: 'instead of|rather than|over|versus', weight: 0.7 },
      // Resolution
      { id: 'resolved', type: 'keyword', pattern: 'figured out|resolved|concluded|determined', weight: 0.7 },
      // Rejection
      { id: 'rejection', type: 'keyword', pattern: "not going to|won't|rejected|ruled out|dismissed", weight: 0.7 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.2, max_tokens: 1500 },
    min_confidence: 0.6,
    priority: 68,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract decisions - choices that have been made or are being made.

${contextSection}
${inputSection}

For each decision:
- decision: What was decided
- alternatives_rejected: What was not chosen (if mentioned)
- reasoning: Why this was chosen
- confidence_level: "tentative"|"moderate"|"confident"|"certain"
- stakes: "low"|"medium"|"high"|"critical"

Respond with JSON array:
[
  {
    "statement": "Full decision statement",
    "subject": "What decision is about",
    "decision": "What was decided",
    "alternatives_rejected": ["option1", "option2"],
    "reasoning": "Why",
    "confidence_level": "confident",
    "stakes": "medium"
  }
]

If no decisions found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    const validStakes: Stakes[] = ['low', 'medium', 'high', 'existential'];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement && obj.decision) {
        const confidenceMap: Record<string, number> = {
          'tentative': 0.4,
          'moderate': 0.6,
          'confident': 0.8,
          'certain': 0.95,
        };

        const confidenceLevel = obj.confidence_level as string;
        const rawStakes = obj.stakes as string;
        let stakes: Stakes = 'medium';
        if (validStakes.includes(rawStakes as Stakes)) {
          stakes = rawStakes as Stakes;
        } else if (rawStakes === 'critical') {
          stakes = 'existential';
        }

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.decision as string),
          claim_type: 'decision',
          temporality: 'point_in_time',
          abstraction: 'specific',
          source_type: 'direct',
          confidence: confidenceMap[confidenceLevel] || 0.7,
          emotional_valence: 0.2,
          emotional_intensity: 0.4,
          stakes,
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

const decisionExtractor = new DecisionExtractor();
registerExtractor(decisionExtractor);
export { decisionExtractor };
