/**
 * Phase 1: Input Normalization
 *
 * Cheap LLM call that fixes punctuation and capitalization on raw STT text,
 * then splits the result into discrete sentences.
 *
 * Rules:
 * - Fix punctuation and capitalization ONLY
 * - Do NOT rephrase, summarize, or change meaning
 * - Do NOT correct proper nouns unless obviously broken
 * - Always returns usable output — falls back gracefully on any failure
 *
 * speakerHint is for meeting use: mic = user's microphone, system = remote audio.
 * For regular speech/text inputs it will be null.
 */

import { callLLM } from '../llmClient'
import { parseLLMJSON } from '../utils/jsonUtils'

export interface NormalizedSentence {
  text: string
  speakerHint: 'mic' | 'system' | null
}

export interface NormalizeResult {
  normalizedText: string
  sentences: NormalizedSentence[]
}

const SYSTEM_PROMPT = `You are a text normalization assistant. Your ONLY job is to fix punctuation and capitalization in speech-to-text transcripts.

Rules:
- Add missing punctuation (periods, commas, question marks, etc.)
- Fix capitalization at sentence starts and for "I"
- Split the text into individual sentences
- Do NOT rephrase, summarize, expand, or change meaning
- Do NOT correct proper nouns unless they are obviously mangled (e.g. "i" → "I" is fine; changing "Alice" to "Alex" is not)
- Do NOT add words that were not in the input
- Preserve the speaker's exact voice and all original content

Output JSON only. No explanation.`

export async function normalizeInput(
  rawText: string,
  recentSentences: string[]
): Promise<NormalizeResult> {
  try {
    const contextBlock = recentSentences.length > 0
      ? `Recent context (last few sentences — for name/term continuity only):\n${recentSentences.slice(0, 5).map(s => `- ${s}`).join('\n')}\n\n`
      : ''

    const prompt = `${contextBlock}Normalize this speech-to-text input. Fix punctuation and capitalization only. Split into sentences.

Input:
${rawText}

Respond with JSON matching this schema:
{
  "normalizedText": "full cleaned text as a single string",
  "sentences": [
    { "text": "First sentence.", "speakerHint": null }
  ]
}`

    const response = await callLLM({
      tier: 'small',
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      options: {
        temperature: 0.1,
        max_tokens: 600,
      },
    })

    const { data, error } = parseLLMJSON<{
      normalizedText?: unknown
      sentences?: unknown[]
    }>(response.content)

    if (error || !data) {
      return { normalizedText: rawText, sentences: [] }
    }

    const normalizedText =
      typeof data.normalizedText === 'string' && data.normalizedText.trim()
        ? data.normalizedText.trim()
        : rawText

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

    return { normalizedText, sentences }
  } catch {
    // Never break processing — always return usable output
    return { normalizedText: rawText, sentences: [] }
  }
}
