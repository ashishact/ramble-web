/**
 * Ramble Chrome Extension Protocol
 *
 * This module handles communication between RAMBLE-WEB and RAMBLE-EXT
 * via window.postMessage. The Chrome extension injects a content script
 * on ramble-web pages that bridges messages to the extension background.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * AVAILABLE PROTOCOLS
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 1. PING — Check if extension is installed and connected
 *    Request:  { source: "ramble-web", type: "ping", requestId, payload: {} }
 *    Response: { source: "ramble-ext", type: "ping_response", requestId,
 *                payload: { version: "0.1.0", wsConnected: true } }
 *
 * 2. AI_QUERY — Extract data from window.ramble.* and send to an AI
 *    Request:  { source: "ramble-web", type: "ai_query", requestId,
 *                payload: {
 *                  target: "chatgpt" | "claude",
 *                  dataFn: "exportGoals",       // window.ramble fn to call
 *                  dataFnArgs: [],               // optional args
 *                  data: null,                   // OR pass pre-fetched data
 *                  prompt: "Analyze these goals"
 *                }}
 *    Response: { source: "ramble-ext", type: "ai_query_response", requestId,
 *                payload: { target, answer: "...", format: "markdown" } }
 *    Error:    { source: "ramble-ext", type: "ai_query_error", requestId,
 *                payload: { target, error: "..." } }
 *
 * 3. AI_RAW — Send a raw prompt to AI (no ramble data extraction)
 *    Request:  { source: "ramble-web", type: "ai_raw", requestId,
 *                payload: { target: "chatgpt", prompt: "..." } }
 *    Response: { source: "ramble-ext", type: "ai_raw_response", requestId,
 *                payload: { target, answer: "...", format: "markdown" } }
 *    Error:    { source: "ramble-ext", type: "ai_raw_error", requestId,
 *                payload: { target, error: "..." } }
 *
 * 4. MEETING_STARTED — Notify extension that meeting mode is active
 *    Request:  { source: "ramble-web", type: "meeting_started", requestId,
 *                payload: { mode: "meeting" } }
 *    (fire-and-forget, no response)
 *
 * 5. MEETING_TRANSCRIPT — Send intermediate transcription chunk
 *    Request:  { source: "ramble-web", type: "meeting_transcript", requestId,
 *                payload: {
 *                  text: "...",
 *                  audioType: "mic" | "system",
 *                  timestamp: 1234567890,
 *                  recordingId: "abc"
 *                }}
 *    (fire-and-forget, no response)
 *
 * 6. MEETING_ENDED — Meeting finished, optional full transcript
 *    Request:  { source: "ramble-web", type: "meeting_ended", requestId,
 *                payload: {
 *                  transcript: "You: ... Other: ...",
 *                  segments: [{ source, text, startMs, endMs }]
 *                }}
 *    (fire-and-forget, no response)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * EVENTS (extension → page, no request needed)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * - ext_ready: Fired when content script loads. Payload: { version }
 * - meeting_questions: AI-generated questions during a meeting.
 *     Payload: { questions: string[], basedOnChars: number }
 *
 * ═══════════════════════════════════════════════════════════════════════
 * DATA FLOW EXAMPLE
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   rambleExt.aiQuery({
 *     target: "chatgpt",
 *     dataFn: "exportGoals",
 *     prompt: "Analyze my goals and suggest priorities"
 *   })
 *
 *   Flow:
 *   1. Page posts message → content script
 *   2. Content script calls window.ramble.exportGoals()
 *   3. Content script builds prompt + JSON data
 *   4. Sends to background via chrome.runtime.sendMessage
 *   5. Background opens/reuses ChatGPT tab, types prompt
 *   6. Waits for ChatGPT response, extracts markdown
 *   7. Response flows back: background → content script → page
 */

export type AiTarget = "chatgpt" | "claude"

export interface AiQueryOptions {
  target: AiTarget
  /** window.ramble.* function to call for data */
  dataFn?: string
  /** Arguments for dataFn */
  dataFnArgs?: unknown[]
  /** Pre-fetched data (alternative to dataFn) */
  data?: unknown
  /** The prompt to send along with the data */
  prompt: string
}

export interface AiRawOptions {
  target: AiTarget
  prompt: string
}

export interface AiResponse {
  target: AiTarget
  answer: string
  format: "markdown" | "text"
}

export interface AiConversationOptions {
  /** Chat session ID — same ID reuses same ChatGPT conversation */
  conversationId: string
  /** The prompt to send in this conversation turn */
  prompt: string
  /** System prompt — only used on the first message in the conversation */
  systemPrompt?: string
  /** Known ChatGPT conversation URL — web is source of truth, extension uses this to find the tab */
  chatUrl?: string
  /**
   * Tab resolution strategy passed to the extension.
   * 'reuse' (default): find/reuse an existing ChatGPT tab — for SYS-I ongoing conversations.
   * 'new': always open a fresh tab — for SYS-II extraction runs that must be isolated.
   */
  tabMode?: 'reuse' | 'new'
  /**
   * Read-only mode: open the tab and read the last assistant message
   * WITHOUT sending a new prompt. Used for resume — the response is
   * already in the conversation DOM from a previous run.
   */
  readOnly?: boolean
}

export interface AiConversationResponse {
  conversationId: string
  answer: string
  format: "markdown" | "text"
  sendCount: number
  /** ChatGPT conversation URL (e.g. https://chatgpt.com/c/69b35eb0-...) — reported back after first send */
  chatUrl: string | null
}

export interface ExtensionStatus {
  version: string
  wsConnected: boolean
}
