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
    claimTypes: ['emotion'],
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
    llmTier: 'small',
    llmOptions: {
      temperature: 0.4,
      maxTokens: 800,
    },
    minConfidence: 0.5,
    priority: 75,
    alwaysRun: true, // Emotions are important to catch even without explicit keywords
  };

  buildPrompt(context: ExtractorContext): string {
    const contextSection = this.buildContextSection(context);
    const inputSection = this.buildInputSection(context);
    const outputInstructions = this.buildOutputInstructions();

    return `You are an expert at detecting emotional content in conversation.

Extract EMOTIONS - subjective feeling states. Look for:
- Direct emotion statements ("I feel happy", "I'm so frustrated")
- Named emotions or feeling words
- Reactions to events with explicit emotional language

IMPORTANT - sourceType Rules:
- Use "direct" ONLY for emotions EXPLICITLY named or stated
- Use "inferred" for emotions implied by context or tone

DO NOT extract:
- Emotions you assume from context without explicit emotional language
- Emotions attributed to the speaker based on situation alone
- Feelings the speaker didn't actually express

For each emotion claim:
- emotionalValence: -1 (negative) to 1 (positive)
- emotionalIntensity: 0 (mild) to 1 (intense)
- temporality: "pointInTime" for momentary feelings, "fastDecaying" for moods

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

      let valence = claim.emotionalValence;
      let intensity = claim.emotionalIntensity;

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
        emotionalValence: valence,
        emotionalIntensity: intensity,
        temporality: 'pointInTime' as const,
      };
    });
  }
}

// Create and register the extractor
const emotionExtractor = new EmotionExtractor();
registerExtractor(emotionExtractor);

export { emotionExtractor };
