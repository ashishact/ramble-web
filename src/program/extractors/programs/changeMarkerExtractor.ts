/**
 * Change Marker Extractor
 *
 * Extracts statements about change - things that have changed, are changing,
 * or will change. Captures transitions, transformations, and evolution.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class ChangeMarkerExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_change_marker',
    name: 'Change Marker Extraction',
    description: 'Extracts statements about change and transitions',
    claimTypes: ['change_marker'],
    patterns: [
      // Change language
      { id: 'changed', type: 'keyword', pattern: 'changed|different now|not the same|transformed', weight: 0.9 },
      { id: 'used_to', type: 'keyword', pattern: 'used to|before I|in the past I|no longer', weight: 0.85 },
      // Transition
      { id: 'transition', type: 'keyword', pattern: 'becoming|turning into|starting to|beginning to', weight: 0.8 },
      // Evolution
      { id: 'evolution', type: 'keyword', pattern: 'evolved|grown|developed|progressed|shifted', weight: 0.75 },
      // Contrast
      { id: 'contrast', type: 'keyword', pattern: 'whereas before|unlike before|compared to before|now instead', weight: 0.8 },
      // New vs old
      { id: 'new_old', type: 'keyword', pattern: 'new|old|previous|former|current|now', weight: 0.5 },
    ],
    llmTier: 'small',
    llmOptions: { temperature: 0.2, maxTokens: 1500 },
    minConfidence: 0.5,
    priority: 58,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract change markers - statements about things that have changed, are changing, or will change.

${contextSection}
${inputSection}

For each change:
- statement: What changed
- change_type: "completed"|"ongoing"|"planned"|"wished"
- direction: "positive"|"negative"|"neutral" (is the change good or bad for them?)
- magnitude: "minor"|"moderate"|"major"|"transformative"
- domain: What area of life

Respond with JSON array:
[
  {
    "statement": "The change statement",
    "subject": "What changed",
    "change_type": "completed",
    "direction": "positive",
    "magnitude": "moderate",
    "domain": "career",
    "confidence": 0.8
  }
]

If no change markers found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const directionMap: Record<string, number> = {
          'positive': 0.5,
          'negative': -0.5,
          'neutral': 0,
        };

        const magnitudeMap: Record<string, number> = {
          'minor': 0.2,
          'moderate': 0.5,
          'major': 0.8,
          'transformative': 1.0,
        };

        const temporalityMap: Record<string, 'pointInTime' | 'slowlyDecaying' | 'fastDecaying'> = {
          'completed': 'pointInTime',
          'ongoing': 'fastDecaying',
          'planned': 'fastDecaying',
          'wished': 'slowlyDecaying',
        };

        // Handle both camelCase and snake_case from LLM response
        const changeType = (obj.changeType || obj.change_type) as string;
        const direction = obj.direction as string;
        const magnitude = obj.magnitude as string;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.domain as string) || 'change',
          claimType: 'change_marker',
          temporality: temporalityMap[changeType] || 'pointInTime',
          abstraction: 'specific',
          sourceType: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotionalValence: directionMap[direction] || 0,
          emotionalIntensity: magnitudeMap[magnitude] || 0.5,
          stakes: magnitude === 'transformative' || magnitude === 'major' ? 'high' : 'medium',
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

const changeMarkerExtractor = new ChangeMarkerExtractor();
registerExtractor(changeMarkerExtractor);
export { changeMarkerExtractor };
