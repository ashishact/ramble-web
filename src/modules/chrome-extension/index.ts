/**
 * Ramble Chrome Extension Bridge
 *
 * Usage:
 *   import { rambleExt } from '@/modules/chrome-extension'
 *
 *   // Check if extension is available
 *   const status = await rambleExt.ping()
 *
 *   // Send goals to ChatGPT for analysis
 *   const response = await rambleExt.aiQuery({
 *     target: "chatgpt",
 *     dataFn: "exportGoals",
 *     prompt: "Analyze these goals and suggest priorities"
 *   })
 *   console.log(response.answer)
 *
 *   // Send raw prompt
 *   const raw = await rambleExt.aiRaw({
 *     target: "chatgpt",
 *     prompt: "What are the best productivity frameworks?"
 *   })
 */

import type {
  AiQueryOptions,
  AiRawOptions,
  AiConversationOptions,
  AiResponse,
  AiConversationResponse,
  ExtensionStatus,
} from "./protocol"

import { getExtensionEnabled } from '../../lib/serviceToggles'

export type { AiQueryOptions, AiRawOptions, AiConversationOptions, AiResponse, AiConversationResponse, ExtensionStatus }
export type { AiTarget } from "./protocol"

let lastHeartbeat = 0
let extensionVersion = ""
let previousAvailable = false
const HEARTBEAT_STALE_MS = 5000

type AvailabilityCallback = (available: boolean) => void
const availabilityCallbacks = new Set<AvailabilityCallback>()

function updateHeartbeat(version: string): void {
  lastHeartbeat = Date.now()
  extensionVersion = version
}

// Listen for ext_ready + heartbeat from content script
window.addEventListener("message", (event) => {
  if (event.source !== window) return
  const data = event.data
  if (data?.source !== "ramble-ext") return

  if (data.type === "ext_ready" || data.type === "heartbeat") {
    updateHeartbeat(data.payload?.version || "")
    if (data.type === "ext_ready") {
      console.log("[ramble-ext] Extension detected, version:", extensionVersion)
    }
  }
})

// Poll availability transitions every 3 seconds (uses gated getter so
// disabling the toggle is reflected in availability callbacks)
setInterval(() => {
  const currentAvailable = rambleExt.isAvailable
  if (currentAvailable !== previousAvailable) {
    previousAvailable = currentAvailable
    console.log("[ramble-ext] Availability changed:", currentAvailable)
    for (const cb of availabilityCallbacks) {
      try { cb(currentAvailable) } catch {}
    }
  }
}, 3000)

import { nid } from '../../program/utils/id'

function generateRequestId(): string {
  return nid.request()
}

function sendAndWait<T>(type: string, payload: unknown, timeoutMs = 120000): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = generateRequestId()
    const responseType = `${type}_response`
    const errorType = `${type}_error`

    const timer = setTimeout(() => {
      window.removeEventListener("message", handler)
      reject(new Error(`Timeout waiting for ${responseType} (${timeoutMs}ms)`))
    }, timeoutMs)

    function handler(event: MessageEvent) {
      if (event.source !== window) return
      const data = event.data
      if (data?.source !== "ramble-ext") return
      if (data.requestId !== requestId) return

      if (data.type === responseType) {
        clearTimeout(timer)
        window.removeEventListener("message", handler)
        resolve(data.payload as T)
      } else if (data.type === errorType) {
        clearTimeout(timer)
        window.removeEventListener("message", handler)
        reject(new Error(data.payload?.error || "Unknown error"))
      }
    }

    window.addEventListener("message", handler)

    window.postMessage({
      source: "ramble-web",
      type,
      requestId,
      payload,
    }, "*")
  })
}

export const rambleExt = {
  /** Whether the extension is actively present and enabled */
  get isAvailable(): boolean {
    if (!getExtensionEnabled()) return false
    return lastHeartbeat > 0 && (Date.now() - lastHeartbeat) < HEARTBEAT_STALE_MS
  },

  /** Extension version (empty string if not detected yet) */
  get version(): string {
    return extensionVersion
  },

  /**
   * Subscribe to availability transitions (available ↔ unavailable).
   * @returns unsubscribe function
   */
  onAvailabilityChange(cb: AvailabilityCallback): () => void {
    availabilityCallbacks.add(cb)
    return () => { availabilityCallbacks.delete(cb) }
  },

  /**
   * Ping the extension to check status.
   * Returns extension version and WebSocket connection status.
   */
  async ping(): Promise<ExtensionStatus> {
    return sendAndWait<ExtensionStatus>("ping", {}, 5000)
  },

  /**
   * Extract data from window.ramble.* and send it to an AI for analysis.
   *
   * The content script will:
   * 1. Call window.ramble[dataFn]() if dataFn is specified
   * 2. Build a prompt with the data
   * 3. Send it to the target AI (ChatGPT, Claude)
   * 4. Return the AI's response
   */
  async aiQuery(options: AiQueryOptions): Promise<AiResponse> {
    return sendAndWait<AiResponse>("ai_query", options)
  },

  /**
   * Send a raw prompt to an AI without any ramble data.
   */
  async aiRaw(options: AiRawOptions): Promise<AiResponse> {
    return sendAndWait<AiResponse>("ai_raw", options)
  },

  /**
   * Send a prompt in a named persistent ChatGPT conversation.
   * Same conversationId reuses the same ChatGPT conversation tab (full history preserved).
   * System prompt is only sent on the first message.
   */
  async aiConversation(options: AiConversationOptions): Promise<AiConversationResponse> {
    return sendAndWait<AiConversationResponse>("ai_conversation", options)
  },

  /**
   * Close a ChatGPT tab by its conversation URL (fire-and-forget).
   * Called after SYS-I session reset or SYS-II extraction completes.
   */
  closeTab(chatUrl: string): void {
    window.postMessage({
      source: "ramble-web",
      type: "close_tab",
      requestId: generateRequestId(),
      payload: { chatUrl },
    }, "*")
  },


  /**
   * Subscribe to chatUrl updates pushed from the extension when a conversation's
   * ChatGPT tab URL is discovered or changes (via heartbeat).
   * Each caller gets updates only for its own conversationId — SYS-I and SYS-II
   * never see each other's URLs.
   *
   * @returns unsubscribe function
   */
  onConversationUrl(
    conversationId: string,
    callback: (chatUrl: string) => void,
  ): () => void {
    const handler = (e: Event) => {
      const { conversationId: id, chatUrl } = (e as CustomEvent).detail
      if (id === conversationId) callback(chatUrl)
    }
    window.addEventListener('ramble:ext:conversation-url', handler)
    return () => window.removeEventListener('ramble:ext:conversation-url', handler)
  },
}
