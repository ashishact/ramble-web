/**
 * Sys1Engine (SYS-I) — Pipes user speech into a persistent AI conversation
 *
 * Listens to graph:tables:changed for ['conversations'], fetches the
 * latest conversation, and sends it through the active transport.
 *
 * The transport classifies the user's intent and returns a structured response:
 *   - ASSERT/EXPLORE → deepening question (spoken, stored)
 *   - QUERY → answer from context, with optional graph search round-trip
 *   - CORRECT → acknowledgment
 *   - COMMAND → confirmation
 *   - SOCIAL → brief reply
 *
 * Search round-trips: if the LLM requests graph context (search ≠ null),
 * we run a vector search on DuckDB and inject results back into the conversation.
 * Max 2 search rounds per send to prevent runaway loops.
 *
 * Fail-safe: Conversations that fail are queued and retried on the next attempt.
 * Pending queue and response history are persisted to profileStorage.
 *
 * Chat Session: Each session maps to a single ChatGPT conversation.
 * chatSessionId and chatUrl are persisted so the extension can find and reuse
 * the right ChatGPT tab across page reloads and service worker restarts.
 * Ramble-web is the source of truth for all session state.
 *
 * Transport selection:
 *   - ChatGPTTransport: Chrome extension → ChatGPT tab (when extension is available)
 *   - APIConversationTransport: AI SDK v6 → proxy → provider API (fallback)
 *
 * Transport is auto-selected at session boundaries (start/reset).
 * Never switches mid-session to avoid conversation state confusion.
 */

import { conversationStore } from '../../graph/stores/conversationStore'
import { graphEventBus } from '../../graph/events/EventBus'
import { eventBus } from '../../lib/eventBus'
import { profileStorage } from '../../lib/profileStorage'
import { createLogger } from '../../program/utils/logger'
import { nid } from '../../program/utils/id'
import { rambleExt } from '../chrome-extension'
import type { Sys1Transport, UserIntent, UserEmotion, SysISearchRequest } from './transports'
import { ChatGPTTransport, APIConversationTransport } from './transports'
import { setDebugTrace, type Sys1SearchTrace } from './debugStore'

const log = createLogger('Sys1Engine')

export type Sys1State = 'idle' | 'sending' | 'error' | 'no-transport'

export interface Sys1Response {
  /** What was spoken to the user */
  response: string
  /** Isolated question text for ASSERT/EXPLORE (same as response). Null for QUERY/CORRECT etc. */
  question: string | null
  intent: UserIntent
  /** Emotional tone of the user's turn (classified by LLM alongside intent) */
  emotion: UserEmotion
  topic: string
  timestamp: number
}

interface PendingEntry {
  conversationId: string
  rawText: string
  timestamp: number
}

interface SessionMetrics {
  turnCount: number
  charCount: number
  lastActivityAt: number
}

const DEBOUNCE_MS = 1000
const MAX_SEARCH_ROUNDS = 2

// ── Session auto-reset thresholds ────────────────────────────────────
// 30k chars ≈ 7.5k OpenAI tokens. For medium turns (~400 chars) this is
// ~75 turns — the HARD_TURN_CAP fires first. For long turns (~800+ chars)
// the char budget is the primary limiter (~35 turns).
const CHAR_BUDGET = 30_000
const IDLE_RESET_MS = 30 * 60_000 // 30 minutes
const HARD_TURN_CAP = 60

const STORAGE_KEY_PENDING = 'sys1-pending'
const STORAGE_KEY_HISTORY = 'sys1-history'
const STORAGE_KEY_PROCESSED = 'sys1-last-processed-id'
const STORAGE_KEY_SESSION_ID = 'sys1-chat-session-id'
const STORAGE_KEY_CHAT_URL = 'sys1-chat-url'
const STORAGE_KEY_METRICS = 'sys1-session-metrics'

export class Sys1Engine {
  private state: Sys1State = 'idle'
  private lastProcessedId: string | null = null
  private history: Sys1Response[] = []
  private pending: PendingEntry[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private unsubGraphEvents: (() => void) | null = null
  private unsubAvailability: (() => void) | null = null
  private streamHandler: EventListener | null = null
  private statusHandler: EventListener | null = null
  private transport: Sys1Transport
  private bootstrapped = false
  private chatSessionId: string
  private chatUrl: string | null = null

  /** Set when extension availability changes — applied on next session reset */
  private transportSwitchPending = false

  // Session budget tracking
  private turnCount = 0
  private sessionCharCount = 0
  private lastActivityAt = 0

  constructor(transport?: Sys1Transport) {
    this.chatSessionId = this.loadOrCreateSessionId()
    this.chatUrl = profileStorage.getItem(STORAGE_KEY_CHAT_URL)
    this.transport = transport ?? this.createTransportForCurrentState()
  }

  /**
   * Select the appropriate transport based on current extension availability.
   * Called at construction and on session reset.
   */
  private createTransportForCurrentState(): Sys1Transport {
    if (rambleExt.isAvailable) {
      log.info('Extension available → ChatGPTTransport')
      return new ChatGPTTransport(this.chatSessionId, this.chatUrl)
    }
    log.info('Extension not available → APIConversationTransport')
    return new APIConversationTransport()
  }

  async start(): Promise<void> {
    if (this.unsubGraphEvents) return

    log.info('Starting with transport:', this.transport.name, 'session:', this.chatSessionId)
    eventBus.emit('sys1:transport', { name: this.transport.name })

    this.loadFromStorage()

    if (this.history.length > 0) {
      this.transport.resume()
    }

    if (!this.bootstrapped) {
      await this.bootstrapFromDB()
    }

    this.updateState(this.transport.isAvailable() ? 'idle' : 'no-transport')

    this.unsubGraphEvents = graphEventBus.on('graph:tables:changed', (payload) => {
      if (payload.tables.includes('conversations')) {
        this.onConversationsChanged()
      }
    })

    // Track extension availability changes — never switch mid-session
    this.unsubAvailability = rambleExt.onAvailabilityChange((available) => {
      const currentIsChatGPT = this.transport instanceof ChatGPTTransport
      const shouldSwitch = available !== currentIsChatGPT
      if (shouldSwitch) {
        this.transportSwitchPending = true
        log.info('Extension availability changed, transport switch pending →', available ? 'ChatGPT' : 'API')
      }
    })

    this.streamHandler = ((e: CustomEvent) => {
      const { conversationId, text } = e.detail || {}
      if (conversationId === this.chatSessionId && text) {
        eventBus.emit('sys1:stream', { text, conversationId })
      }
    }) as EventListener
    window.addEventListener('ramble:ext:conversation-stream', this.streamHandler)

    this.statusHandler = ((e: CustomEvent) => {
      const { conversationId, status } = e.detail || {}
      if (conversationId === this.chatSessionId) {
        eventBus.emit('sys1:status', { conversationId, status })
      }
    }) as EventListener
    window.addEventListener('ramble:ext:conversation-status', this.statusHandler)
  }

  stop(): void {
    log.info('Stopping')
    this.unsubGraphEvents?.()
    this.unsubGraphEvents = null
    this.unsubAvailability?.()
    this.unsubAvailability = null
    if (this.streamHandler) {
      window.removeEventListener('ramble:ext:conversation-stream', this.streamHandler)
      this.streamHandler = null
    }
    if (this.statusHandler) {
      window.removeEventListener('ramble:ext:conversation-status', this.statusHandler)
      this.statusHandler = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  setTransport(transport: Sys1Transport): void {
    log.info('Switching transport to:', transport.name)
    this.transport = transport
    this.updateState(transport.isAvailable() ? 'idle' : 'no-transport')
  }

  getTransportName(): string {
    return this.transport.name
  }

  getState(): Sys1State {
    return this.state
  }

  getLastResponse(): Sys1Response | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null
  }

  getHistory(): Sys1Response[] {
    return [...this.history]
  }

  getPendingCount(): number {
    return this.pending.length
  }

  getChatSessionId(): string {
    return this.chatSessionId
  }

  getChatUrl(): string | null {
    return this.chatUrl
  }

  retry(): void {
    if (this.state === 'sending') return
    if (this.pending.length === 0) return
    log.info('Retry requested, pending:', this.pending.length)
    this.flush()
  }

  async resetSession(opts?: { withContext?: boolean }): Promise<void> {
    log.info('Resetting chat session', {
      withContext: !!opts?.withContext,
      prevTurns: this.turnCount,
      prevChars: this.sessionCharCount,
    })

    // Close the old ChatGPT tab after a short delay so any in-flight
    // streaming/heartbeat can finish cleanly
    if (this.chatUrl) {
      const urlToClose = this.chatUrl
      log.info('Scheduling tab close for old session:', urlToClose)
      setTimeout(() => rambleExt.closeTab(urlToClose), 60_000)
    }

    this.history = []
    this.pending = []
    this.chatUrl = null
    this.lastProcessedId = null
    this.turnCount = 0
    this.sessionCharCount = 0
    this.lastActivityAt = 0

    this.chatSessionId = this.generateSessionId()
    profileStorage.setItem(STORAGE_KEY_SESSION_ID, this.chatSessionId)
    profileStorage.removeItem(STORAGE_KEY_CHAT_URL)
    this.saveToStorage()

    // Dispose old transport's subscriptions before creating a new one
    if (this.transport instanceof ChatGPTTransport) {
      this.transport.dispose()
    }
    this.transport.reset()

    // Apply pending transport switch (extension became available/unavailable)
    if (this.transportSwitchPending) {
      this.transportSwitchPending = false
      const newTransport = this.createTransportForCurrentState()
      log.info('Transport switch applied:', this.transport.name, '→', newTransport.name)
      this.transport = newTransport
      eventBus.emit('sys1:transport', { name: newTransport.name })
    } else if (this.transport instanceof ChatGPTTransport) {
      this.transport = new ChatGPTTransport(this.chatSessionId, null)
    }

    this.updateState(this.transport.isAvailable() ? 'idle' : 'no-transport')
    log.info('New session:', this.chatSessionId)

    if (opts?.withContext) {
      this.bootstrapped = false
      await this.bootstrapFromDB()
      if (this.pending.length > 0) {
        log.info('Flushing bootstrapped context to new session:', this.pending.length)
        this.flush()
      }
    }
  }

  // ── Session ID ──────────────────────────────────────────────────────

  private loadOrCreateSessionId(): string {
    const stored = profileStorage.getItem(STORAGE_KEY_SESSION_ID)
    if (stored) return stored
    const id = this.generateSessionId()
    profileStorage.setItem(STORAGE_KEY_SESSION_ID, id)
    return id
  }

  private generateSessionId(): string {
    return nid.chat()
  }

  // ── Persistence ──────────────────────────────────────────────────

  private loadFromStorage(): void {
    const pending = profileStorage.getJSON<PendingEntry[]>(STORAGE_KEY_PENDING)
    const rawHistory = profileStorage.getJSON<unknown[]>(STORAGE_KEY_HISTORY)
    const lastId = profileStorage.getItem(STORAGE_KEY_PROCESSED)
    const metrics = profileStorage.getJSON<SessionMetrics>(STORAGE_KEY_METRICS)

    if (pending) this.pending = pending
    if (rawHistory) this.history = rawHistory.map(migrateHistoryEntry)
    if (lastId) this.lastProcessedId = lastId
    if (metrics) {
      this.turnCount = metrics.turnCount
      this.sessionCharCount = metrics.charCount
      this.lastActivityAt = metrics.lastActivityAt
    }

    this.bootstrapped = !!(rawHistory || pending || lastId)

    if (this.bootstrapped) {
      log.info('Restored from storage — pending:', this.pending.length,
        'history:', this.history.length, 'turns:', this.turnCount, 'chars:', this.sessionCharCount)
    }
  }

  private saveToStorage(): void {
    profileStorage.setJSON(STORAGE_KEY_PENDING, this.pending)
    profileStorage.setJSON(STORAGE_KEY_HISTORY, this.history)
    if (this.lastProcessedId) {
      profileStorage.setItem(STORAGE_KEY_PROCESSED, this.lastProcessedId)
    }
    profileStorage.setJSON(STORAGE_KEY_METRICS, {
      turnCount: this.turnCount,
      charCount: this.sessionCharCount,
      lastActivityAt: this.lastActivityAt,
    } satisfies SessionMetrics)
  }

  private async bootstrapFromDB(): Promise<void> {
    try {
      const recent = await conversationStore.getRecent(10)
      const userConvs = recent
        .filter(c => c.speaker === 'user' && c.source === 'text' && c.raw_text.trim().length >= 3)
        .reverse()

      if (userConvs.length > 0) {
        this.pending = userConvs.map(c => ({
          conversationId: c.id,
          rawText: c.raw_text,
          timestamp: c.created_at,
        }))
        this.lastProcessedId = userConvs[userConvs.length - 1].id

        // Count bootstrapped chars toward the session budget —
        // these get combined into a single message sent to ChatGPT
        const bootstrapChars = userConvs.reduce((sum, c) => sum + c.raw_text.length, 0)
        this.sessionCharCount += bootstrapChars
        log.info('Bootstrapped from DB:', this.pending.length, 'conversations,', bootstrapChars, 'chars')

        this.bootstrapped = true
        this.saveToStorage()
      } else {
        this.bootstrapped = true
        this.saveToStorage()
      }
    } catch (err) {
      log.error('Bootstrap from DB failed:', err)
      this.bootstrapped = true
    }
  }

  // ── Event handling ───────────────────────────────────────────────

  private updateState(newState: Sys1State): void {
    if (this.state === newState) return
    this.state = newState
    eventBus.emit('sys1:state', { state: newState })
  }

  private onConversationsChanged(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.enqueueLatest()
    }, DEBOUNCE_MS)
  }

  private async enqueueLatest(): Promise<void> {
    try {
      const recent = await conversationStore.getRecent(1)
      if (recent.length === 0) return

      const latest = recent[0]

      if (latest.id === this.lastProcessedId) return
      if (this.pending.some(p => p.conversationId === latest.id)) return
      if (latest.speaker !== 'user') return
      if (latest.raw_text.trim().length < 3) return

      this.lastProcessedId = latest.id
      this.pending.push({
        conversationId: latest.id,
        rawText: latest.raw_text,
        timestamp: latest.created_at,
      })
      this.saveToStorage()

      log.info('Enqueued conversation, pending:', this.pending.length)
      this.flush()
    } catch (err) {
      log.error('Failed to enqueue:', err)
    }
  }

  // ── Flush ────────────────────────────────────────────────────────

  private async flush(): Promise<void> {
    if (!this.transport.isAvailable()) {
      this.updateState('no-transport')
      return
    }
    if (this.state === 'sending') return
    if (this.pending.length === 0) return

    // ── Auto-reset check ──────────────────────────────────────────
    // If the session has exceeded its budget, silently start a new one.
    // resetSession({ withContext: true }) re-bootstraps from DB (which
    // includes whatever we're about to send) and calls flush() internally.
    if (this.shouldAutoReset()) {
      await this.resetSession({ withContext: true })
      return
    }

    this.updateState('sending')

    const now = Date.now()
    const combined = this.pending.length === 1
      ? this.pending[0].rawText
      : this.pending.map((p, i) => `[${i + 1} · ${timeAgo(now - p.timestamp)}] ${p.rawText}`).join('\n\n')

    log.info('Flushing', this.pending.length, 'pending to', this.transport.name,
      '| turn:', this.turnCount, '| chars:', this.sessionCharCount)

    const startTime = Date.now()
    const searchTraces: Sys1SearchTrace[] = []

    try {
      // Initial send
      let result = await this.transport.send(combined)

      // Search round-trips — LLM may request graph context before responding
      let searchRounds = 0
      while (result.search && searchRounds < MAX_SEARCH_ROUNDS) {
        log.info('LLM requesting search:', result.search)
        const searchText = await this.runGraphSearch(result.search)
        searchTraces.push({
          query: result.search.query,
          type: result.search.type,
          limit: result.search.limit,
          relevance: result.search.relevance,
          resultsLength: searchText.length,
          resultPreview: searchText.slice(0, 300),
        })
        result = await this.transport.injectContext(`<search-res>\n${searchText}\n</search-res>`)
        searchRounds++
      }

      // If still requesting search after max rounds, fall back
      if (result.search) {
        log.warn('Exceeded max search rounds, falling back')
        result = {
          intent: 'query',
          emotion: result.emotion,
          topic: result.topic,
          response: "I couldn't find the relevant context in your knowledge graph.",
          question: null,
          search: null,
        }
      }

      const response = result.response ?? ''
      log.info('Got response:', response.slice(0, 80), '| intent:', result.intent, '| topic:', result.topic)

      // Update chatUrl if ChatGPT transport reports one back
      if (result.chatUrl && result.chatUrl !== this.chatUrl) {
        this.chatUrl = result.chatUrl
        profileStorage.setItem(STORAGE_KEY_CHAT_URL, result.chatUrl)
        log.info('Chat URL updated:', result.chatUrl)
      }

      this.pending = []

      // ── Update session metrics ──────────────────────────────────
      this.turnCount++
      this.sessionCharCount += combined.length + response.length
      this.lastActivityAt = Date.now()

      const entry: Sys1Response = {
        response,
        question: result.question,
        intent: result.intent,
        emotion: result.emotion,
        topic: result.topic,
        timestamp: Date.now(),
      }
      this.history.push(entry)
      this.saveToStorage()

      // Store in conversation DB so it appears in the unified thread.
      // Intent is stored as "INTENT:EMOTION" (e.g., "assert:curious") for
      // full provenance. Emotion is also stored separately in its own column
      // for direct querying without parsing.
      let convId: string | null = null
      try {
        const conv = await conversationStore.create({
          sessionId: this.chatSessionId,
          rawText: response,
          source: 'sys1',
          speaker: 'sys1',
          intent: `${result.intent}:${result.emotion}`,
          emotion: result.emotion,
          topic: result.topic || undefined,
        })
        convId = conv.id
        await conversationStore.markProcessed(conv.id)
      } catch (err) {
        log.error('Failed to store SYS-I response in DuckDB:', err)
      }

      // ── Store debug trace ───────────────────────────────────────
      if (convId) {
        setDebugTrace(convId, {
          transport: this.transport.name,
          rawOutput: result.rawOutput ?? '',
          parsedIntent: result.intent,
          parsedEmotion: result.emotion,
          parsedTopic: result.topic,
          userInput: combined,
          searches: searchTraces,
          totalDurationMs: Date.now() - startTime,
        })
      }

      eventBus.emit('sys1:response', entry)
      if (response) {
        eventBus.emit('tts:speak', { text: response })
      }
      this.updateState('idle')
    } catch (err) {
      log.error('Transport error:', err)
      this.saveToStorage()
      this.updateState('error')
    }
  }

  // ── Session auto-reset ──────────────────────────────────────────

  /**
   * Check whether the current session should be silently rotated.
   *
   * Triggers (in priority order):
   *  1. Hard turn cap (60) — always reset, even during active conversation
   *  2. Character budget (20k) — cumulative user speech + LLM responses
   *  3. Idle timeout (30 min) — only fires after a gap, not during active use
   */
  private shouldAutoReset(): boolean {
    // No completed turns yet — don't reset (avoids infinite loop when
    // bootstrap chars alone exceed the budget)
    if (this.turnCount === 0) return false

    if (this.turnCount >= HARD_TURN_CAP) {
      log.info('Auto-reset: hard turn cap reached', { turns: this.turnCount })
      return true
    }

    if (this.sessionCharCount >= CHAR_BUDGET) {
      log.info('Auto-reset: char budget exceeded', { chars: this.sessionCharCount, turns: this.turnCount })
      return true
    }

    if (this.lastActivityAt > 0 && (Date.now() - this.lastActivityAt) >= IDLE_RESET_MS) {
      log.info('Auto-reset: idle timeout', { idleMs: Date.now() - this.lastActivityAt, turns: this.turnCount })
      return true
    }

    return false
  }

  // ── Graph Search ─────────────────────────────────────────────────

  /**
   * Run a semantic search on the knowledge graph.
   * Used during search round-trips when SYS-I requests context.
   */
  private async runGraphSearch(req: SysISearchRequest): Promise<string> {
    try {
      const [{ getGraphService }, { EmbeddingService }, { searchAndEnrich }] = await Promise.all([
        import('../../graph'),
        import('../../graph/embeddings/EmbeddingService'),
        import('../../graph/embeddings/searchAndEnrich'),
      ])

      const graph = await getGraphService()
      const embeddings = new EmbeddingService(graph)
      return await searchAndEnrich(req, graph, embeddings)
    } catch (err) {
      log.warn('Graph search failed:', err)
      return 'Search unavailable.'
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
}

/**
 * Migrate old-format history entries to the current shape.
 * Handles two legacy formats:
 *   1. { question, timestamp } — earliest format
 *   2. { response, question, intent, topic, timestamp } — v1 format (no emotion)
 * Current format adds 'emotion' field.
 */
function migrateHistoryEntry(raw: unknown): Sys1Response {
  const entry = raw as Record<string, unknown>
  if (entry.response) {
    // v1 or current format — ensure emotion exists (default 'neutral' for v1 entries)
    // Normalize legacy uppercase intents to lowercase
    const rawIntent = (entry.intent as string) ?? 'assert'
    return {
      ...entry,
      intent: rawIntent.toLowerCase(),
      emotion: (entry.emotion as string) ?? 'neutral',
    } as unknown as Sys1Response
  }
  // Earliest format: { question, timestamp }
  const text = (entry.question as string) ?? ''
  return {
    response: text,
    question: text,
    intent: 'assert',
    emotion: 'neutral',
    topic: 'general',
    timestamp: (entry.timestamp as number) ?? Date.now(),
  }
}
