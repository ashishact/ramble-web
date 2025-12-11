/**
 * Habit Extractor
 *
 * Extracts recurring behaviors, routines, and patterns of action.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class HabitExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_habit',
    name: 'Habit Extraction',
    description: 'Extracts recurring behaviors and routines',
    claimTypes: ['habit'],
    patterns: [
      // Frequency
      { id: 'always', type: 'keyword', pattern: 'always|usually|typically|normally|regularly', weight: 0.8 },
      { id: 'every', type: 'keyword', pattern: 'every day|every week|every morning|each time', weight: 0.9 },
      // Routine
      { id: 'routine', type: 'keyword', pattern: 'routine|habit|practice|ritual|pattern', weight: 0.9 },
      // Tendency
      { id: 'tend', type: 'keyword', pattern: 'I tend to|I often|I generally|I commonly', weight: 0.7 },
      // Scheduled
      { id: 'scheduled', type: 'keyword', pattern: 'on mondays|in the morning|after work|before bed', weight: 0.7 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.2, max_tokens: 1200 },
    min_confidence: 0.5,
    priority: 50,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);

    return `Extract habits - recurring behaviors and routines.

${inputSection}

For each habit:
- statement: The habit or routine
- frequency: "daily"|"weekly"|"regularly"|"occasionally"|"situational"
- domain: What area of life (health, work, social, etc.)
- is_positive: Is this a positive habit (true) or something they want to change (false)?

Respond with JSON array:
[
  {
    "statement": "The habit",
    "subject": "What it's about",
    "frequency": "daily",
    "domain": "health",
    "is_positive": true,
    "confidence": 0.8
  }
]

If no habits found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.domain as string) || 'habit',
          claimType: 'habit',
          temporality: 'slowly_decaying',
          abstraction: 'specific',
          source_type: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotional_valence: obj.is_positive ? 0.2 : -0.2,
          emotional_intensity: 0.3,
          stakes: 'low',
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

const habitExtractor = new HabitExtractor();
registerExtractor(habitExtractor);
export { habitExtractor };
