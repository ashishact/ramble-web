/**
 * SYS-I Transports — Backend abstraction for the conversation engine
 *
 * Two implementations:
 * 1. ChatGPTTransport — Uses Chrome extension to pipe into ChatGPT conversation
 *    (ChatGPT maintains full conversation history natively, markdown section format)
 * 2. APIConversationTransport — Uses AI SDK v6 streamText() for multi-turn
 *    conversations via our proxy (JSON output format for reliable parsing)
 *
 * Both support injectContext() for search round-trips (LLM requests context,
 * we search the graph, inject results, LLM responds with full answer).
 */

import { rambleExt } from '../chrome-extension'
import { streamText, type ModelMessage } from 'ai'
import { models } from '../../services/aiProviders'
import { SYS1_MARKDOWN_PROMPT, SYS1_JSON_PROMPT } from './prompt'
import { eventBus } from '../../lib/eventBus'
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
  /** Max results to return (after relevance filtering). Optional, default 2 */
  limit?: number
  /** Minimum relevance score 0–1 — results below this are excluded. Optional, default 0.6 */
  relevance?: number
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
  topic: string | undefined
  /** What to say to the user. Null only when requesting a search (response not ready yet). */
  response: string | null
  /** Isolated question text for ASSERT/EXPLORE — same as response. Null for all other intents. */
  question: string | null
  /** Non-null when LLM needs graph context before it can respond. */
  search: SysISearchRequest | null
  /** ChatGPT conversation URL (ChatGPT transport only) */
  chatUrl?: string
  /** Raw LLM output before section parsing (for debug view) */
  rawOutput?: string
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
        if (typeof parsed.limit === 'number' && parsed.limit > 0) search.limit = parsed.limit
        if (typeof parsed.relevance === 'number' && parsed.relevance >= 0 && parsed.relevance <= 1) search.relevance = parsed.relevance
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
    return { intent: 'assert', emotion: 'neutral', topic: undefined, response: text, question: text, search: null }
  }

  // Intent + Emotion — parsed from "INTENT:EMOTION" format (e.g., "ASSERT:curious")
  // Backward compatible: if no colon, emotion defaults to 'neutral'.
  // This format was chosen to avoid adding another output section to the prompt.
  const intentLine = sections['intent']?.split('\n')[0].trim() ?? ''
  const { intent, emotion } = parseIntentEmotion(intentLine)

  // Topic
  const topic = sections['topic']?.split('\n')[0].trim() || undefined

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

// ─── JSON Parser (API transport) ────────────────────────────────────

/**
 * Parse a JSON response from the API transport.
 *
 * Expected shape:
 *   { "intent": "assert:curious", "topic": "...", "response": "...", "search": null }
 *
 * Fallback strategy:
 *   1. Try JSON.parse(raw)
 *   2. If that fails, try to extract JSON from markdown code fences (```json ... ```)
 *   3. If that fails, treat the whole text as a plain response
 */
function parseJsonSysIResponse(raw: string): Omit<SendResult, 'chatUrl'> {
  let json: Record<string, unknown> | null = null

  // Attempt 1: direct parse
  try {
    json = JSON.parse(raw)
  } catch {
    // Attempt 2: extract from code fences
    const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/)
    if (fenceMatch) {
      try {
        json = JSON.parse(fenceMatch[1].trim())
      } catch {
        // fall through
      }
    }
  }

  if (!json || typeof json !== 'object') {
    // Fallback: treat as plain response
    log.warn('SYS-I JSON: parse failed, treating as plain response')
    const text = raw.trim()
    return { intent: 'assert', emotion: 'neutral', topic: undefined, response: text, question: text, search: null }
  }

  // Parse intent:emotion
  const intentLine = typeof json.intent === 'string' ? json.intent : ''
  const { intent, emotion } = parseIntentEmotion(intentLine)

  // Topic
  const topic = typeof json.topic === 'string' && json.topic.trim() ? json.topic.trim() : undefined

  // Response
  const response = typeof json.response === 'string' ? json.response : null

  // Search
  let search: SysISearchRequest | null = null
  if (json.search && typeof json.search === 'object') {
    const s = json.search as Record<string, unknown>
    if (typeof s.query === 'string' && ['memory', 'entity', 'goal'].includes(s.type as string)) {
      search = { query: s.query, type: s.type as SysISearchRequest['type'] }
      if (typeof s.limit === 'number' && s.limit > 0) search.limit = s.limit
      if (typeof s.relevance === 'number' && s.relevance >= 0 && s.relevance <= 1) search.relevance = s.relevance
    }
  }

  // Question — derive from response for assert/explore; null otherwise
  const question = (intent === 'assert' || intent === 'explore') ? response : null

  return { intent, emotion, topic, response, question, search }
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
      systemPrompt: this.isFirstSend ? SYS1_MARKDOWN_PROMPT : undefined,
      chatUrl: this.chatUrl ?? undefined,
      tabMode: 'reuse',
    })

    this.isFirstSend = false
    this.updateChatUrl(response.chatUrl)

    const raw = response.answer?.trim() ?? ''
    return {
      ...parseSysIResponse(raw),
      chatUrl: response.chatUrl ?? undefined,
      rawOutput: raw,
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
      rawOutput: raw,
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

// ─── API Conversation Transport (AI SDK v6 streamText) ──────────────

/**
 * Multi-turn conversation transport using the Vercel AI SDK.
 *
 * Maintains a proper ModelMessage[] array and uses streamText() for
 * real-time token streaming. Emits sys1:stream events for live UI updates.
 *
 * Replaces the old LLMApiTransport which stuffed history into a single prompt.
 */
export class APIConversationTransport implements Sys1Transport {
  readonly name = 'API (Gemini)'
  private messages: ModelMessage[] = []
  private model = models.conversation
  private abortController: AbortController | null = null

  /** Max conversation turns before compacting */
  private static readonly MAX_TURNS = 30

  isAvailable(): boolean {
    return true
  }

  async send(userSpeech: string): Promise<SendResult> {
    log.info('[API] Sending →', { len: userSpeech.length, msgCount: this.messages.length })

    this.messages.push({ role: 'user', content: userSpeech })

    return this.streamAndParse()
  }

  async injectContext(content: string): Promise<SendResult> {
    log.info('[API] Injecting context →', { len: content.length })

    this.messages.push({ role: 'user', content })

    return this.streamAndParse()
  }

  reset(): void {
    this.abortInFlight()
    this.messages = []
  }

  resume(): void {
    // No-op for API transport — system prompt is always sent via
    // the top-level `system` parameter, not in the messages array
  }

  private abortInFlight(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
  }

  private async streamAndParse(): Promise<SendResult> {
    // Abort previous in-flight request
    this.abortInFlight()
    this.abortController = new AbortController()

    // Compact if conversation is getting long
    if (this.messages.length > APIConversationTransport.MAX_TURNS * 2) {
      this.compact()
    }

    try {
      // System prompt is passed as a top-level parameter, NOT in the messages
      // array. The Google provider converts this to `systemInstruction` in the
      // Gemini API — pushing it into messages[] was silently dropping it.
      const result = streamText({
        model: this.model,
        system: SYS1_JSON_PROMPT,
        messages: this.messages,
        abortSignal: this.abortController.signal,
        temperature: 0.7,
        maxOutputTokens: 500,
      })

      // Stream tokens for live UI updates — emit accumulated text (not deltas)
      // so the stream handler can progressively extract the response field
      let fullText = ''
      for await (const delta of result.textStream) {
        fullText += delta
        eventBus.emit('sys1:stream', { text: fullText, conversationId: '' })
      }

      // Append assistant response to conversation history
      this.messages.push({ role: 'assistant', content: fullText })

      const raw = fullText.trim()
      return { ...parseJsonSysIResponse(raw), rawOutput: raw }
    } finally {
      this.abortController = null
    }
  }

  /**
   * Compact conversation history to prevent context overflow.
   * Keeps last 5 turns, summarizes the rest.
   * System prompt is not in the messages array — it's always sent
   * via the top-level `system` parameter.
   */
  private compact(): void {
    log.info('[API] Compacting conversation', { from: this.messages.length })

    const recentMessages = this.messages.slice(-10) // last 5 turns (user+assistant pairs)
    const middleMessages = this.messages.slice(0, -10)

    if (middleMessages.length === 0) return

    // Build a summary of the middle section
    const middleText = middleMessages
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 200) : '(complex)'}`)
      .join('\n')

    const summary: ModelMessage = {
      role: 'user',
      content: `[CONVERSATION SUMMARY — earlier exchanges condensed]\n${middleText.slice(0, 2000)}\n[END SUMMARY]`,
    }

    this.messages = [summary, ...recentMessages]
    log.info('[API] Compacted to', this.messages.length, 'messages')
  }
}
