/**
 * Consolidated Pattern Definitions
 *
 * All patterns used for span detection in the primitive extraction pipeline.
 * These patterns are used by patternMatcher.ts to identify relevant text spans
 * before sending to primitiveExtractor.ts for unified LLM extraction.
 *
 * Previously these were scattered across 20 separate extractor files.
 * The LLM extraction logic from those files is now dead - only the patterns remain.
 */

import type { PatternDef } from './types';
import type { ClaimType } from '../types';
import type { LLMTier } from '../types/llmTiers';

// ============================================================================
// Pattern Config - Minimal extractor config for pattern matching only
// ============================================================================

export interface PatternConfig {
  id: string;
  name: string;
  description: string;
  claimTypes: ClaimType[];
  patterns: PatternDef[];
  priority: number;
  alwaysRun?: boolean;
  /** For compatibility with ExtractorConfig */
  llmTier: LLMTier;
  minConfidence: number;
}

// ============================================================================
// Belief Patterns
// ============================================================================

export const beliefPatterns: PatternConfig = {
  id: 'belief_extractor',
  name: 'Belief Extractor',
  description: 'Extracts beliefs, opinions, and worldview statements',
  claimTypes: ['belief', 'value', 'assessment'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 80,
  patterns: [
    // Opinion indicators
    { id: 'think', type: 'keyword', pattern: 'think', weight: 0.8 },
    { id: 'believe', type: 'keyword', pattern: 'believe', weight: 1.0 },
    { id: 'feel_that', type: 'regex', pattern: 'feel(?:s)?\\s+(?:like|that)', weight: 0.9 },
    { id: 'opinion', type: 'keyword', pattern: 'opinion', weight: 1.0 },
    { id: 'seem', type: 'regex', pattern: '(?:it\\s+)?seems?\\s+(?:like|to)', weight: 0.6 },
    // Value statements
    { id: 'important', type: 'keyword', pattern: 'important', weight: 0.7 },
    { id: 'should', type: 'keyword', pattern: 'should', weight: 0.6 },
    { id: 'ought', type: 'keyword', pattern: 'ought', weight: 0.7 },
    { id: 'right_wrong', type: 'regex', pattern: '(?:is|are)\\s+(?:right|wrong)', weight: 0.8 },
    // Certainty expressions
    { id: 'definitely', type: 'keyword', pattern: 'definitely', weight: 0.5 },
    { id: 'probably', type: 'keyword', pattern: 'probably', weight: 0.5 },
    { id: 'maybe', type: 'keyword', pattern: 'maybe', weight: 0.4 },
    // Worldview indicators
    { id: 'always', type: 'regex', pattern: '(?:people|things|it)\\s+always', weight: 0.7 },
    { id: 'never', type: 'regex', pattern: '(?:people|things|it)\\s+never', weight: 0.7 },
  ],
};

// ============================================================================
// Emotion Patterns
// ============================================================================

export const emotionPatterns: PatternConfig = {
  id: 'emotion_extractor',
  name: 'Emotion Extractor',
  description: 'Extracts emotional states and feelings',
  claimTypes: ['emotion'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 75,
  alwaysRun: true,
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
};

// ============================================================================
// Goal Patterns
// ============================================================================

export const goalPatterns: PatternConfig = {
  id: 'goal_extractor',
  name: 'Goal Extractor',
  description: 'Extracts goals, objectives, and aspirations',
  claimTypes: ['goal'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 90,
  patterns: [
    // Goal keywords
    { id: 'goal', type: 'keyword', pattern: 'goal', weight: 1.0 },
    { id: 'objective', type: 'keyword', pattern: 'objective', weight: 1.0 },
    { id: 'target', type: 'keyword', pattern: 'target', weight: 0.8 },
    { id: 'aim', type: 'keyword', pattern: 'aim', weight: 0.8 },
    // Aspiration patterns
    { id: 'want_to_be', type: 'regex', pattern: 'want\\s+to\\s+(?:be|become)', weight: 1.0 },
    { id: 'dream_of', type: 'regex', pattern: 'dream\\s+of', weight: 0.9 },
    { id: 'aspire', type: 'keyword', pattern: 'aspire', weight: 1.0 },
    { id: 'hope_to', type: 'regex', pattern: 'hope\\s+to', weight: 0.8 },
    { id: 'wish', type: 'regex', pattern: '(?:I|we)\\s+wish', weight: 0.7 },
    // Achievement patterns
    { id: 'achieve', type: 'keyword', pattern: 'achieve', weight: 1.0 },
    { id: 'accomplish', type: 'keyword', pattern: 'accomplish', weight: 1.0 },
    { id: 'reach', type: 'regex', pattern: 'reach\\s+(?:my|our|the)', weight: 0.7 },
    { id: 'hit', type: 'regex', pattern: 'hit\\s+(?:my|our|the)', weight: 0.6 },
    // Success patterns
    { id: 'succeed', type: 'keyword', pattern: 'succeed', weight: 0.8 },
    { id: 'success', type: 'keyword', pattern: 'success', weight: 0.7 },
    { id: 'make_it', type: 'regex', pattern: 'make\\s+it\\s+(?:to|in)', weight: 0.6 },
    // Improvement patterns
    { id: 'improve', type: 'keyword', pattern: 'improve', weight: 0.7 },
    { id: 'get_better', type: 'regex', pattern: 'get\\s+better\\s+at', weight: 0.7 },
    { id: 'learn_to', type: 'regex', pattern: 'learn\\s+(?:to|how\\s+to)', weight: 0.6 },
    // Timeframe indicators
    { id: 'by_end', type: 'regex', pattern: 'by\\s+(?:the\\s+)?end\\s+of', weight: 0.5 },
    { id: 'within', type: 'regex', pattern: 'within\\s+(?:\\d+|a|the\\s+next)', weight: 0.5 },
    { id: 'someday', type: 'keyword', pattern: 'someday', weight: 0.4 },
    { id: 'eventually', type: 'keyword', pattern: 'eventually', weight: 0.4 },
  ],
};

// ============================================================================
// Intention Patterns
// ============================================================================

export const intentionPatterns: PatternConfig = {
  id: 'intention_extractor',
  name: 'Intention Extractor',
  description: 'Extracts intentions, plans, and commitments',
  claimTypes: ['intention', 'commitment', 'decision'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 85,
  patterns: [
    // Direct intentions
    { id: 'going_to', type: 'regex', pattern: "(?:I'm|I am|we're|we are)\\s+going\\s+to", weight: 1.0 },
    { id: 'want_to', type: 'regex', pattern: '(?:I|we)\\s+want\\s+to', weight: 0.9 },
    { id: 'plan_to', type: 'regex', pattern: '(?:I|we)\\s+plan\\s+to', weight: 1.0 },
    { id: 'will', type: 'regex', pattern: "(?:I|we)(?:'ll|\\s+will)\\s+", weight: 0.7 },
    // Commitments
    { id: 'promise', type: 'keyword', pattern: 'promise', weight: 1.0 },
    { id: 'commit', type: 'keyword', pattern: 'commit', weight: 1.0 },
    { id: 'swear', type: 'keyword', pattern: 'swear', weight: 0.9 },
    // Decisions
    { id: 'decided', type: 'regex', pattern: "(?:I've|I have|we've|we have)\\s+decided", weight: 1.0 },
    { id: 'going_to_start', type: 'regex', pattern: 'going\\s+to\\s+start', weight: 0.8 },
    { id: 'going_to_stop', type: 'regex', pattern: 'going\\s+to\\s+stop', weight: 0.8 },
    // Future references
    { id: 'tomorrow', type: 'keyword', pattern: 'tomorrow', weight: 0.4 },
    { id: 'next_week', type: 'regex', pattern: 'next\\s+(?:week|month|year)', weight: 0.5 },
    { id: 'soon', type: 'keyword', pattern: 'soon', weight: 0.3 },
    // Tentative plans
    { id: 'might', type: 'regex', pattern: '(?:I|we)\\s+might', weight: 0.5 },
    { id: 'thinking_about', type: 'regex', pattern: 'thinking\\s+(?:about|of)', weight: 0.6 },
    { id: 'considering', type: 'keyword', pattern: 'considering', weight: 0.6 },
  ],
};

// ============================================================================
// Commitment Patterns
// ============================================================================

export const commitmentPatterns: PatternConfig = {
  id: 'core_commitment',
  name: 'Commitment Extraction',
  description: 'Extracts commitments, promises, and obligations',
  claimTypes: ['commitment'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 75,
  patterns: [
    { id: 'promise', type: 'keyword', pattern: 'I promise|I commit|I pledge|I vow', weight: 0.95 },
    { id: 'will', type: 'keyword', pattern: "I will|I'm going to|I'll definitely|I shall", weight: 0.85 },
    { id: 'obligation', type: 'keyword', pattern: 'I have to|I must|I need to|obligated to', weight: 0.8 },
    { id: 'agree', type: 'keyword', pattern: 'I agreed|I said I would|I told them|I assured', weight: 0.85 },
    { id: 'deadline', type: 'keyword', pattern: 'by tomorrow|by next|deadline|due date', weight: 0.7 },
    { id: 'accountability', type: 'keyword', pattern: "I'm responsible|counting on me|depending on me|my word", weight: 0.8 },
  ],
};

// ============================================================================
// Concern Patterns
// ============================================================================

export const concernPatterns: PatternConfig = {
  id: 'concern_extractor',
  name: 'Concern Extractor',
  description: 'Extracts worries, fears, and concerns',
  claimTypes: ['concern'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 85,
  patterns: [
    // Direct concern expressions
    { id: 'worried', type: 'keyword', pattern: 'worried', weight: 1.0 },
    { id: 'concerned', type: 'keyword', pattern: 'concerned', weight: 1.0 },
    { id: 'afraid', type: 'keyword', pattern: 'afraid', weight: 1.0 },
    { id: 'scared', type: 'keyword', pattern: 'scared', weight: 1.0 },
    { id: 'nervous', type: 'keyword', pattern: 'nervous', weight: 0.8 },
    { id: 'anxious_concern', type: 'keyword', pattern: 'anxious', weight: 0.9 },
    // Fear expressions
    { id: 'fear_that', type: 'regex', pattern: 'fear\\s+(?:that|of)', weight: 1.0 },
    { id: 'what_if', type: 'regex', pattern: 'what\\s+if', weight: 0.8 },
    { id: 'might_not', type: 'regex', pattern: 'might\\s+not', weight: 0.5 },
    // Problem indicators
    { id: 'problem', type: 'keyword', pattern: 'problem', weight: 0.7 },
    { id: 'issue', type: 'keyword', pattern: 'issue', weight: 0.6 },
    { id: 'trouble', type: 'keyword', pattern: 'trouble', weight: 0.7 },
    { id: 'struggling', type: 'keyword', pattern: 'struggling', weight: 0.8 },
    // Uncertainty about outcomes
    { id: 'not_sure', type: 'regex', pattern: "(?:not|n't)\\s+sure\\s+(?:if|about|whether)", weight: 0.6 },
    { id: 'dont_know', type: 'regex', pattern: "(?:don't|do not)\\s+know\\s+(?:if|how|whether)", weight: 0.5 },
    // Risk language
    { id: 'risk', type: 'keyword', pattern: 'risk', weight: 0.8 },
    { id: 'danger', type: 'keyword', pattern: 'danger', weight: 0.9 },
    { id: 'threat', type: 'keyword', pattern: 'threat', weight: 0.8 },
    // Negative outcomes
    { id: 'fail', type: 'regex', pattern: '(?:might|could|will)\\s+fail', weight: 0.8 },
    { id: 'lose', type: 'regex', pattern: '(?:might|could|will)\\s+lose', weight: 0.8 },
    { id: 'miss', type: 'regex', pattern: '(?:might|could|will)\\s+miss', weight: 0.7 },
  ],
};

// ============================================================================
// Decision Patterns
// ============================================================================

export const decisionPatterns: PatternConfig = {
  id: 'core_decision',
  name: 'Decision Extraction',
  description: 'Extracts decisions and choices made',
  claimTypes: ['decision'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 68,
  patterns: [
    { id: 'decided', type: 'keyword', pattern: "I decided|I've decided|decision is|my decision", weight: 0.95 },
    { id: 'chose', type: 'keyword', pattern: 'chose|picked|selected|went with|opted for', weight: 0.85 },
    { id: 'final', type: 'keyword', pattern: "that's final|made up my mind|settled on|going with", weight: 0.9 },
    { id: 'comparative', type: 'keyword', pattern: 'instead of|rather than|over|versus', weight: 0.7 },
    { id: 'resolved', type: 'keyword', pattern: 'figured out|resolved|concluded|determined', weight: 0.7 },
    { id: 'rejection', type: 'keyword', pattern: "not going to|won't|rejected|ruled out|dismissed", weight: 0.7 },
  ],
};

// ============================================================================
// Relationship Patterns
// ============================================================================

export const relationshipPatterns: PatternConfig = {
  id: 'relationship_extractor',
  name: 'Relationship Extractor',
  description: 'Extracts relationship information between people',
  claimTypes: ['relationship'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 75,
  patterns: [
    // Family relationships
    { id: 'my_family', type: 'regex', pattern: 'my\\s+(?:wife|husband|partner|mom|dad|mother|father|brother|sister|son|daughter|child|children|parents?|family)', weight: 1.0 },
    { id: 'their_family', type: 'regex', pattern: '(?:his|her|their)\\s+(?:wife|husband|partner|mom|dad|mother|father|brother|sister|son|daughter|child|children|parents?|family)', weight: 0.8 },
    // Professional relationships
    { id: 'my_work', type: 'regex', pattern: 'my\\s+(?:boss|manager|colleague|coworker|team|employee|client|customer)', weight: 0.9 },
    { id: 'work_with', type: 'regex', pattern: '(?:work|working)\\s+with', weight: 0.6 },
    { id: 'reports_to', type: 'regex', pattern: '(?:report|reports)\\s+to', weight: 0.8 },
    // Friendship
    { id: 'my_friend', type: 'regex', pattern: 'my\\s+(?:friend|best\\s+friend|buddy|mate)', weight: 0.9 },
    { id: 'friends_with', type: 'regex', pattern: 'friends\\s+with', weight: 0.8 },
    // Romantic relationships
    { id: 'dating', type: 'keyword', pattern: 'dating', weight: 0.9 },
    { id: 'relationship', type: 'regex', pattern: '(?:in\\s+a\\s+)?relationship\\s+with', weight: 0.9 },
    { id: 'married_to', type: 'regex', pattern: 'married\\s+to', weight: 1.0 },
    { id: 'engaged', type: 'keyword', pattern: 'engaged', weight: 0.9 },
    // Relationship dynamics
    { id: 'get_along', type: 'regex', pattern: "(?:get|getting)\\s+along\\s+(?:with|well)", weight: 0.7 },
    { id: 'fight_with', type: 'regex', pattern: '(?:fight|fighting|argue|arguing)\\s+with', weight: 0.8 },
    { id: 'close_to', type: 'regex', pattern: 'close\\s+(?:to|with)', weight: 0.7 },
    { id: 'trust', type: 'regex', pattern: "(?:trust|don't trust)", weight: 0.8 },
    // Relationship changes
    { id: 'broke_up', type: 'regex', pattern: 'broke\\s+up', weight: 0.9 },
    { id: 'got_together', type: 'regex', pattern: 'got\\s+together', weight: 0.8 },
    { id: 'met', type: 'regex', pattern: '(?:met|meeting)\\s+(?:with)?', weight: 0.5 },
  ],
};

// ============================================================================
// Preference Patterns
// ============================================================================

export const preferencePatterns: PatternConfig = {
  id: 'core_preference',
  name: 'Preference Extraction',
  description: 'Extracts likes, dislikes, and preferences',
  claimTypes: ['preference'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 55,
  patterns: [
    { id: 'like', type: 'keyword', pattern: 'I like|I love|I enjoy|I prefer|I favor', weight: 0.9 },
    { id: 'dislike', type: 'keyword', pattern: "I don't like|I hate|I dislike|I can't stand|I avoid", weight: 0.9 },
    { id: 'prefer', type: 'keyword', pattern: 'prefer|rather|favorite|best|worst', weight: 0.8 },
    { id: 'compare', type: 'keyword', pattern: 'better than|worse than|more than|less than', weight: 0.6 },
    { id: 'taste', type: 'keyword', pattern: 'my taste|my style|my type|my kind of', weight: 0.7 },
  ],
};

// ============================================================================
// Factual Patterns
// ============================================================================

export const factualPatterns: PatternConfig = {
  id: 'factual_extractor',
  name: 'Factual Extractor',
  description: 'Extracts factual claims and information',
  claimTypes: ['factual'],
  llmTier: 'small',
  minConfidence: 0.7,
  priority: 70,
  alwaysRun: true,
  patterns: [
    // Definite statements
    { id: 'is_a', type: 'regex', pattern: '\\b(?:is|are|was|were)\\s+(?:a|an|the)\\b', weight: 0.4 },
    { id: 'has_have', type: 'regex', pattern: '\\b(?:has|have|had)\\s+(?:a|an|the|\\d)', weight: 0.4 },
    // Quantities and measurements
    { id: 'numbers', type: 'regex', pattern: '\\b\\d+(?:\\.\\d+)?\\s*(?:%|percent|dollars?|years?|months?|days?|hours?|minutes?)', weight: 0.7 },
    { id: 'costs', type: 'regex', pattern: '\\$\\d+(?:,\\d{3})*(?:\\.\\d{2})?', weight: 0.8 },
    // Location/time facts
    { id: 'located', type: 'regex', pattern: '(?:located|based|situated)\\s+(?:in|at|on)', weight: 0.7 },
    { id: 'happened', type: 'regex', pattern: '(?:happened|occurred|took\\s+place)\\s+(?:in|on|at)', weight: 0.7 },
    // Professional/biographical facts
    { id: 'works_at', type: 'regex', pattern: '(?:work|works|worked)\\s+(?:at|for|with)', weight: 0.6 },
    { id: 'studied', type: 'regex', pattern: '(?:studied|graduated|majored)\\s+(?:at|in|from)', weight: 0.6 },
    { id: 'lives_in', type: 'regex', pattern: '(?:live|lives|lived)\\s+(?:in|at|on)', weight: 0.6 },
    // Relationship facts
    { id: 'is_my', type: 'regex', pattern: '\\bis\\s+my\\s+(?:wife|husband|friend|boss|colleague|brother|sister|mother|father)', weight: 0.8 },
    { id: 'married', type: 'regex', pattern: '(?:married|engaged|dating|divorced)', weight: 0.6 },
    // Existence statements
    { id: 'there_is', type: 'regex', pattern: '\\bthere\\s+(?:is|are|was|were)\\b', weight: 0.3 },
  ],
};

// ============================================================================
// Habit Patterns
// ============================================================================

export const habitPatterns: PatternConfig = {
  id: 'core_habit',
  name: 'Habit Extraction',
  description: 'Extracts recurring behaviors and routines',
  claimTypes: ['habit'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 50,
  patterns: [
    { id: 'always', type: 'keyword', pattern: 'always|usually|typically|normally|regularly', weight: 0.8 },
    { id: 'every', type: 'keyword', pattern: 'every day|every week|every morning|each time', weight: 0.9 },
    { id: 'routine', type: 'keyword', pattern: 'routine|habit|practice|ritual|pattern', weight: 0.9 },
    { id: 'tend', type: 'keyword', pattern: 'I tend to|I often|I generally|I commonly', weight: 0.7 },
    { id: 'scheduled', type: 'keyword', pattern: 'on mondays|in the morning|after work|before bed', weight: 0.7 },
  ],
};

// ============================================================================
// Value Patterns
// ============================================================================

export const valuePatterns: PatternConfig = {
  id: 'core_value',
  name: 'Value & Principle Extraction',
  description: 'Extracts core values, principles, and what matters most',
  claimTypes: ['value'],
  llmTier: 'small',
  minConfidence: 0.6,
  priority: 85,
  patterns: [
    { id: 'important', type: 'keyword', pattern: 'important to me|matters to me|care about|value', weight: 0.9 },
    { id: 'should_value', type: 'keyword', pattern: 'should|ought to|right thing|wrong thing|must', weight: 0.7 },
    { id: 'priority', type: 'keyword', pattern: 'priority|comes first|above all|most of all', weight: 0.8 },
    { id: 'core', type: 'keyword', pattern: "that's who I am|defines me|core to me|fundamental", weight: 0.9 },
    { id: 'principle', type: 'keyword', pattern: 'principle|rule|standard|code|ethic', weight: 0.7 },
    { id: 'non_neg', type: 'keyword', pattern: 'non-negotiable|always|never compromise', weight: 0.85 },
  ],
};

// ============================================================================
// Self-Perception Patterns
// ============================================================================

export const selfPerceptionPatterns: PatternConfig = {
  id: 'core_self_perception',
  name: 'Self-Perception Extraction',
  description: 'Extracts how the person sees themselves',
  claimTypes: ['self_perception'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 72,
  patterns: [
    { id: 'i_am', type: 'keyword', pattern: "I am|I'm a|I'm the kind of|I'm someone who", weight: 0.9 },
    { id: 'good_at', type: 'keyword', pattern: 'good at|bad at|strength|weakness|talented|struggle with', weight: 0.8 },
    { id: 'tendency', type: 'keyword', pattern: 'I tend to|I usually|I always|I never', weight: 0.7 },
    { id: 'describe', type: 'keyword', pattern: 'describe myself|see myself|consider myself|think of myself', weight: 0.9 },
    { id: 'compare_self', type: 'keyword', pattern: 'better than|worse than|like most people|unlike others', weight: 0.6 },
    { id: 'role', type: 'keyword', pattern: 'as a|my role|my job|my responsibility', weight: 0.6 },
  ],
};

// ============================================================================
// Question Patterns
// ============================================================================

export const questionPatterns: PatternConfig = {
  id: 'core_question',
  name: 'Question & Uncertainty Extraction',
  description: 'Extracts questions, uncertainties, and knowledge gaps',
  claimTypes: ['question'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 70,
  patterns: [
    { id: 'question_mark', type: 'regex', pattern: '\\?$', weight: 0.9 },
    { id: 'wh_words', type: 'keyword', pattern: 'who|what|where|when|why|how|which', weight: 0.5 },
    { id: 'dont_know_q', type: 'keyword', pattern: "I don't know|I'm not sure|uncertain|I wonder", weight: 0.9 },
    { id: 'maybe_q', type: 'keyword', pattern: 'maybe|perhaps|possibly|might|could be', weight: 0.6 },
    { id: 'should_i', type: 'keyword', pattern: 'should I|what if|would it be|is it better', weight: 0.7 },
    { id: 'seeking', type: 'keyword', pattern: 'any ideas|any thoughts|suggestions|advice', weight: 0.7 },
    { id: 'need_to_find', type: 'keyword', pattern: 'need to find out|need to learn|need to figure out', weight: 0.8 },
  ],
};

// ============================================================================
// Learning Patterns
// ============================================================================

export const learningPatterns: PatternConfig = {
  id: 'core_learning',
  name: 'Learning Extraction',
  description: 'Extracts lessons learned and insights gained',
  claimTypes: ['learning'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 65,
  patterns: [
    { id: 'learned', type: 'keyword', pattern: 'I learned|I realized|I discovered|I found out', weight: 0.95 },
    { id: 'insight', type: 'keyword', pattern: 'insight|revelation|epiphany|understanding', weight: 0.85 },
    { id: 'realize', type: 'keyword', pattern: 'now I know|now I understand|it dawned on me|it hit me', weight: 0.9 },
    { id: 'change_understanding', type: 'keyword', pattern: "didn't know|thought that|turns out|actually", weight: 0.7 },
    { id: 'teaching', type: 'keyword', pattern: 'taught me|showed me|made me realize|helped me see', weight: 0.8 },
    { id: 'growth', type: 'keyword', pattern: 'grew|developed|improved|got better at', weight: 0.6 },
  ],
};

// ============================================================================
// Causal Patterns
// ============================================================================

export const causalPatterns: PatternConfig = {
  id: 'core_causal',
  name: 'Causal Belief Extraction',
  description: 'Extracts causal beliefs about cause-effect relationships',
  claimTypes: ['causal'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 75,
  patterns: [
    { id: 'because', type: 'keyword', pattern: 'because|since|therefore|thus|hence', weight: 0.9 },
    { id: 'caused', type: 'keyword', pattern: 'caused|causes|led to|leads to|resulted in|results in', weight: 0.9 },
    { id: 'due_to', type: 'keyword', pattern: 'due to|owing to|thanks to|on account of', weight: 0.8 },
    { id: 'conditional', type: 'keyword', pattern: 'if.*then|whenever|every time', weight: 0.8 },
    { id: 'mechanism', type: 'keyword', pattern: 'in order to|so that|to achieve', weight: 0.6 },
    { id: 'prevent', type: 'keyword', pattern: 'prevents|stops|blocks|avoids|protects', weight: 0.7 },
    { id: 'enable', type: 'keyword', pattern: 'enables|allows|makes possible|helps', weight: 0.6 },
    { id: 'reason', type: 'keyword', pattern: 'the reason|the cause|what makes|what causes', weight: 0.8 },
  ],
};

// ============================================================================
// Entity Patterns
// ============================================================================

export const entityPatterns: PatternConfig = {
  id: 'core_entity',
  name: 'Entity Extraction',
  description: 'Extracts named entities from conversation',
  claimTypes: [],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 100,
  alwaysRun: true,
  patterns: [
    { id: 'proper_noun', type: 'regex', pattern: '\\b[A-Z][a-z]+(?:\\s+[A-Z][a-z]+)+\\b', weight: 0.8 },
    { id: 'title', type: 'regex', pattern: '\\b(?:Mr|Mrs|Ms|Dr|Prof)\\.?\\s+[A-Z][a-z]+', weight: 0.9 },
    { id: 'org', type: 'keyword', pattern: 'Inc|Corp|LLC|Ltd|Company|Team|Group', weight: 0.8 },
    { id: 'role_entity', type: 'keyword', pattern: 'CEO|CTO|manager|director|lead|founder|boss|colleague', weight: 0.6 },
    { id: 'named', type: 'keyword', pattern: 'called|named|known as', weight: 0.9 },
  ],
};

// ============================================================================
// Hypothetical Patterns
// ============================================================================

export const hypotheticalPatterns: PatternConfig = {
  id: 'core_hypothetical',
  name: 'Hypothetical Extraction',
  description: 'Extracts hypothetical scenarios and counterfactuals',
  claimTypes: ['hypothetical'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 45,
  patterns: [
    { id: 'if_then', type: 'keyword', pattern: 'if I|if we|if they|what if|suppose', weight: 0.9 },
    { id: 'counterfactual', type: 'keyword', pattern: 'if I had|if only|wish I had|should have', weight: 0.85 },
    { id: 'hypothetical', type: 'keyword', pattern: 'imagine|hypothetically|theoretically|in theory', weight: 0.8 },
    { id: 'modal', type: 'keyword', pattern: 'could be|would be|might be|could have', weight: 0.7 },
    { id: 'scenario', type: 'keyword', pattern: 'scenario|possibility|alternative|option', weight: 0.6 },
    { id: 'future_if', type: 'keyword', pattern: 'if this happens|when this happens|in case', weight: 0.7 },
  ],
};

// ============================================================================
// Memory Reference Patterns
// ============================================================================

export const memoryReferencePatterns: PatternConfig = {
  id: 'core_memory_reference',
  name: 'Memory Reference Extraction',
  description: 'Extracts references to past events and experiences',
  claimTypes: ['memory_reference'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 60,
  patterns: [
    { id: 'remember', type: 'keyword', pattern: 'I remember|I recall|I think back|reminds me of', weight: 0.95 },
    { id: 'past_time', type: 'keyword', pattern: 'back when|years ago|when I was|used to', weight: 0.85 },
    { id: 'specific_time', type: 'keyword', pattern: 'last year|last month|in 2\\d{3}|that time when', weight: 0.8 },
    { id: 'experience', type: 'keyword', pattern: 'experienced|went through|happened to me|I had', weight: 0.7 },
    { id: 'comparison_past', type: 'keyword', pattern: 'like before|same as when|different from when|unlike last time', weight: 0.7 },
    { id: 'nostalgia', type: 'keyword', pattern: 'miss|wish I could|those days|back then', weight: 0.6 },
  ],
};

// ============================================================================
// Change Marker Patterns
// ============================================================================

export const changeMarkerPatterns: PatternConfig = {
  id: 'core_change_marker',
  name: 'Change Marker Extraction',
  description: 'Extracts statements about change and transitions',
  claimTypes: ['change_marker'],
  llmTier: 'small',
  minConfidence: 0.5,
  priority: 58,
  patterns: [
    { id: 'changed', type: 'keyword', pattern: 'changed|different now|not the same|transformed', weight: 0.9 },
    { id: 'used_to', type: 'keyword', pattern: 'used to|before I|in the past I|no longer', weight: 0.85 },
    { id: 'transition', type: 'keyword', pattern: 'becoming|turning into|starting to|beginning to', weight: 0.8 },
    { id: 'evolution', type: 'keyword', pattern: 'evolved|grown|developed|progressed|shifted', weight: 0.75 },
    { id: 'contrast', type: 'keyword', pattern: 'whereas before|unlike before|compared to before|now instead', weight: 0.8 },
    { id: 'new_old', type: 'keyword', pattern: 'new|old|previous|former|current|now', weight: 0.5 },
  ],
};

// ============================================================================
// All Patterns - Aggregated for Registry
// ============================================================================

export const ALL_PATTERN_CONFIGS: PatternConfig[] = [
  beliefPatterns,
  emotionPatterns,
  goalPatterns,
  intentionPatterns,
  commitmentPatterns,
  concernPatterns,
  decisionPatterns,
  relationshipPatterns,
  preferencePatterns,
  factualPatterns,
  habitPatterns,
  valuePatterns,
  selfPerceptionPatterns,
  questionPatterns,
  learningPatterns,
  causalPatterns,
  entityPatterns,
  hypotheticalPatterns,
  memoryReferencePatterns,
  changeMarkerPatterns,
];
