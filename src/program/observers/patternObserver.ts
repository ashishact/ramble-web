/**
 * Pattern Observer
 *
 * Detects recurring patterns in claims - themes, topics, or behaviors
 * that appear repeatedly over time.
 */

import type { Claim, CreatePattern } from '../types';
import { BaseObserver } from './baseObserver';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('Observer');

// ============================================================================
// Pattern Observer Implementation
// ============================================================================

interface PatternCandidate {
  patternType: string;
  description: string;
  evidenceClaimIds: string[];
  confidence: number;
}

export class PatternObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'pattern_observer',
    name: 'Pattern Observer',
    description: 'Detects recurring patterns in claims',
    triggers: ['new_claim', 'session_end'],
    priority: 60,
    usesLLM: false, // Rule-based for speed
  };

  // Pattern types we detect
  private static readonly PATTERN_TYPES = {
    TOPIC_RECURRENCE: 'topic_recurrence',
    EMOTIONAL_PATTERN: 'emotional_pattern',
    TEMPORAL_PATTERN: 'temporal_pattern',
    CONCERN_PATTERN: 'concern_pattern',
    GOAL_ALIGNMENT: 'goal_alignment',
  };

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();

    try {
      const recentClaims = context.recentClaims;

      if (recentClaims.length < 3) {
        // Need at least 3 claims to detect patterns
        return this.successResult([], startTime);
      }

      // Detect different pattern types
      const patterns: PatternCandidate[] = [];

      patterns.push(...this.detectTopicRecurrence(recentClaims));
      patterns.push(...this.detectEmotionalPatterns(recentClaims));
      patterns.push(...this.detectConcernPatterns(recentClaims));

      if (patterns.length === 0) {
        return this.successResult([], startTime);
      }

      // Save or reinforce patterns
      const outputs = [];
      const existingPatterns = context.store.observerOutputs.getPatterns();

      for (const candidate of patterns) {
        // Check if pattern already exists
        const existing = existingPatterns.find(
          (p) =>
            p.pattern_type === candidate.patternType &&
            this.isSimilarPattern(p.description, candidate.description)
        );

        if (existing) {
          // Reinforce existing pattern
          context.store.observerOutputs.reinforcePattern(existing.id);
          logger.debug('Reinforced pattern', { patternId: existing.id });
        } else if (candidate.confidence > 0.5) {
          // Create new pattern
          const data: CreatePattern = {
            pattern_type: candidate.patternType,
            description: candidate.description,
            evidence_claims_json: JSON.stringify(candidate.evidenceClaimIds),
            confidence: candidate.confidence,
            occurrence_count: 1,
          };

          context.store.observerOutputs.addPattern(data);

          const output = this.createOutput(
            context,
            'pattern_detected',
            {
              pattern_type: candidate.patternType,
              description: candidate.description,
              confidence: candidate.confidence,
            },
            candidate.evidenceClaimIds
          );

          outputs.push(output);

          logger.info('Detected new pattern', {
            type: candidate.patternType,
            description: candidate.description.slice(0, 50),
          });
        }
      }

      return this.successResult(outputs, startTime);
    } catch (error) {
      return this.errorResult(
        error instanceof Error ? error.message : 'Unknown error',
        startTime
      );
    }
  }

  /**
   * Detect recurring topic patterns
   */
  private detectTopicRecurrence(claims: Claim[]): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];

    // Group claims by subject
    const bySubject = this.groupBy(claims, (c) => c.subject.toLowerCase());

    for (const [subject, subjectClaims] of Object.entries(bySubject)) {
      if (subjectClaims.length >= 3) {
        patterns.push({
          patternType: PatternObserver.PATTERN_TYPES.TOPIC_RECURRENCE,
          description: `Recurring focus on: ${subject}`,
          evidenceClaimIds: subjectClaims.map((c) => c.id),
          confidence: Math.min(0.5 + subjectClaims.length * 0.1, 1),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect emotional patterns
   */
  private detectEmotionalPatterns(claims: Claim[]): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    const emotionClaims = claims.filter((c) => c.claimType === 'emotion');

    if (emotionClaims.length < 2) return patterns;

    // Group by emotion keywords
    const emotionKeywords = ['anxious', 'worried', 'excited', 'frustrated', 'happy', 'sad', 'angry', 'stressed'];

    for (const emotion of emotionKeywords) {
      const matches = emotionClaims.filter((c) =>
        c.statement.toLowerCase().includes(emotion)
      );

      if (matches.length >= 2) {
        patterns.push({
          patternType: PatternObserver.PATTERN_TYPES.EMOTIONAL_PATTERN,
          description: `Recurring ${emotion} emotions`,
          evidenceClaimIds: matches.map((c) => c.id),
          confidence: Math.min(0.4 + matches.length * 0.15, 0.9),
        });
      }
    }

    return patterns;
  }

  /**
   * Detect concern patterns
   */
  private detectConcernPatterns(claims: Claim[]): PatternCandidate[] {
    const patterns: PatternCandidate[] = [];
    const concernClaims = claims.filter((c) => c.claimType === 'concern');

    if (concernClaims.length < 2) return patterns;

    // Look for similar concerns (by keyword overlap)
    const processed = new Set<string>();

    for (const concern of concernClaims) {
      if (processed.has(concern.id)) continue;

      const similar = concernClaims.filter((c) => {
        if (c.id === concern.id) return false;
        return this.hasKeywordOverlap(concern.statement, c.statement);
      });

      if (similar.length >= 1) {
        const allIds = [concern.id, ...similar.map((c) => c.id)];
        allIds.forEach((id) => processed.add(id));

        patterns.push({
          patternType: PatternObserver.PATTERN_TYPES.CONCERN_PATTERN,
          description: `Recurring concern about: ${concern.subject}`,
          evidenceClaimIds: allIds,
          confidence: Math.min(0.5 + similar.length * 0.15, 0.9),
        });
      }
    }

    return patterns;
  }

  /**
   * Check if two strings have significant keyword overlap
   */
  private hasKeywordOverlap(a: string, b: string): boolean {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'i', 'my', 'that', 'about', 'to', 'of']);

    const wordsA = a
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stopWords.has(w));
    const wordsB = new Set(
      b
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w))
    );

    const overlap = wordsA.filter((w) => wordsB.has(w)).length;
    return overlap >= 2;
  }

  /**
   * Check if two pattern descriptions are similar
   */
  private isSimilarPattern(a: string, b: string): boolean {
    return this.hasKeywordOverlap(a, b);
  }

  /**
   * Group items by a key function
   */
  private groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
    const grouped: Record<string, T[]> = {};

    for (const item of items) {
      const key = keyFn(item);
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(item);
    }

    return grouped;
  }
}
