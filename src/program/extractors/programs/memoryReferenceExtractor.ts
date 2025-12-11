/**
 * Memory Reference Extractor
 *
 * Extracts references to past events, experiences, and memories.
 * Captures temporal anchors and how they relate to current context.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class MemoryReferenceExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_memory_reference',
    name: 'Memory Reference Extraction',
    description: 'Extracts references to past events and experiences',
    claimTypes: ['memory_reference'],
    patterns: [
      // Past tense markers
      { id: 'remember', type: 'keyword', pattern: 'I remember|I recall|I think back|reminds me of', weight: 0.95 },
      { id: 'past_time', type: 'keyword', pattern: 'back when|years ago|when I was|used to', weight: 0.85 },
      // Specific time references
      { id: 'specific_time', type: 'keyword', pattern: 'last year|last month|in 2\\d{3}|that time when', weight: 0.8 },
      // Experience references
      { id: 'experience', type: 'keyword', pattern: 'experienced|went through|happened to me|I had', weight: 0.7 },
      // Comparison to past
      { id: 'comparison', type: 'keyword', pattern: 'like before|same as when|different from when|unlike last time', weight: 0.7 },
      // Nostalgia
      { id: 'nostalgia', type: 'keyword', pattern: 'miss|wish I could|those days|back then', weight: 0.6 },
    ],
    llmTier: 'small',
    llmOptions: { temperature: 0.2, maxTokens: 1500 },
    minConfidence: 0.5,
    priority: 60,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract memory references - mentions of past events, experiences, and memories.

${contextSection}
${inputSection}

For each memory reference:
- statement: The memory being referenced
- time_anchor: When it happened (if mentioned)
- emotional_tone: "positive"|"negative"|"neutral"|"mixed"
- vividness: How detailed/vivid is the memory (0-1)
- relevance: Why it's being mentioned now

Respond with JSON array:
[
  {
    "statement": "The memory reference",
    "subject": "What the memory is about",
    "time_anchor": "10 years ago",
    "emotional_tone": "positive",
    "vividness": 0.7,
    "relevance": "Comparing to current situation",
    "confidence": 0.8
  }
]

If no memory references found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    const toneMap: Record<string, number> = {
      'positive': 0.5,
      'negative': -0.5,
      'neutral': 0,
      'mixed': 0.1,
    };

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        // Handle both camelCase and snake_case from LLM response
        const emotionalTone = (obj.emotionalTone || obj.emotional_tone) as string;

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || 'memory',
          claimType: 'memory_reference',
          temporality: 'pointInTime',
          abstraction: 'specific',
          sourceType: 'direct',
          confidence: (obj.confidence as number) || 0.7,
          emotionalValence: toneMap[emotionalTone] || 0,
          emotionalIntensity: (obj.vividness as number) || 0.5,
          stakes: 'low',
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

const memoryReferenceExtractor = new MemoryReferenceExtractor();
registerExtractor(memoryReferenceExtractor);
export { memoryReferenceExtractor };
