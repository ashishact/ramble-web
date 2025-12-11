/**
 * Commitment Extractor
 *
 * Extracts commitments, promises, and obligations.
 * Captures what the person has committed to doing.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class CommitmentExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_commitment',
    name: 'Commitment Extraction',
    description: 'Extracts commitments, promises, and obligations',
    claim_types: ['commitment'],
    patterns: [
      // Promises
      { id: 'promise', type: 'keyword', pattern: 'I promise|I commit|I pledge|I vow', weight: 0.95 },
      // Will statements
      { id: 'will', type: 'keyword', pattern: "I will|I'm going to|I'll definitely|I shall", weight: 0.85 },
      // Obligations
      { id: 'obligation', type: 'keyword', pattern: 'I have to|I must|I need to|obligated to', weight: 0.8 },
      // Agreements
      { id: 'agree', type: 'keyword', pattern: 'I agreed|I said I would|I told them|I assured', weight: 0.85 },
      // Deadlines
      { id: 'deadline', type: 'keyword', pattern: 'by tomorrow|by next|deadline|due date', weight: 0.7 },
      // Accountability
      { id: 'accountability', type: 'keyword', pattern: "I'm responsible|counting on me|depending on me|my word", weight: 0.8 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.2, max_tokens: 1500 },
    min_confidence: 0.6,
    priority: 75,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract commitments - promises, pledges, and obligations.

${contextSection}
${inputSection}

For each commitment:
- statement: The commitment made
- commitment_type: "promise"|"agreement"|"obligation"|"self_commitment"|"deadline"
- to_whom: Who is the commitment to (self, specific person, organization, etc.)
- timeframe: When is it due (if mentioned)
- strength: "weak"|"moderate"|"strong"|"binding"

Respond with JSON array:
[
  {
    "statement": "The commitment",
    "subject": "What it's about",
    "commitment_type": "promise",
    "to_whom": "specific person",
    "timeframe": "by Friday",
    "strength": "strong",
    "confidence": 0.8
  }
]

If no commitments found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    const strengthMap: Record<string, number> = {
      'weak': 0.3,
      'moderate': 0.5,
      'strong': 0.8,
      'binding': 0.95,
    };

    const stakesMap: Record<string, 'low' | 'medium' | 'high' | 'existential'> = {
      'weak': 'low',
      'moderate': 'medium',
      'strong': 'high',
      'binding': 'existential',
    };

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const strength = obj.strength as string;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || 'commitment',
          claim_type: 'commitment',
          temporality: 'slowly_decaying',
          abstraction: 'specific',
          source_type: 'direct',
          confidence: strengthMap[strength] || 0.7,
          emotional_valence: 0.1,
          emotional_intensity: strengthMap[strength] || 0.5,
          stakes: stakesMap[strength] || 'medium',
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

const commitmentExtractor = new CommitmentExtractor();
registerExtractor(commitmentExtractor);
export { commitmentExtractor };
