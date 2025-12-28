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
    claimTypes: ['decision'],
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
    llmTier: 'small',
    llmOptions: { temperature: 0.2, maxTokens: 1500 },
    minConfidence: 0.6,
    priority: 68,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract decisions - choices that have been made or are being made.

IMPORTANT - Only extract decisions EXPLICITLY stated by the speaker.
DO NOT extract:
- Implied decisions from behavior
- Decisions you assume were made
- Choices not explicitly stated

${contextSection}
${inputSection}

For each decision:
- decision: What was decided
- alternativesRejected: What was not chosen (if mentioned)
- reasoning: Why this was chosen
- confidenceLevel: "tentative"|"moderate"|"confident"|"certain"
- stakes: "low"|"medium"|"high"|"critical"
- sourceType: "direct" if explicitly stated, "inferred" if implied

Respond with JSON array:
[
  {
    "statement": "Full decision statement",
    "subject": "What decision is about",
    "decision": "What was decided",
    "alternativesRejected": ["option1", "option2"],
    "reasoning": "Why",
    "confidenceLevel": "confident",
    "stakes": "medium",
    "sourceType": "direct"
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

        // Handle both camelCase and snake_case from LLM response
        const confidenceLevel = (obj.confidenceLevel || obj.confidence_level) as string;
        const rawStakes = obj.stakes as string;
        const rawSourceType = (obj.sourceType || obj.source_type) as string;
        const sourceType = (rawSourceType === 'inferred' || rawSourceType === 'corrected')
          ? rawSourceType
          : 'direct';

        let stakes: Stakes = 'medium';
        if (validStakes.includes(rawStakes as Stakes)) {
          stakes = rawStakes as Stakes;
        } else if (rawStakes === 'critical') {
          stakes = 'existential';
        }

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.decision as string),
          claimType: 'decision',
          temporality: 'pointInTime',
          abstraction: 'specific',
          sourceType: sourceType as 'direct' | 'inferred' | 'corrected',
          confidence: confidenceMap[confidenceLevel] || 0.7,
          emotionalValence: 0.2,
          emotionalIntensity: 0.4,
          stakes,
        });
      }
    }

    return {
      claims,
      entities: [],
      metadata: { model: '', tokensUsed: 0, processingTimeMs: 0 },
    };
  }
}

const decisionExtractor = new DecisionExtractor();
registerExtractor(decisionExtractor);
export { decisionExtractor };
