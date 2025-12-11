/**
 * Preference Extractor
 *
 * Extracts likes, dislikes, and preferences.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class PreferenceExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_preference',
    name: 'Preference Extraction',
    description: 'Extracts likes, dislikes, and preferences',
    claim_types: ['preference'],
    patterns: [
      // Likes
      { id: 'like', type: 'keyword', pattern: 'I like|I love|I enjoy|I prefer|I favor', weight: 0.9 },
      // Dislikes
      { id: 'dislike', type: 'keyword', pattern: "I don't like|I hate|I dislike|I can't stand|I avoid", weight: 0.9 },
      // Preferences
      { id: 'prefer', type: 'keyword', pattern: 'prefer|rather|favorite|best|worst', weight: 0.8 },
      // Comparative
      { id: 'compare', type: 'keyword', pattern: 'better than|worse than|more than|less than', weight: 0.6 },
      // Taste
      { id: 'taste', type: 'keyword', pattern: 'my taste|my style|my type|my kind of', weight: 0.7 },
    ],
    llm_tier: 'small',
    llm_options: { temperature: 0.2, max_tokens: 1200 },
    min_confidence: 0.5,
    priority: 55,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);

    return `Extract preferences - likes, dislikes, and personal tastes.

${inputSection}

For each preference:
- statement: The preference expressed
- preference_type: "like"|"dislike"|"prefer_over"|"neutral"
- strength: "mild"|"moderate"|"strong"
- domain: What area (food, music, work, etc.)

Respond with JSON array:
[
  {
    "statement": "The preference",
    "subject": "What it's about",
    "preference_type": "like",
    "strength": "strong",
    "domain": "food",
    "confidence": 0.8
  }
]

If no preferences found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    const valenceMap: Record<string, number> = {
      'like': 0.6,
      'dislike': -0.6,
      'prefer_over': 0.3,
      'neutral': 0,
    };

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        const preferenceType = obj.preference_type as string;
        const strength = obj.strength as string;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || (obj.domain as string) || 'preference',
          claim_type: 'preference',
          temporality: 'slowly_decaying',
          abstraction: 'specific',
          source_type: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotional_valence: valenceMap[preferenceType] || 0,
          emotional_intensity: strength === 'strong' ? 0.8 : strength === 'mild' ? 0.3 : 0.5,
          stakes: 'low',
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

const preferenceExtractor = new PreferenceExtractor();
registerExtractor(preferenceExtractor);
export { preferenceExtractor };
