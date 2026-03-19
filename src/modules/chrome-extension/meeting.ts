/**
 * Meeting Mode — Chrome Extension Bridge
 *
 * Listens to eventBus for meeting events and forwards them to the
 * chrome extension via window.postMessage → content script → background.
 *
 * The background script accumulates transcript chunks and periodically
 * asks ChatGPT to generate smart questions for the meeting.
 *
 * Usage:
 *   import { initMeetingBridge, onMeetingQuestions } from '@/modules/chrome-extension/meeting'
 *
 *   // Start listening (call once, e.g. in app init or when extension is detected)
 *   const cleanup = initMeetingBridge(eventBus)
 *
 *   // Listen for AI-generated questions
 *   const off = onMeetingQuestions((questions) => {
 *     console.log("Suggested questions:", questions)
 *   })
 *
 * Events consumed from eventBus:
 *   - native:mode-changed          → meeting_started / meeting_ended
 *   - native:transcription-intermediate → batched → meeting_transcript (every 15s or 300+ chars)
 *   - native:meeting-transcript-complete → meeting_ended (with full transcript)
 *   - native:recording-ended       → meeting_ended (fallback)
 *
 * Events received from extension:
 *   - meeting_questions → { questions: string[], basedOnChars: number }
 */

import { nid } from '../../program/utils/id'

type EventBus = {
  on(event: string, handler: (...args: any[]) => void): () => void
}

type QuestionHandler = (questions: string[], basedOnChars: number) => void

let meetingActive = false
let questionHandlers: QuestionHandler[] = []

// ── Transcript batching ──────────────────────────────────────────────
// Instead of forwarding every intermediate transcription fragment immediately,
// we accumulate text and forward in batches. This reduces noisy, tiny messages
// to the extension and lets ChatGPT process meaningful chunks.
const BATCH_INTERVAL_MS = 15_000   // flush every 15s
const BATCH_MIN_CHARS = 300        // or when accumulated text exceeds this
let batchBuffer: Array<{ text: string; audioType: 'mic' | 'system'; ts: number; recordingId?: string }> = []
let batchTimer: ReturnType<typeof setInterval> | null = null

function flushBatch() {
  if (batchBuffer.length === 0) return
  const combined = batchBuffer.map(s => s.text).join(' ')
  const last = batchBuffer[batchBuffer.length - 1]
  post("meeting_transcript", {
    text: combined,
    audioType: last.audioType,
    timestamp: last.ts,
    recordingId: last.recordingId,
  })
  batchBuffer = []
}

function startBatchTimer() {
  if (batchTimer) return
  batchTimer = setInterval(flushBatch, BATCH_INTERVAL_MS)
}

function stopBatchTimer() {
  if (batchTimer) { clearInterval(batchTimer); batchTimer = null }
  flushBatch() // flush remaining on stop
}
// ─────────────────────────────────────────────────────────────────────

function post(type: string, payload: unknown) {
  window.postMessage({
    source: "ramble-web",
    type,
    requestId: nid.request(),
    payload,
  }, "*")
}

/**
 * Initialize the meeting bridge.
 * Subscribes to eventBus events and forwards them to the extension.
 * Returns a cleanup function.
 */
export function initMeetingBridge(eventBus: EventBus): () => void {
  const unsubs: Array<() => void> = []

  // Mode changes
  unsubs.push(eventBus.on("native:mode-changed", (data: { mode: string }) => {
    if (data.mode === "meeting") {
      meetingActive = true
      startBatchTimer()
      post("meeting_started", { mode: "meeting" })
      console.log("[ramble-ext] Meeting started → extension notified")
    } else if (meetingActive) {
      meetingActive = false
      stopBatchTimer()
      post("meeting_ended", { transcript: "", segments: [] })
      console.log("[ramble-ext] Meeting ended (mode switch) → extension notified")
    }
  }))

  // Intermediate transcription — batched instead of forwarded immediately
  unsubs.push(eventBus.on("native:transcription-intermediate", (data: {
    text: string
    audioType: "mic" | "system"
    ts: number
    recordingId?: string
  }) => {
    if (!meetingActive) return
    batchBuffer.push({ text: data.text, audioType: data.audioType, ts: data.ts, recordingId: data.recordingId })
    // Flush early if we've accumulated enough text
    const totalChars = batchBuffer.reduce((sum, s) => sum + s.text.length, 0)
    if (totalChars >= BATCH_MIN_CHARS) {
      flushBatch()
    }
  }))

  // Final meeting transcript (with segments and speaker labels)
  unsubs.push(eventBus.on("native:meeting-transcript-complete", (data: {
    transcript: string
    segments: Array<{ source: string; text: string; startMs: number; endMs: number }>
  }) => {
    meetingActive = false
    stopBatchTimer()
    post("meeting_ended", {
      transcript: data.transcript,
      segments: data.segments,
    })
    console.log("[ramble-ext] Meeting transcript complete → extension notified")
  }))

  // Recording ended (fallback if no meeting-transcript-complete)
  unsubs.push(eventBus.on("native:recording-ended", () => {
    if (!meetingActive) return
    meetingActive = false
    stopBatchTimer()
    post("meeting_ended", { transcript: "", segments: [] })
    console.log("[ramble-ext] Recording ended during meeting → extension notified")
  }))

  // Listen for questions from extension
  const messageHandler = (event: MessageEvent) => {
    if (event.source !== window) return
    const data = event.data
    if (data?.source !== "ramble-ext") return
    if (data.type === "meeting_questions") {
      const { questions, basedOnChars } = data.payload || {}
      if (questions?.length) {
        questionHandlers.forEach(h => h(questions, basedOnChars))
      }
    }
  }
  window.addEventListener("message", messageHandler)

  return () => {
    unsubs.forEach(fn => fn())
    window.removeEventListener("message", messageHandler)
    stopBatchTimer()
    batchBuffer = []
  }
}

/**
 * Register a handler for AI-generated meeting questions.
 * Returns an unsubscribe function.
 */
export function onMeetingQuestions(handler: QuestionHandler): () => void {
  questionHandlers.push(handler)
  return () => {
    questionHandlers = questionHandlers.filter(h => h !== handler)
  }
}
