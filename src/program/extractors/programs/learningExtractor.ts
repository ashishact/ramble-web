/**
 * Learning Extractor
 *
 * Extracts lessons learned, insights gained, and knowledge acquisition.
 * Captures what the person has learned and how.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class LearningExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_learning',
    name: 'Learning Extraction',
    description: 'Extracts lessons learned and insights gained',
    claim_types: ['learning'],
    patterns: [
      // Learning statements
      { id: 'learned', type: 'keyword', pattern: 'I learned|I realized|I discovered|I found out', weight: 0.95 },
      { id: 'insight', type: 'keyword', pattern: 'insight|revelation|epiphany|understanding', weight: 0.85 },
      // Realization
      { id: 'realize', type: 'keyword', pattern: 'now I know|now I understand|it dawned on me|it hit me', weight: 0.9 },
      // Change in understanding
      { id: 'change', type: 'keyword', pattern: "didn't know|thought that|turns out|actually", weight: 0.7 },
      // Teaching/sharing
      { id: 'teaching', type: 'keyword', pattern: 'taught me|showed me|made me realize|helped me see', weight: 0.8 },
      // Growth
      { id: 'growth', type: 'keyword', pattern: 'grew|developed|improved|got better at', weight: 0.6 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.2, max_tokens: 1500 },
    min_confidence: 0.5,
    priority: 65,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract learnings - lessons, insights, and knowledge gained.

${contextSection}
${inputSection}

For each learning:
- statement: What was learned
- learning_type: "skill"|"insight"|"fact"|"wisdom"|"correction"
- source: How it was learned (experience, taught, reading, etc.)
- significance: How important is this learning (0-1)
- applied: Has it been applied/used?

Respond with JSON array:
[
  {
    "statement": "The learning or insight",
    "subject": "What domain/area",
    "learning_type": "insight",
    "source": "personal experience",
    "significance": 0.8,
    "applied": true,
    "confidence": 0.8
  }
]

If no learnings found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const learningType = obj.learning_type as string;
        const significance = (obj.significance as number) || 0.5;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || 'learning',
          claim_type: 'learning',
          temporality: 'slowly_decaying',
          abstraction: learningType === 'wisdom' ? 'general' : 'specific',
          source_type: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotional_valence: 0.4,
          emotional_intensity: significance,
          stakes: significance > 0.7 ? 'medium' : 'low',
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

const learningExtractor = new LearningExtractor();
registerExtractor(learningExtractor);
export { learningExtractor };
