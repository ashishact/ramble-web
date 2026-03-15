/**
 * InterviewEngine (SYS-I) — Pipes user speech into a persistent AI conversation
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
 * Transports:
 *   - ChatGPTTransport: Chrome extension → ChatGPT tab (history maintained by ChatGPT)
 *   - LLMApiTransport: Direct API call via callLLM() tier system
 */

import { conversationStore } from '../../graph/stores/conversationStore'
import { graphEventBus } from '../../graph/events/EventBus'
import { eventBus } from '../../lib/eventBus'
import { profileStorage } from '../../lib/profileStorage'
import { createLogger } from '../../program/utils/logger'
import type { InterviewTransport, UserIntent, SysISearchRequest } from './transports'
import { ChatGPTTransport } from './transports'

const log = createLogger('InterviewEngine')

export type InterviewState = 'idle' | 'sending' | 'error' | 'no-transport'

export interface InterviewQuestion {
  /** What was spoken to the user */
  response: string
  /** Isolated question text for ASSERT/EXPLORE (same as response). Null for QUERY/CORRECT etc. */
  question: string | null
  intent: UserIntent
  topic: string
  timestamp: number
}

interface PendingEntry {
  conversationId: string
  rawText: string
  timestamp: number
}

const DEBOUNCE_MS = 1000
const MAX_SEARCH_ROUNDS = 2

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
    this.chatSessionId = this.loadOrCreateSessionId()
    this.chatUrl = profileStorage.getItem(STORAGE_KEY_CHAT_URL)
    this.transport = transport ?? new ChatGPTTransport(this.chatSessionId, this.chatUrl)
  }

  async start(): Promise<void> {
    if (this.unsubGraphEvents) return

    log.info('Starting with transport:', this.transport.name, 'session:', this.chatSessionId)

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

  retry(): void {
    if (this.state === 'sending') return
    if (this.pending.length === 0) return
    log.info('Retry requested, pending:', this.pending.length)
    this.flush()
  }

  async resetSession(opts?: { withContext?: boolean }): Promise<void> {
    log.info('Resetting chat session', { withContext: !!opts?.withContext })

    this.history = []
    this.pending = []
    this.chatUrl = null
    this.lastProcessedId = null

    this.chatSessionId = this.generateSessionId()
    profileStorage.setItem(STORAGE_KEY_SESSION_ID, this.chatSessionId)
    profileStorage.removeItem(STORAGE_KEY_CHAT_URL)
    this.saveToStorage()

    this.transport.reset()

    if (this.transport instanceof ChatGPTTransport) {
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
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  }

  // ── Persistence ──────────────────────────────────────────────────

  private loadFromStorage(): void {
    const pending = profileStorage.getJSON<PendingEntry[]>(STORAGE_KEY_PENDING)
    const rawHistory = profileStorage.getJSON<unknown[]>(STORAGE_KEY_HISTORY)
    const lastId = profileStorage.getItem(STORAGE_KEY_PROCESSED)

    if (pending) this.pending = pending
    if (rawHistory) this.history = rawHistory.map(migrateHistoryEntry)
    if (lastId) this.lastProcessedId = lastId

    this.bootstrapped = !!(rawHistory || pending || lastId)

    if (this.bootstrapped) {
      log.info('Restored from storage — pending:', this.pending.length, 'history:', this.history.length)
    }
  }

  private saveToStorage(): void {
    profileStorage.setJSON(STORAGE_KEY_PENDING, this.pending)
    profileStorage.setJSON(STORAGE_KEY_HISTORY, this.history)
    if (this.lastProcessedId) {
      profileStorage.setItem(STORAGE_KEY_PROCESSED, this.lastProcessedId)
    }
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
        this.bootstrapped = true
        this.saveToStorage()
        log.info('Bootstrapped from DB:', this.pending.length, 'conversations')
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

    this.updateState('sending')

    const now = Date.now()
    const combined = this.pending.length === 1
      ? this.pending[0].rawText
      : this.pending.map((p, i) => `[${i + 1} · ${timeAgo(now - p.timestamp)}] "${p.rawText}"`).join('\n\n')

    log.info('Flushing', this.pending.length, 'pending to', this.transport.name)

    try {
      // Initial send
      let result = await this.transport.send(combined)

      // Search round-trips — LLM may request graph context before responding
      let searchRounds = 0
      while (result.search && searchRounds < MAX_SEARCH_ROUNDS) {
        log.info('LLM requesting search:', result.search)
        const searchText = await this.runGraphSearch(result.search)
        result = await this.transport.injectContext(`<search-res>\n${searchText}\n</search-res>`)
        searchRounds++
      }

      // If still requesting search after max rounds, fall back
      if (result.search) {
        log.warn('Exceeded max search rounds, falling back')
        result = {
          intent: 'QUERY',
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

      const entry: InterviewQuestion = {
        response,
        question: result.question,
        intent: result.intent,
        topic: result.topic,
        timestamp: Date.now(),
      }
      this.history.push(entry)
      this.saveToStorage()

      // Store in conversation DB so it appears in the unified thread
      try {
        const conv = await conversationStore.create({
          sessionId: this.chatSessionId,
          rawText: response,
          source: 'interview',
          speaker: 'sys1',
          intent: result.intent.toLowerCase(),
        })
        await conversationStore.markProcessed(conv.id)
      } catch (err) {
        log.error('Failed to store SYS-I response in DuckDB:', err)
      }

      eventBus.emit('interview:question', entry)
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

  // ── Graph Search ─────────────────────────────────────────────────

  /**
   * Run a semantic search on the knowledge graph.
   * Used during search round-trips when SYS-I requests context.
   */
  private async runGraphSearch(req: SysISearchRequest): Promise<string> {
    try {
      const [{ getGraphService }, { EmbeddingService }, { VectorSearch }] = await Promise.all([
        import('../../graph'),
        import('../../graph/embeddings/EmbeddingService'),
        import('../../graph/embeddings/VectorSearch'),
      ])

      const graph = await getGraphService()
      const embeddings = new EmbeddingService(graph)
      const vs = new VectorSearch(graph, embeddings)

      const labelFilter = req.type === 'entity' ? 'entity'
        : req.type === 'goal' ? 'goal'
        : 'memory'

      const results = await vs.searchByText(req.query, 5, labelFilter)

      if (results.length === 0) {
        return `No ${req.type} results found for: "${req.query}"`
      }

      return results.map(r => {
        const props = r.node.properties as Record<string, unknown>
        const content = props.content ?? props.name ?? props.title ?? r.node.id
        const score = r.similarity.toFixed(2)
        return `[${req.type}] ${String(content)} (relevance: ${score})`
      }).join('\n')
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
 * Migrate old-format history entries ({ question: string, timestamp: number })
 * to the new shape ({ response, question, intent, topic, timestamp }).
 */
function migrateHistoryEntry(raw: unknown): InterviewQuestion {
  const entry = raw as Record<string, unknown>
  if (entry.response) {
    return entry as unknown as InterviewQuestion
  }
  // Old format
  const text = (entry.question as string) ?? ''
  return {
    response: text,
    question: text,
    intent: 'ASSERT',
    topic: 'general',
    timestamp: (entry.timestamp as number) ?? Date.now(),
  }
}
