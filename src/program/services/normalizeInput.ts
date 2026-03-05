/**
 * Input Normalization — Full Correction + Hint Extraction Pipeline
 *
 * VISION: Two-Pass Architecture
 * ═════════════════════════════
 * Pass 1 (this file): Clean text + extract search keys (entity/topic hints)
 * Pass 2 (contextRetrieval.ts): Use hints to find real DB entities/topics/memories
 *
 * This solves the chicken-and-egg problem: "How do we give the LLM relevant
 * context if we don't know what the user is talking about yet?"
 * Answer: first pass extracts approximate names/topics as search keys,
 * second pass uses them to fetch precise context from the DB.
 *
 * CORRECTION PIPELINE (sequential):
 * 1. Dictionary corrections — known STT error → correct word mappings
 * 2. Phonetic matching — soundex/levenshtein against known entities
 * 3. Learned corrections — context-aware corrections from user history
 * 4. LLM normalization — punctuation/capitalization + hint extraction
 *
 * PHILOSOPHY: No mandatory user confirmation for corrections. We auto-correct
 * based on confidence. If wrong, user corrects later, system learns from that.
 * The correction dictionary grows organically from user behavior.
 *
 * speakerHint is for meeting use: mic = user's microphone, system = remote audio.
 * For regular speech/text inputs it will be null.
 */

import { callLLM } from '../llmClient'
import { parseLLMJSON } from '../utils/jsonUtils'
import { correctionStore, learnedCorrectionStore } from '../../db/stores'
import { findPhoneticMatches, findSpellingMatches, formatMatchesForLLM } from './phoneticMatcher'
import type { NormalizationHints, Intent } from '../types/recording'

const VALID_INTENTS: Intent[] = ['inform', 'correct', 'retract', 'update', 'instruct', 'narrate', 'query', 'elaborate']

// ============================================================================
// Types
// ============================================================================

export interface NormalizedSentence {
  text: string
  speakerHint: 'mic' | 'system' | null
}

/**
 * Full normalization result with hints for context retrieval.
 * The `hints` field is the search key output — it tells the context retrieval
 * system what to look for in the database before the extraction LLM call.
 */
export interface NormalizeResult {
  normalizedText: string
  sentences: NormalizedSentence[]
  hints: NormalizationHints
}

// ============================================================================
// LLM Prompt
// ============================================================================

const SYSTEM_PROMPT = `You are a text normalization assistant that also extracts search hints.

Your THREE jobs:
1. Fix punctuation, capitalization, and apply STT corrections
2. Extract entity and topic hints as search keys
3. Classify the user's intent

Rules for normalization:
- Add missing punctuation (periods, commas, question marks, etc.)
- Fix capitalization at sentence starts and for "I"
- Apply any corrections provided in the correction hints section
- Do NOT rephrase, summarize, expand, or change meaning beyond corrections
- Do NOT add words that were not in the input
- Preserve the speaker's exact voice and all original content

Rules for hints:
- entityHints: Names of people, places, organizations, projects mentioned
  - Include the name as-is (even if misspelled — downstream will fuzzy match)
  - Include a confidence score (0.0-1.0) based on how clear the name is
- topicHints: Topics/themes being discussed (e.g. "project deadline", "health")

Classify the user's intent as one of these — pick the single best match:
- inform: sharing new information or facts (DEFAULT — use this when unsure)
- correct: fixing a mistake — spelling, name, entity type, wrong fact ("it's spelled X", "that's actually Y", "no, I meant Z")
- retract: removing or invalidating old info ("forget that", "that's no longer true", "delete X", "ignore what I said")
- update: explicitly changing something already known ("the deadline moved to March 15", "she's feeling better now", "we signed the deal")
- instruct: giving a persistent instruction or setting identity ("my name is X", "always remember that", "when I say X I mean Y")
- narrate: telling a story or recounting events in sequence ("last week first we did X, then Y happened")
- query: asking a question, wants retrieval not knowledge creation ("what do I know about X?", "when did I last mention Y?")
- elaborate: intentionally going deep on one topic ("let me tell you everything about X", "okay so about the architecture...")

Return this as the "intent" field. When in doubt, use "inform".

Output JSON only. No explanation.`

// ============================================================================
// Correction Pipeline
// ============================================================================

/**
 * Step 1: Apply dictionary corrections — known STT error mappings.
 * These are manually-confirmed or LLM-extracted corrections stored in the DB.
 */
async function applyDictionaryCorrections(text: string): Promise<{
  text: string
  corrections: Array<{ from: string; to: string }>
}> {
  try {
    const { corrected, applied } = await correctionStore.applyCorrections(text)
    return { text: corrected, corrections: applied }
  } catch {
    return { text, corrections: [] }
  }
}

/**
 * Step 2: Find phonetic matches against known entities.
 * Returns suggestions (not auto-applied) — the LLM decides whether to use them.
 */
async function buildPhoneticHints(
  text: string,
  source: 'speech' | 'text' | string
): Promise<string> {
  try {
    if (source === 'speech') {
      const matches = await findPhoneticMatches(text)
      return formatMatchesForLLM(matches) ?? ''
    } else {
      const matches = await findSpellingMatches(text)
      if (matches.length > 0) {
        const hints = matches.map(m => `- "${m.inputWord}" might be "${m.matchedEntity}"`)
        return `## Possible Typos (verify if relevant)\n${hints.join('\n')}`
      }
    }
  } catch {
    // Non-critical — continue without phonetic hints
  }
  return ''
}

/**
 * Step 3: Apply learned corrections — context-aware corrections from user history.
 * Only applies corrections with high confidence + matching context.
 */
async function applyLearnedCorrections(text: string): Promise<{
  text: string
  corrections: Array<{ from: string; to: string }>
}> {
  try {
    const matches = await learnedCorrectionStore.findCorrectionsForText(text)
    // Only apply corrections with high combined score (context + frequency)
    const highConfidence = matches.filter(m => m.combinedScore >= 0.7)

    if (highConfidence.length === 0) {
      return { text, corrections: [] }
    }

    let corrected = text
    const corrections: Array<{ from: string; to: string }> = []

    // Apply corrections from right to left (so indices don't shift)
    const sorted = [...highConfidence].sort((a, b) => b.startIndex - a.startIndex)
    for (const match of sorted) {
      corrected = corrected.slice(0, match.startIndex) + match.corrected + corrected.slice(match.endIndex)
      corrections.push({ from: match.original, to: match.corrected })
    }

    return { text: corrected, corrections }
  } catch {
    return { text, corrections: [] }
  }
}

// ============================================================================
// Main Normalize Function
// ============================================================================

/**
 * Full normalization pipeline: corrections → phonetic hints → learned corrections → LLM.
 *
 * @param rawText - The raw input text (from STT, typing, or paste)
 * @param recentSentences - Recent conversation sentences for context continuity
 * @param source - How the text arrived (speech, text, pasted, etc.) — affects correction strategy
 * @returns Normalized text + sentences + hints for context retrieval
 */
export async function normalizeInput(
  rawText: string,
  recentSentences: string[],
  source: 'speech' | 'text' | string = 'text'
): Promise<NormalizeResult> {
  const allCorrections: Array<{ from: string; to: string }> = []

  try {
    // ── Step 1: Dictionary corrections ──────────────────────────────────
    const dictResult = await applyDictionaryCorrections(rawText)
    let currentText = dictResult.text
    allCorrections.push(...dictResult.corrections)

    // ── Step 2: Phonetic hints (for LLM, not auto-applied) ─────────────
    const phoneticSection = await buildPhoneticHints(currentText, source)

    // ── Step 3: Learned corrections ────────────────────────────────────
    const learnedResult = await applyLearnedCorrections(currentText)
    currentText = learnedResult.text
    allCorrections.push(...learnedResult.corrections)

    // ── Step 4: LLM normalization + hint extraction ────────────────────
    const contextBlock = recentSentences.length > 0
      ? `Recent context (for name/term continuity):\n${recentSentences.slice(0, 5).map(s => `- ${s}`).join('\n')}\n\n`
      : ''

    const correctionBlock = allCorrections.length > 0
      ? `Pre-applied corrections:\n${allCorrections.map(c => `- "${c.from}" → "${c.to}"`).join('\n')}\n\n`
      : ''

    const prompt = `${contextBlock}${correctionBlock}${phoneticSection ? phoneticSection + '\n\n' : ''}Current time: ${new Date().toString()}

Normalize this input. Fix punctuation and capitalization. Apply any phonetic corrections if they make sense in context. Extract entity and topic hints as search keys.

Input:
${currentText}

Respond with JSON:
{
  "normalizedText": "full cleaned text",
  "sentences": [{ "text": "Sentence.", "speakerHint": null }],
  "entityHints": [{ "name": "Person Name", "type": "person", "confidence": 0.9 }],
  "topicHints": [{ "name": "topic name", "category": "work" }],
  "intent": "inform"
}`

    const response = await callLLM({
      tier: 'small',
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      options: {
        temperature: 0.1,
        max_tokens: 800,
      },
    })

    const { data, error } = parseLLMJSON<{
      normalizedText?: unknown
      sentences?: unknown[]
      entityHints?: unknown[]
      topicHints?: unknown[]
      intent?: unknown
    }>(response.content)

    if (error || !data) {
      return {
        normalizedText: currentText,
        sentences: [],
        hints: { entityHints: [], topicHints: [], correctionsApplied: allCorrections, intent: 'inform' },
      }
    }

    // Parse normalizedText
    const normalizedText =
      typeof data.normalizedText === 'string' && data.normalizedText.trim()
        ? data.normalizedText.trim()
        : currentText

    // Parse sentences
    const sentences: NormalizedSentence[] = Array.isArray(data.sentences)
      ? data.sentences
          .filter(
            (s): s is { text: string; speakerHint?: 'mic' | 'system' | null } =>
              s !== null &&
              typeof s === 'object' &&
              typeof (s as Record<string, unknown>).text === 'string' &&
              ((s as Record<string, unknown>).text as string).trim().length > 0
          )
          .map(s => ({
            text: s.text.trim(),
            speakerHint: s.speakerHint ?? null,
          }))
      : []

    // Parse entity hints
    const entityHints = Array.isArray(data.entityHints)
      ? data.entityHints
          .filter((h): h is { name: string; type?: string; confidence?: number } =>
            h !== null &&
            typeof h === 'object' &&
            typeof (h as Record<string, unknown>).name === 'string' &&
            ((h as Record<string, unknown>).name as string).trim().length > 0
          )
          .map(h => ({
            name: h.name.trim(),
            type: typeof h.type === 'string' ? h.type : undefined,
            confidence: typeof h.confidence === 'number' ? h.confidence : 0.5,
          }))
      : []

    // Parse topic hints
    const topicHints = Array.isArray(data.topicHints)
      ? data.topicHints
          .filter((h): h is { name: string; category?: string } =>
            h !== null &&
            typeof h === 'object' &&
            typeof (h as Record<string, unknown>).name === 'string' &&
            ((h as Record<string, unknown>).name as string).trim().length > 0
          )
          .map(h => ({
            name: h.name.trim(),
            category: typeof h.category === 'string' ? h.category : undefined,
          }))
      : []

    // Parse intent (default to 'inform' if missing or invalid)
    const intent: Intent = typeof data.intent === 'string' && VALID_INTENTS.includes(data.intent as Intent)
      ? data.intent as Intent
      : 'inform'

    return {
      normalizedText,
      sentences,
      hints: {
        entityHints,
        topicHints,
        correctionsApplied: allCorrections,
        intent,
      },
    }
  } catch {
    // Never break processing — always return usable output
    return {
      normalizedText: rawText,
      sentences: [],
      hints: { entityHints: [], topicHints: [], correctionsApplied: allCorrections, intent: 'inform' },
    }
  }
}
