/**
 * InterviewEngine — Pipes user speech into a persistent AI conversation
 *
 * Listens to graph:tables:changed for ['conversations'], fetches the
 * latest conversation, and sends it through the active transport.
 * The transport generates exactly ONE follow-up question, which is
 * emitted via eventBus for the QuestionWidget.
 *
 * Fail-safe: Conversations that fail to send are queued and retried
 * on the next successful attempt. The pending queue and question history
 * are persisted to profileStorage so they survive page refreshes.
 * On first boot (nothing in storage), bootstraps from the DB.
 *
 * Chat Session: Each session maps to a single ChatGPT conversation.
 * The chatSessionId and chatUrl are persisted so the extension can
 * find and reuse the right ChatGPT tab across page reloads and
 * service worker restarts. Ramble-web is the source of truth.
 *
 * Transports:
 *   - ChatGPTTransport: Chrome extension → ChatGPT tab (maintains history)
 *   - LLMApiTransport: Direct API call via callLLM() tier system
 */

import { conversationStore } from '../../graph/stores/conversationStore'
import { graphEventBus } from '../../graph/events/EventBus'
import { eventBus } from '../../lib/eventBus'
import { profileStorage } from '../../lib/profileStorage'
import { createLogger } from '../../program/utils/logger'
import type { InterviewTransport } from './transports'
import { ChatGPTTransport } from './transports'

const log = createLogger('InterviewEngine')

export type InterviewState = 'idle' | 'sending' | 'error' | 'no-transport'

export interface InterviewQuestion {
  question: string
  timestamp: number
}

interface PendingEntry {
  conversationId: string
  rawText: string
  timestamp: number
}

const DEBOUNCE_MS = 1000
const STORAGE_KEY_PENDING = 'interview-pending'
const STORAGE_KEY_HISTORY = 'interview-history'
const STORAGE_KEY_PROCESSED = 'interview-last-processed-id'
const STORAGE_KEY_SESSION_ID = 'interview-chat-session-id'
const STORAGE_KEY_CHAT_URL = 'interview-chat-url'

export class InterviewEngine {
  private state: InterviewState = 'idle'
  private lastProcessedId: string | null = null
  private history: InterviewQuestion[] = []
  private pending: PendingEntry[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private unsubGraphEvents: (() => void) | null = null
  private streamHandler: EventListener | null = null
  private transport: InterviewTransport
  private bootstrapped = false
  private chatSessionId: string
  private chatUrl: string | null = null

  constructor(transport?: InterviewTransport) {
    // Load or generate chat session ID
    this.chatSessionId = this.loadOrCreateSessionId()
    this.chatUrl = profileStorage.getItem(STORAGE_KEY_CHAT_URL)

    // Create transport with session context
    this.transport = transport ?? new ChatGPTTransport(this.chatSessionId, this.chatUrl)
  }

  async start(): Promise<void> {
    if (this.unsubGraphEvents) return // already started

    log.info('Starting with transport:', this.transport.name, 'session:', this.chatSessionId)

    // Restore persisted state
    this.loadFromStorage()

    // If we have history, the system prompt was already sent — tell transport
    if (this.history.length > 0) {
      this.transport.resume()
    }

    // Bootstrap from DB if nothing was persisted (first-ever load)
    if (!this.bootstrapped) {
      await this.bootstrapFromDB()
    }

    this.updateState(this.transport.isAvailable() ? 'idle' : 'no-transport')

    // Subscribe to graph table changes (conversations table)
    this.unsubGraphEvents = graphEventBus.on('graph:tables:changed', (payload) => {
      if (payload.tables.includes('conversations')) {
        this.onConversationsChanged()
      }
    })

    // Bridge streaming text from Chrome extension → eventBus
    this.streamHandler = ((e: CustomEvent) => {
      const { conversationId, text } = e.detail || {}
      if (conversationId === this.chatSessionId && text) {
        eventBus.emit('interview:stream', { text, conversationId })
      }
    }) as EventListener
    window.addEventListener('ramble:ext:conversation-stream', this.streamHandler)
  }

  stop(): void {
    log.info('Stopping')
    this.unsubGraphEvents?.()
    this.unsubGraphEvents = null
    if (this.streamHandler) {
      window.removeEventListener('ramble:ext:conversation-stream', this.streamHandler)
      this.streamHandler = null
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }

  /** Swap transport at runtime (e.g. when user changes plan/settings) */
  setTransport(transport: InterviewTransport): void {
    log.info('Switching transport to:', transport.name)
    this.transport = transport
    this.updateState(transport.isAvailable() ? 'idle' : 'no-transport')
  }

  getTransportName(): string {
    return this.transport.name
  }

  getState(): InterviewState {
    return this.state
  }

  getLastQuestion(): InterviewQuestion | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null
  }

  getHistory(): InterviewQuestion[] {
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

  /** Retry sending all pending conversations. Called by widget retry button. */
  retry(): void {
    if (this.state === 'sending') return
    if (this.pending.length === 0) return
    log.info('Retry requested, pending:', this.pending.length)
    this.flush()
  }

  /**
   * Reset the chat session — starts a new ChatGPT conversation.
   * Clears history, pending, and generates a new session ID.
   *
   * @param withContext — if true, bootstraps recent conversations from DB
   *   and immediately flushes them so ChatGPT gets full context on the
   *   first message (system prompt + recent user speech).
   */
  async resetSession(opts?: { withContext?: boolean }): Promise<void> {
    log.info('Resetting chat session', { withContext: !!opts?.withContext })

    this.history = []
    this.pending = []
    this.chatUrl = null
    this.lastProcessedId = null

    // Generate new session ID
    this.chatSessionId = this.generateSessionId()
    profileStorage.setItem(STORAGE_KEY_SESSION_ID, this.chatSessionId)
    profileStorage.removeItem(STORAGE_KEY_CHAT_URL)
    this.saveToStorage()

    // Reset transport for new session
    this.transport.reset()

    // Recreate ChatGPT transport with new session if using default
    if (this.transport instanceof ChatGPTTransport) {
      this.transport = new ChatGPTTransport(this.chatSessionId, null)
    }

    this.updateState(this.transport.isAvailable() ? 'idle' : 'no-transport')
    log.info('New session:', this.chatSessionId)

    // Bootstrap from DB and send immediately so ChatGPT gets context
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
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  // ── Persistence ───────────────────────────────────────────────────

  private loadFromStorage(): void {
    const pending = profileStorage.getJSON<PendingEntry[]>(STORAGE_KEY_PENDING)
    const history = profileStorage.getJSON<InterviewQuestion[]>(STORAGE_KEY_HISTORY)
    const lastId = profileStorage.getItem(STORAGE_KEY_PROCESSED)

    if (pending) this.pending = pending
    if (history) this.history = history
    if (lastId) this.lastProcessedId = lastId

    this.bootstrapped = !!(history || pending || lastId)

    if (this.bootstrapped) {
      log.info('Restored from storage — pending:', this.pending.length, 'history:', this.history.length, 'chatUrl:', this.chatUrl)
    }
  }

  private saveToStorage(): void {
    profileStorage.setJSON(STORAGE_KEY_PENDING, this.pending)
    profileStorage.setJSON(STORAGE_KEY_HISTORY, this.history)
    if (this.lastProcessedId) {
      profileStorage.setItem(STORAGE_KEY_PROCESSED, this.lastProcessedId)
    }
  }

  /**
   * First-ever boot: load recent user conversations from DB into the
   * pending queue so the first send has context.
   */
  private async bootstrapFromDB(): Promise<void> {
    try {
      const recent = await conversationStore.getRecent(10)
      const userConvs = recent
        .filter(c => c.speaker === 'user' && c.source === 'text' && c.raw_text.trim().length >= 3)
        .reverse() // oldest first

      if (userConvs.length > 0) {
        this.pending = userConvs.map(c => ({
          conversationId: c.id,
          rawText: c.raw_text,
          timestamp: c.created_at,
        }))
        this.lastProcessedId = userConvs[userConvs.length - 1].id
        this.bootstrapped = true
        this.saveToStorage()
        log.info('Bootstrapped from DB:', this.pending.length, 'conversations')
      } else {
        this.bootstrapped = true
        this.saveToStorage()
      }
    } catch (err) {
      log.error('Bootstrap from DB failed:', err)
      this.bootstrapped = true // don't retry bootstrap
    }
  }

  // ── Event handling ────────────────────────────────────────────────

  private updateState(newState: InterviewState): void {
    if (this.state === newState) return
    this.state = newState
    eventBus.emit('interview:state', { state: newState })
  }

  private onConversationsChanged(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.enqueueLatest()
    }, DEBOUNCE_MS)
  }

  /**
   * Check for new user conversations and add to pending queue,
   * then attempt to flush.
   */
  private async enqueueLatest(): Promise<void> {
    try {
      const recent = await conversationStore.getRecent(1)
      if (recent.length === 0) return

      const latest = recent[0]

      // Skip if already seen
      if (latest.id === this.lastProcessedId) return
      // Skip if already in pending queue
      if (this.pending.some(p => p.conversationId === latest.id)) return
      // Skip if not user speech
      if (latest.speaker !== 'user') return
      // Skip very short text
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

  /**
   * Send all pending conversations as a single batched prompt to the transport.
   * On success, clears the pending queue. On failure, queue is preserved for retry.
   */
  private async flush(): Promise<void> {
    if (!this.transport.isAvailable()) {
      this.updateState('no-transport')
      return
    }
    if (this.state === 'sending') return
    if (this.pending.length === 0) return

    this.updateState('sending')

    // Build a combined prompt from all pending conversations.
    // Single item (normal flow): just the raw text — no brackets, no time.
    // Multiple items (bootstrap/batch): numbered with relative time for context.
    const now = Date.now()
    const combined = this.pending.length === 1
      ? this.pending[0].rawText
      : this.pending.map((p, i) => `[${i + 1} · ${timeAgo(now - p.timestamp)}] "${p.rawText}"`).join('\n\n')

    log.info('Flushing', this.pending.length, 'pending conversations to', this.transport.name)

    try {
      const result = await this.transport.send(combined)
      log.info('Got question:', result.question)

      // Update chatUrl if reported back
      if (result.chatUrl && result.chatUrl !== this.chatUrl) {
        this.chatUrl = result.chatUrl
        profileStorage.setItem(STORAGE_KEY_CHAT_URL, result.chatUrl)
        log.info('Chat URL updated:', result.chatUrl)
      }

      // Success — clear pending, record question
      this.pending = []

      const entry: InterviewQuestion = {
        question: result.question,
        timestamp: Date.now(),
      }
      this.history.push(entry)
      this.saveToStorage()

      // Store question as a conversation record so it appears in the unified thread
      try {
        const conv = await conversationStore.create({
          sessionId: this.chatSessionId,
          rawText: result.question,
          source: 'interview',
          speaker: 'interviewer',
          intent: 'question',
        })
        // Mark processed immediately — no extraction needed on interview questions
        await conversationStore.markProcessed(conv.id)
      } catch (err) {
        log.error('Failed to store interview question in DuckDB:', err)
      }

      eventBus.emit('interview:question', entry)
      if (entry.question) {
        eventBus.emit('tts:speak', { text: entry.question })
      }
      this.updateState('idle')
    } catch (err) {
      log.error('Transport error:', err)
      // Pending is preserved — can be retried
      this.saveToStorage()
      this.updateState('error')
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Humanized relative time from a duration in ms. */
function timeAgo(ms: number): string {
  const sec = Math.round(ms / 1000)
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
}
