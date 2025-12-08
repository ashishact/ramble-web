/**
 * Emotion Extractor
 *
 * Extracts emotional states, feelings, and affective content from conversation.
 * Emotions are subjective experiences that color the person's experience.
 */

import { BaseExtractor } from '../baseExtractor';
import type { ExtractorConfig, ExtractorContext, ExtractedClaim } from '../types';
import { registerExtractor } from '../registry';

class EmotionExtractor extends BaseExtractor {
  config: ExtractorConfig = {
    id: 'emotion_extractor',
    name: 'Emotion Extractor',
    description: 'Extracts emotional states and feelings',
    claim_types: ['emotion'],
    patterns: [
      // Direct emotion words
      { id: 'happy', type: 'keyword', pattern: 'happy', weight: 1.0 },
      { id: 'sad', type: 'keyword', pattern: 'sad', weight: 1.0 },
      { id: 'angry', type: 'keyword', pattern: 'angry', weight: 1.0 },
      { id: 'anxious', type: 'keyword', pattern: 'anxious', weight: 1.0 },
      { id: 'excited', type: 'keyword', pattern: 'excited', weight: 1.0 },
      { id: 'frustrated', type: 'keyword', pattern: 'frustrated', weight: 1.0 },
      { id: 'worried', type: 'keyword', pattern: 'worried', weight: 1.0 },
      { id: 'stressed', type: 'keyword', pattern: 'stressed', weight: 1.0 },
      { id: 'overwhelmed', type: 'keyword', pattern: 'overwhelmed', weight: 1.0 },
      { id: 'grateful', type: 'keyword', pattern: 'grateful', weight: 1.0 },
      { id: 'hopeful', type: 'keyword', pattern: 'hopeful', weight: 1.0 },
      { id: 'disappointed', type: 'keyword', pattern: 'disappointed', weight: 1.0 },

      // Feeling expressions
      { id: 'feel', type: 'regex', pattern: '(?:I|we)\\s+feel\\s+(?!like|that)', weight: 1.0 },
      { id: 'feeling', type: 'regex', pattern: "(?:I'm|I am)\\s+feeling", weight: 1.0 },
      { id: 'makes_me_feel', type: 'regex', pattern: 'makes?\\s+me\\s+feel', weight: 0.9 },

      // Intensity modifiers
      { id: 'so', type: 'regex', pattern: '(?:so|really|very)\\s+(?:happy|sad|angry|anxious)', weight: 1.2 },
      { id: 'little', type: 'regex', pattern: '(?:a\\s+little|slightly|somewhat)\\s+(?:happy|sad|angry)', weight: 0.7 },

      // Complex emotions
      { id: 'mixed', type: 'regex', pattern: 'mixed\\s+(?:feelings|emotions)', weight: 0.8 },
      { id: 'conflicted', type: 'keyword', pattern: 'conflicted', weight: 0.8 },
      { id: 'torn', type: 'keyword', pattern: 'torn', weight: 0.7 },
    ],
    llm_provider: 'groq',
    llm_options: {
      temperature: 0.4,
      max_tokens: 800,
    },
    min_confidence: 0.5,
    priority: 75,
    always_run: true, // Emotions are important to catch even without explicit keywords
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at detecting emotional content in conversation.

Extract EMOTIONS - subjective feeling states expressed or implied. Look for:
- Direct emotion statements ("I feel happy", "I'm so frustrated")
- Implied emotions from context and tone
- Reactions to events or situations
- Emotional intensity and valence

For each emotion claim:
- emotional_valence: -1 (negative) to 1 (positive)
- emotional_intensity: 0 (mild) to 1 (intense)
- temporality: "point_in_time" for momentary feelings, "fast_decaying" for moods

${contextSection}

${inputSection}

${outputInstructions}

Focus on:
- What emotion is being expressed?
- What triggered it (subject)?
- How intense is it?
- Is it positive, negative, or mixed?`;
  }

  postProcess(claims: ExtractedClaim[], _context: ExtractorContext): ExtractedClaim[] {
    // Ensure all emotion claims have appropriate valence/intensity
    return claims.map((claim) => {
      // Infer valence from common emotion words if not set
      const statement = claim.statement.toLowerCase();

      let valence = claim.emotional_valence;
      let intensity = claim.emotional_intensity;

      // Positive emotions
      if (/happy|excited|grateful|hopeful|joy|love|pleased/.test(statement)) {
        valence = Math.max(valence, 0.5);
      }
      // Negative emotions
      if (/sad|angry|frustrated|worried|anxious|stressed|disappointed|overwhelmed/.test(statement)) {
        valence = Math.min(valence, -0.5);
      }
      // High intensity markers
      if (/very|so|extremely|incredibly|really/.test(statement)) {
        intensity = Math.min(intensity + 0.3, 1.0);
      }
      // Low intensity markers
      if (/little|slightly|somewhat|bit/.test(statement)) {
        intensity = Math.max(intensity - 0.2, 0.2);
      }

      return {
        ...claim,
        emotional_valence: valence,
        emotional_intensity: intensity,
        temporality: 'point_in_time' as const,
      };
    });
  }
}

// Create and register the extractor
const emotionExtractor = new EmotionExtractor();
registerExtractor(emotionExtractor);

export { emotionExtractor };
