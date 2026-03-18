/**
 * SYS-I Transports — Backend abstraction for the conversation engine
 *
 * Two implementations:
 * 1. ChatGPTTransport — Uses Chrome extension to pipe into ChatGPT conversation
 *    (ChatGPT maintains full conversation history natively)
 * 2. LLMApiTransport — Uses the standard callLLM() tier system
 *    (We maintain conversation history locally)
 *
 * Both transports always return a structured SendResult parsed from markdown sections.
 * Both support injectContext() for search round-trips (LLM requests context,
 * we search the graph, inject results, LLM responds with full answer).
 */

import { rambleExt } from '../chrome-extension'
import { callLLM } from '../../program/llmClient'
import type { LLMTier } from '../../program/types/llmTiers'
import { SYS1_SYSTEM_PROMPT } from './prompt'
import { createLogger } from '../../program/utils/logger'

const log = createLogger('Sys1Transport')

// ─── Types ──────────────────────────────────────────────────────────

/**
 * What the user is doing with their input — classified by SYS-I.
 * Lowercase for uniformity with emotion vocabulary.
 */
export type UserIntent = 'assert' | 'query' | 'correct' | 'explore' | 'command' | 'social'

/**
 * Emotional tone of the user's turn — classified by SYS-I alongside intent.
 * Fixed vocabulary prevents free-form LLM hallucination of emotion labels.
 * Lowercase for uniformity with intent vocabulary.
 */
export type UserEmotion = 'neutral' | 'excited' | 'frustrated' | 'curious' | 'anxious' | 'confident' | 'hesitant' | 'reflective'

/** A request from SYS-I to search the knowledge graph for context */
export interface SysISearchRequest {
  query: string
  type: 'memory' | 'entity' | 'goal'
}

/**
 * Structured response from SYS-I.
 *
 * Intent and emotion are parsed from the combined "INTENT:EMOTION" format
 * (e.g., "ASSERT:curious"). This avoids an extra LLM output section —
 * emotion classification piggybacks on the existing intent line.
 */
export interface SendResult {
  intent: UserIntent
  /**
   * Emotional tone of the user's turn. Fixed vocabulary:
   * neutral, excited, frustrated, curious, anxious, confident, hesitant, reflective.
   * Defaults to 'neutral' if the LLM doesn't provide one.
   */
  emotion: UserEmotion
  topic: string
  /** What to say to the user. Null only when requesting a search (response not ready yet). */
  response: string | null
  /** Isolated question text for ASSERT/EXPLORE — same as response. Null for all other intents. */
  question: string | null
  /** Non-null when LLM needs graph context before it can respond. */
  search: SysISearchRequest | null
  /** ChatGPT conversation URL (ChatGPT transport only) */
  chatUrl?: string
}

// ─── Transport Interface ────────────────────────────────────────────

export interface Sys1Transport {
  readonly name: string
  isAvailable(): boolean
  /** Send user speech. Returns structured result (may include search request). */
  send(userSpeech: string): Promise<SendResult>
  /**
   * Inject context (search results) into the existing conversation and get a
   * follow-up response. Called after a search round-trip.
   */
  injectContext(content: string): Promise<SendResult>
  reset(): void
  /** Mark that we're resuming an existing session (system prompt already sent) */
  resume(): void
}

// ─── Section Parser ──────────────────────────────────────────────────

const VALID_INTENTS: UserIntent[] = ['assert', 'query', 'correct', 'explore', 'command', 'social']
const VALID_EMOTIONS: UserEmotion[] = ['neutral', 'excited', 'frustrated', 'curious', 'anxious', 'confident', 'hesitant', 'reflective']
const SECTION_KEYS = new Set(['intent', 'response', 'topic', 'search'])

/**
 * Parse the LLM's section-based response into a SendResult.
 *
 * Handles two formats:
 *
 * 1. Raw markdown (from clipboard copy):
 *      ## intent
 *      ASSERT
 *      ## response
 *      What made you decide now?
 *
 * 2. Plain text (from DOM .textContent — ChatGPT renders ## as <h2>,
 *    so textContent strips the ## markers):
 *      intent
 *      ASSERT
 *      response
 *      What made you decide now?
 *
 * In both cases, section keywords (intent, response, topic, search)
 * appearing alone on a line mark the start of a section.
 *
 * Search is extracted separately via pattern match.
 */
function parseSysIResponse(raw: string): Omit<SendResult, 'chatUrl'> {
  // ── Search: pattern match — works with or without ## prefix ──
  let search: SysISearchRequest | null = null
  const searchMatch = raw.match(/^(?:##\s*)?search\s*\n(\{[^\n]+\})/im)
  if (searchMatch) {
    try {
      const parsed = JSON.parse(searchMatch[1].trim())
      if (parsed.query && ['memory', 'entity', 'goal'].includes(parsed.type)) {
        search = { type: parsed.type, query: parsed.query }
      }
    } catch {
      log.warn('SYS-I: found search section but JSON parse failed:', searchMatch[1])
    }
  }

  // ── Parse sections — handles both "## key" and bare "key" on own line ──
  // A section header is a known keyword alone on its own line, either:
  //   - at the very start of the text, OR
  //   - preceded by a blank line
  // This prevents false positives from words like "response" in content.
  // DOM .innerText gives \n\n between block elements — matches this requirement.
  const sections: Record<string, string> = {}
  const lines = raw.split('\n')
  let currentKey: string | null = null
  let currentLines: string[] = []
  let prevLineBlank = true  // treat start-of-text as "after blank"

  for (const line of lines) {
    const stripped = line.replace(/^##\s*/, '').trim().toLowerCase()
    const isSectionHeader = SECTION_KEYS.has(stripped)
      && line.trim().split(/\s+/).length === 1
      && prevLineBlank

    if (isSectionHeader) {
      // Flush previous section
      if (currentKey) {
        sections[currentKey] = currentLines.join('\n').trim()
      }
      currentKey = stripped
      currentLines = []
    } else {
      currentLines.push(line)
    }

    prevLineBlank = line.trim() === ''
  }
  // Flush last section
  if (currentKey) {
    sections[currentKey] = currentLines.join('\n').trim()
  }

  // No sections found — treat whole text as a plain response
  if (Object.keys(sections).length === 0) {
    log.warn('SYS-I: no sections found, treating as plain response')
    const text = raw.trim()
    return { intent: 'assert', emotion: 'neutral', topic: 'general', response: text, question: text, search: null }
  }

  // Intent + Emotion — parsed from "INTENT:EMOTION" format (e.g., "ASSERT:curious")
  // Backward compatible: if no colon, emotion defaults to 'neutral'.
  // This format was chosen to avoid adding another output section to the prompt.
  const intentLine = sections['intent']?.split('\n')[0].trim() ?? ''
  const { intent, emotion } = parseIntentEmotion(intentLine)

  // Topic
  const topic = sections['topic']?.split('\n')[0].trim() || 'general'

  // Response
  const response = sections['response'] ?? null

  // Question — derive from response for assert/explore; null otherwise
  const question = (intent === 'assert' || intent === 'explore') ? response : null

  return { intent, emotion, topic, response, question, search }
}

/**
 * Parse the combined "intent:emotion" string.
 *
 * Expected format: "assert:curious", "query:neutral", etc.
 * Handles edge cases:
 *   - Missing emotion → defaults to 'neutral'
 *   - Invalid intent → defaults to 'assert'
 *   - Invalid emotion → defaults to 'neutral'
 *   - Legacy format (just "assert") → emotion = 'neutral'
 *
 * Both parts use fixed vocabularies to prevent free-form LLM output
 * from polluting the classification. If the LLM writes something
 * outside the vocabulary, we fall back to safe defaults.
 */
function parseIntentEmotion(raw: string): { intent: UserIntent; emotion: UserEmotion } {
  const parts = raw.split(':')
  // Both intent and emotion are normalized to lowercase for uniform storage
  const intentStr = (parts[0] ?? '').trim().toLowerCase() as UserIntent
  const emotionStr = (parts[1] ?? '').trim().toLowerCase() as UserEmotion

  const intent: UserIntent = VALID_INTENTS.includes(intentStr) ? intentStr : 'assert'
  const emotion: UserEmotion = VALID_EMOTIONS.includes(emotionStr) ? emotionStr : 'neutral'

  return { intent, emotion }
}

// ─── ChatGPT Transport (via Chrome Extension) ──────────────────────

export class ChatGPTTransport implements Sys1Transport {
  readonly name = 'ChatGPT (Extension)'
  private isFirstSend = true
  private chatSessionId: string
  private chatUrl: string | null
  private unsubUrl: (() => void) | null = null

  constructor(chatSessionId: string, chatUrl: string | null = null) {
    this.chatSessionId = chatSessionId
    this.chatUrl = chatUrl
    // Keep chatUrl in sync when the extension discovers/updates it via heartbeat
    this.unsubUrl = rambleExt.onConversationUrl(chatSessionId, url => {
      this.updateChatUrl(url)
    })
  }

  isAvailable(): boolean {
    return rambleExt.isAvailable
  }

  async send(userSpeech: string): Promise<SendResult> {
    log.info('[ChatGPT] Sending →', {
      session: this.chatSessionId,
      chatUrl: this.chatUrl || '(none)',
      isFirstSend: this.isFirstSend,
      len: userSpeech.length,
    })

    const response = await rambleExt.aiConversation({
      conversationId: this.chatSessionId,
      prompt: userSpeech,
      systemPrompt: this.isFirstSend ? SYS1_SYSTEM_PROMPT : undefined,
      chatUrl: this.chatUrl ?? undefined,
      tabMode: 'reuse',
    })

    this.isFirstSend = false
    this.updateChatUrl(response.chatUrl)

    const raw = response.answer?.trim() ?? ''
    return {
      ...parseSysIResponse(raw),
      chatUrl: response.chatUrl ?? undefined,
    }
  }

  async injectContext(content: string): Promise<SendResult> {
    log.info('[ChatGPT] Injecting context →', { len: content.length })

    const response = await rambleExt.aiConversation({
      conversationId: this.chatSessionId,
      prompt: content,
      // No systemPrompt — already in the conversation thread
      chatUrl: this.chatUrl ?? undefined,
      tabMode: 'reuse',
    })

    this.updateChatUrl(response.chatUrl)

    const raw = response.answer.trim()
    return {
      ...parseSysIResponse(raw),
      chatUrl: response.chatUrl ?? undefined,
    }
  }

  reset(): void {
    this.isFirstSend = true
    this.chatUrl = null
  }

  resume(): void {
    this.isFirstSend = false
  }

  dispose(): void {
    this.unsubUrl?.()
    this.unsubUrl = null
  }

  getChatUrl(): string | null {
    return this.chatUrl
  }

  private updateChatUrl(url: string | null | undefined): void {
    if (url && url !== this.chatUrl) {
      log.info('[ChatGPT] chatUrl updated:', url)
      this.chatUrl = url
    }
  }
}

// ─── LLM API Transport (via callLLM tier system) ───────────────────

interface Turn {
  response: string
  question: string | null
  userSpeech: string
}

export class LLMApiTransport implements Sys1Transport {
  readonly name = 'LLM API'
  private turns: Turn[] = []
  private tier: LLMTier
  /** Tracks the current in-flight user speech for search round-trips */
  private pendingSpeech: string | null = null

  constructor(tier: LLMTier = 'medium') {
    this.tier = tier
  }

  isAvailable(): boolean {
    return true
  }

  async send(userSpeech: string): Promise<SendResult> {
    log.info('[LLM API] Sending:', userSpeech.slice(0, 80))

    this.pendingSpeech = userSpeech
    const prompt = this.buildPrompt(userSpeech)

    const response = await callLLM({
      tier: this.tier,
      prompt,
      systemPrompt: SYS1_SYSTEM_PROMPT,
      category: 'sys1',
      options: {
        temperature: 0.7,
        max_tokens: 500,
      },
    })

    const raw = response.content
    const result = parseSysIResponse(raw)

    // Only commit to turns when we have a final answer (no search pending)
    if (!result.search) {
      this.turns.push({ response: result.response ?? '', question: result.question ?? null, userSpeech })
      if (this.turns.length > 20) this.turns = this.turns.slice(-20)
      this.pendingSpeech = null
    }

    return result
  }

  async injectContext(content: string): Promise<SendResult> {
    const speech = this.pendingSpeech ?? ''
    log.info('[LLM API] Injecting context for speech:', speech.slice(0, 40))

    // Rebuild the original prompt with the injected content appended
    const prompt = this.buildPrompt(speech) + '\n\n' + content

    const response = await callLLM({
      tier: this.tier,
      prompt,
      systemPrompt: SYS1_SYSTEM_PROMPT,
      category: 'sys1',
      options: {
        temperature: 0.7,
        max_tokens: 500,
      },
    })

    const raw = response.content
    const result = parseSysIResponse(raw)

    if (!result.search) {
      this.turns.push({ response: result.response ?? '', question: result.question ?? null, userSpeech: speech })
      if (this.turns.length > 20) this.turns = this.turns.slice(-20)
      this.pendingSpeech = null
    }

    return result
  }

  reset(): void {
    this.turns = []
    this.pendingSpeech = null
  }

  resume(): void {
    // LLM API always sends system prompt — no-op
  }

  private buildPrompt(currentSpeech: string): string {
    if (this.turns.length === 0) {
      return `The user just said:\n\n"${currentSpeech}"`
    }

    const history = this.turns.map(t =>
      `You responded: ${t.response}\nUser said: "${t.userSpeech}"`
    ).join('\n\n')

    return `Previous conversation:\n---\n${history}\n---\n\nThe user just said:\n\n"${currentSpeech}"`
  }
}
