/**
 * Interview Transports — Backend abstraction for the interview engine
 *
 * Two implementations:
 * 1. ChatGPTTransport — Uses Chrome extension to pipe into ChatGPT conversation
 *    (ChatGPT maintains full conversation history)
 * 2. LLMApiTransport — Uses the standard callLLM() tier system
 *    (We maintain conversation history locally, pack into prompt each call)
 *
 * The engine picks a transport based on configuration. Eventually the user's
 * plan/settings will determine which one to use.
 */

import { rambleExt } from '../chrome-extension'
import { callLLM } from '../../program/llmClient'
import type { LLMTier } from '../../program/types/llmTiers'
import { INTERVIEW_SYSTEM_PROMPT } from './prompt'
import { createLogger } from '../../program/utils/logger'

const log = createLogger('InterviewTransport')

// ─── Transport Interface ────────────────────────────────────────────

export interface SendResult {
  question: string
  /** ChatGPT conversation URL — reported back after sends */
  chatUrl?: string
}

export interface InterviewTransport {
  /** Human-readable name */
  readonly name: string
  /** Check if this transport is currently available */
  isAvailable(): boolean
  /** Send user speech and get back a question. Manages conversation context internally. */
  send(userSpeech: string): Promise<SendResult>
  /** Reset conversation state (start fresh) */
  reset(): void
  /** Mark that we're resuming an existing session (system prompt already sent) */
  resume(): void
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
      systemPrompt: this.isFirstSend ? INTERVIEW_SYSTEM_PROMPT : undefined,
      chatUrl: this.chatUrl || undefined,
    })

    this.isFirstSend = false

    // Update chatUrl from response (ChatGPT redirects to /c/xxx after first send)
    if (response.chatUrl) {
      if (response.chatUrl !== this.chatUrl) {
        log.info('[ChatGPT] chatUrl updated:', response.chatUrl)
      }
      this.chatUrl = response.chatUrl
    } else {
      log.warn('[ChatGPT] No chatUrl in response — extension may not be reporting it back')
    }

    return {
      question: response.answer.trim(),
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
}

// ─── LLM API Transport (via callLLM tier system) ───────────────────

interface Turn {
  question: string
  userSpeech: string
}

export class LLMApiTransport implements InterviewTransport {
  readonly name = 'LLM API'
  private turns: Turn[] = []
  private tier: LLMTier

  constructor(tier: LLMTier = 'medium') {
    this.tier = tier
  }

  isAvailable(): boolean {
    // callLLM() will throw if API key is missing — we can't easily check
    // without attempting a call. Return true and let errors surface naturally.
    return true
  }

  async send(userSpeech: string): Promise<SendResult> {
    log.info('[LLM API] Sending:', userSpeech.slice(0, 80))

    // Build prompt with conversation history
    const prompt = this.buildPrompt(userSpeech)

    const response = await callLLM({
      tier: this.tier,
      prompt,
      systemPrompt: INTERVIEW_SYSTEM_PROMPT,
      category: 'interview',
      options: {
        temperature: 0.8,
        max_tokens: 200,
      },
    })

    const question = response.content.trim()

    // Store turn for next call's context
    this.turns.push({ question, userSpeech })

    // Keep history manageable (last 20 turns)
    if (this.turns.length > 20) {
      this.turns = this.turns.slice(-20)
    }

    return { question }
  }

  reset(): void {
    this.turns = []
  }

  resume(): void {
    // LLM API always sends system prompt — no-op
  }

  private buildPrompt(currentSpeech: string): string {
    if (this.turns.length === 0) {
      return `The user just said:\n\n"${currentSpeech}"`
    }

    // Pack previous turns into context
    const history = this.turns.map(t =>
      `You asked: ${t.question}\nUser said: "${t.userSpeech}"`
    ).join('\n\n')

    return `Previous conversation:\n---\n${history}\n---\n\nThe user just said:\n\n"${currentSpeech}"`
  }
}
