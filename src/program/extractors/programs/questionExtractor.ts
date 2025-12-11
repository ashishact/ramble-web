/**
 * Question/Uncertainty Extractor
 *
 * Extracts questions, uncertainties, and knowledge gaps.
 * Identifies what the person doesn't know or is uncertain about.
 */

import { BaseExtractor, parseSimpleJSONArray } from '../baseExtractor';
import { registerExtractor } from '../registry';
import type {
  ExtractorConfig,
  ExtractorContext,
  ExtractionResult,
  ExtractedClaim,
} from '../types';

class QuestionExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'core_question',
    name: 'Question & Uncertainty Extraction',
    description: 'Extracts questions, uncertainties, and knowledge gaps',
    claimTypes: ['question'],
    patterns: [
      // Direct questions
      { id: 'question_mark', type: 'regex', pattern: /\?$/, weight: 0.9 },
      { id: 'wh_words', type: 'keyword', pattern: 'who|what|where|when|why|how|which', weight: 0.5 },
      // Uncertainty markers
      { id: 'dont_know', type: 'keyword', pattern: "I don't know|I'm not sure|uncertain|I wonder", weight: 0.9 },
      { id: 'maybe', type: 'keyword', pattern: 'maybe|perhaps|possibly|might|could be', weight: 0.6 },
      // Seeking input
      { id: 'should_i', type: 'keyword', pattern: 'should I|what if|would it be|is it better', weight: 0.7 },
      { id: 'seeking', type: 'keyword', pattern: 'any ideas|any thoughts|suggestions|advice', weight: 0.7 },
      // Knowledge gaps
      { id: 'need_to', type: 'keyword', pattern: 'need to find out|need to learn|need to figure out', weight: 0.8 },
    ],
    llmTier: 'small',
    llmOptions: { temperature: 0.2, maxTokens: 1500 },
    minConfidence: 0.5,
    priority: 70,
  };

  buildPrompt(context: ExtractorContext): string {
    const inputSection = this.buildInputSection(context);
    const contextSection = this.buildContextSection(context);

    return `Extract questions, uncertainties, and knowledge gaps.

${contextSection}
${inputSection}

For each uncertainty found, identify:
- statement: The question or uncertainty expressed
- uncertainty_type: "factual_question"|"decision_question"|"existential"|"knowledge_gap"|"ambivalence"
- subject: What the uncertainty is about
- importance: "low"|"medium"|"high"|"critical"

Respond with JSON array:
[
  {
    "statement": "The question or uncertainty",
    "subject": "What it's about",
    "uncertainty_type": "factual_question",
    "importance": "medium",
    "confidence": 0.8
  }
]

If no questions/uncertainties found, respond: []`;
  }

  parseResponse(response: string, _context: ExtractorContext): ExtractionResult {
    const parsed = parseSimpleJSONArray(response);
    const claims: ExtractedClaim[] = [];

    for (const item of parsed) {
      const obj = item as Record<string, unknown>;
      if (obj.statement) {
        // Handle both camelCase and snake_case from LLM response - uncertainty_type is used in prompt
        const importance = (obj.importance as string) || 'medium';
        type Stakes = 'low' | 'medium' | 'high' | 'existential';
        let stakes: Stakes = 'medium';
        if (importance === 'critical') stakes = 'existential';
        else if (importance === 'high') stakes = 'high';
        else if (importance === 'low') stakes = 'low';

        claims.push({
          statement: obj.statement as string,
          subject: (obj.subject as string) || 'unknown',
          claimType: 'question',
          temporality: 'pointInTime',
          abstraction: 'specific',
          sourceType: 'direct',
          confidence: (obj.confidence as number) || 0.8,
          emotionalValence: 0,
          emotionalIntensity: 0.3,
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

const questionExtractor = new QuestionExtractor();
registerExtractor(questionExtractor);
export { questionExtractor };
