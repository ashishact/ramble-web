/**
 * ConversationManager — Append-Only LLM Conversation with Caching
 *
 * Manages the message array sent to the LLM. Structure:
 *
 *   TOP (fixed, cached after first send):
 *     - System prompt
 *
 *   MIDDLE (fixed once sent, cached):
 *     - Previous batches (user messages) + LLM responses (assistant messages)
 *
 *   BOTTOM (dynamic, changes each batch):
 *     - New conversations + working context + search results + system reminders
 *
 * The TOP and MIDDLE sections never change once sent, so the LLM provider
 * can cache them (prompt caching). Only the BOTTOM section changes per call.
 *
 * Compaction: When the conversation exceeds a threshold, older MIDDLE messages
 * are summarized and the conversation restarted with a fresh context.
 */

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ConversationManagerConfig {
  maxChars: number
  systemPrompt: string
}

export class ConversationManager {
  private messages: ConversationMessage[] = []
  private config: ConversationManagerConfig
  private totalChars = 0

  constructor(config: ConversationManagerConfig) {
    this.config = config

    // Initialize with system prompt
    this.messages.push({
      role: 'system',
      content: config.systemPrompt,
    })
    this.totalChars = config.systemPrompt.length
  }

  // ==========================================================================
  // Message Management
  // ==========================================================================

  /**
   * Append a new user batch at the bottom of the conversation.
   * This includes: new conversations + working context + search results.
   */
  appendBatch(input: {
    conversations: string
    workingContext: string
    searchResults?: string
    systemReminder?: string
  }): void {
    const sections: string[] = []

    if (input.workingContext) {
      sections.push(`## Working Context\n${input.workingContext}`)
    }

    if (input.searchResults) {
      sections.push(`## Search Results\n${input.searchResults}`)
    }

    sections.push(`## New Input\n${input.conversations}`)

    if (input.systemReminder) {
      sections.push(`## System\n${input.systemReminder}`)
    }

    sections.push('Extract entities, memories, topics, goals, corrections, and retractions from the New Input. Respond with JSON only.')

    const content = sections.join('\n\n')
    this.messages.push({ role: 'user', content })
    this.totalChars += content.length
  }

  /**
   * Append the LLM's response. This becomes cached for future calls.
   */
  appendResponse(response: string): void {
    this.messages.push({ role: 'assistant', content: response })
    this.totalChars += response.length
  }

  /**
   * Replace the last user message (for search-and-inject loop).
   * Used when the LLM requests a search — we inject results and re-send.
   */
  replaceLastUserMessage(content: string): void {
    // Find the last user message
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        this.totalChars -= this.messages[i].content.length
        this.messages[i].content = content
        this.totalChars += content.length
        return
      }
    }
  }

  /**
   * Get the full message array for the LLM call.
   */
  getMessages(): ConversationMessage[] {
    return [...this.messages]
  }

  // ==========================================================================
  // Compaction
  // ==========================================================================

  /**
   * Check if the conversation needs compaction (approaching context limit).
   */
  needsCompaction(): boolean {
    return this.totalChars > this.config.maxChars * 0.8
  }

  /**
   * Compact the conversation by summarizing old batches.
   * The summarize function is called with the middle messages to produce a summary.
   * After compaction, conversation restarts with: system prompt + summary + fresh bottom.
   */
  async compact(summarizeFn: (messages: ConversationMessage[]) => Promise<string>): Promise<void> {
    // Extract middle messages (everything between system prompt and last 2 messages)
    const middleMessages = this.messages.slice(1, -2)

    if (middleMessages.length === 0) return

    // Summarize middle section
    const summary = await summarizeFn(middleMessages)

    // Keep system prompt + summary + last 2 messages (last batch + response)
    const systemMsg = this.messages[0]
    const lastMessages = this.messages.slice(-2)

    this.messages = [
      systemMsg,
      { role: 'user', content: `## Previous Session Summary\n${summary}` },
      { role: 'assistant', content: 'Understood. I have the context from the previous session. Ready for new input.' },
      ...lastMessages,
    ]

    this.totalChars = this.messages.reduce((sum, m) => sum + m.content.length, 0)
  }

  // ==========================================================================
  // State
  // ==========================================================================

  get messageCount(): number {
    return this.messages.length
  }

  get currentChars(): number {
    return this.totalChars
  }

  /**
   * Reset the conversation (for a new session).
   * Keeps the system prompt.
   */
  reset(): void {
    const systemPrompt = this.messages[0]?.content ?? this.config.systemPrompt
    this.messages = [{ role: 'system', content: systemPrompt }]
    this.totalChars = systemPrompt.length
  }
}
