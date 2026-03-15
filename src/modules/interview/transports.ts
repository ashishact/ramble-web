/**
 * SYS-I Transports — Backend abstraction for the conversation engine
 *
 * Two implementations:
 * 1. ChatGPTTransport — Uses Chrome extension to pipe into ChatGPT conversation
 *    (ChatGPT maintains full conversation history natively)
 * 2. LLMApiTransport — Uses the standard callLLM() tier system
 *    (We maintain conversation history locally)
 *
 * Both transports always return a structured SendResult parsed from JSON.
 * Both support injectContext() for search round-trips (LLM requests context,
 * we search the graph, inject results, LLM responds with full answer).
 */

import { rambleExt } from '../chrome-extension'
import { callLLM } from '../../program/llmClient'
import type { LLMTier } from '../../program/types/llmTiers'
import { SYS1_SYSTEM_PROMPT } from './prompt'
import { createLogger } from '../../program/utils/logger'

const log = createLogger('InterviewTransport')

// ─── Types ──────────────────────────────────────────────────────────

/** What the user is doing with their input — classified by SYS-I */
export type UserIntent = 'ASSERT' | 'QUERY' | 'CORRECT' | 'EXPLORE' | 'COMMAND' | 'SOCIAL'

/** A request from SYS-I to search the knowledge graph for context */
export interface SysISearchRequest {
  query: string
  type: 'memory' | 'entity' | 'goal'
}

/** Structured response from SYS-I */
export interface SendResult {
  intent: UserIntent
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

export interface InterviewTransport {
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

// ─── JSON Parsing Helper ────────────────────────────────────────────

/**
 * Parse the LLM's JSON response into a SendResult.
 * Strips code block fences if present. Falls back to treating the raw
 * text as a plain ASSERT question if JSON parsing fails.
 */
function parseSysIResponse(raw: string): Omit<SendResult, 'chatUrl'> {
  const stripped = raw.trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(stripped)
    return {
      intent: parsed.intent ?? 'ASSERT',
      topic: parsed.topic ?? 'general',
      response: parsed.response ?? null,
      question: parsed.question ?? null,
      search: parsed.search ?? null,
    }
  } catch {
    // Fallback: treat entire response as a plain question
    log.warn('Failed to parse SYS-I JSON, falling back to raw text')
    const text = raw.trim()
    return {
      intent: 'ASSERT',
      topic: 'general',
      response: text,
      question: text,
      search: null,
    }
  }
}

// ─── ChatGPT Transport (via Chrome Extension) ──────────────────────

export class ChatGPTTransport implements InterviewTransport {
  readonly name = 'ChatGPT (Extension)'
  private isFirstSend = true
  private chatSessionId: string
  private chatUrl: string | null

  constructor(chatSessionId: string, chatUrl: string | null = null) {
    this.chatSessionId = chatSessionId
    this.chatUrl = chatUrl
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
    })

    this.isFirstSend = false
    this.updateChatUrl(response.chatUrl)

    return {
      ...parseSysIResponse(response.answer.trim()),
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
    })

    this.updateChatUrl(response.chatUrl)

    return {
      ...parseSysIResponse(response.answer.trim()),
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

export class LLMApiTransport implements InterviewTransport {
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

    const result = parseSysIResponse(response.content)

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

    const result = parseSysIResponse(response.content)

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
