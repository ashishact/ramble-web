/**
 * Value Extractor
 *
 * Extracts core values and principles - what matters most to the person.
 * Captures beliefs about what's important, right, and meaningful.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class ValueExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_value',
    name: 'Value & Principle Extraction',
    description: 'Extracts core values, principles, and what matters most',
    claimTypes: ['value'],
    patterns: [
      // Importance
      { id: 'important', type: 'keyword', pattern: 'important to me|matters to me|care about|value', weight: 0.9 },
      // Belief in rightness
      { id: 'should', type: 'keyword', pattern: 'should|ought to|right thing|wrong thing|must', weight: 0.7 },
      // Priority
      { id: 'priority', type: 'keyword', pattern: 'priority|comes first|above all|most of all', weight: 0.8 },
      // Core identity
      { id: 'core', type: 'keyword', pattern: "that's who I am|defines me|core to me|fundamental", weight: 0.9 },
      // Principles
      { id: 'principle', type: 'keyword', pattern: 'principle|rule|standard|code|ethic', weight: 0.7 },
      // Non-negotiable
      { id: 'non_neg', type: 'keyword', pattern: 'non-negotiable|always|never compromise', weight: 0.85 },
    ],
    llmTier: 'small',
    llmOptions: { temperature: 0.2, maxTokens: 1500 },
    minConfidence: 0.6,
    priority: 85,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract core values and principles - what matters most to this person.

${contextSection}
${inputSection}

For each value/principle:
- statement: The value expressed
- domain: "work"|"relationships"|"health"|"personal_growth"|"family"|"ethics"|"other"
- importance: How central is this value (0-1)
- is_explicit: Was it directly stated or inferred?

Respond with JSON array:
[
  {
    "statement": "The value or principle",
    "subject": "What domain/area",
    "domain": "work",
    "importance": 0.9,
    "is_explicit": true,
    "confidence": 0.8
  }
]

If no values found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const importance = (obj.importance as number) || 0.7;
        // Handle both camelCase and snake_case from LLM response
        const isExplicit = obj.isExplicit ?? obj.is_explicit;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.domain as string) || 'values',
          claimType: 'value',
          temporality: 'slowlyDecaying',
          abstraction: 'general',
          sourceType: isExplicit ? 'direct' : 'inferred',
          confidence: (obj.confidence as number) || 0.7,
          emotionalValence: 0.3,
          emotionalIntensity: importance,
          stakes: importance > 0.8 ? 'high' : 'medium',
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

const valueExtractor = new ValueExtractor();
registerExtractor(valueExtractor);
export { valueExtractor };
