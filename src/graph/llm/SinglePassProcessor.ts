/**
 * SinglePassProcessor — The New Extraction Pipeline
 *
 * Replaces the old multi-step pipeline (normalize → extract → save → tree → timeline)
 * with a single LLM conversation that produces a KG subset.
 *
 * Flow:
 * 1. Format new conversations into a batch
 * 2. Get working context (relevance-decayed entities/memories)
 * 3. Build append-only conversation (system prompt + history + new batch)
 * 4. Call LLM
 * 5. If LLM requests search → query DuckDB → inject results → re-call LLM
 * 6. Parse KG subset from response
 * 7. Return KGSubset for merge (Phase 8)
 */

import { callLLM } from '../../program/llmClient'
import { parseLLMJSON } from '../../program/utils/jsonUtils'
import { createLogger } from '../../program/utils/logger'
import { ConversationManager } from './ConversationManager'
import { buildSystemPrompt } from './SystemPrompt'
import { getTransportConfig } from './transportConfig'
import type { ConversationMessage } from './ConversationManager'
import type { WorkingContextWindow } from '../context/WorkingContextWindow'
import type { GraphService } from '../GraphService'
import type { KGSubset } from '../types'

const logger = createLogger('SinglePassProcessor')

const MAX_SEARCH_LOOPS = 2

export interface ProcessBatchInput {
  /** Raw text inputs in this batch */
  conversations: Array<{
    id: string
    rawText: string
    source: string
    speaker: string
  }>
  /** Intent classified from normalization (inform, correct, retract, etc.) */
  intent?: string
  /** Recording ID for provenance tracking */
  recordingId?: string
}

export interface ProcessBatchResult {
  subset: KGSubset
  searchLoops: number
  rawResponse: string
}

export class SinglePassProcessor {
  private conversationMgr: ConversationManager | null = null
  private graph: GraphService
  private workingContext: WorkingContextWindow

  constructor(graph: GraphService, workingContext: WorkingContextWindow) {
    this.graph = graph
    this.workingContext = workingContext
  }

  /**
   * Process a batch of conversations through a single LLM pass.
   */
  async processBatch(input: ProcessBatchInput): Promise<ProcessBatchResult> {
    const config = getTransportConfig()

    // Skip query intents — no knowledge to extract
    if (input.intent === 'query') {
      logger.info('Query intent detected, skipping extraction')
      return {
        subset: { nodes: [], edges: [], topics: [], goals: [], corrections: [], retractions: [] },
        searchLoops: 0,
        rawResponse: '',
      }
    }

    // Initialize or reuse conversation manager
    if (!this.conversationMgr) {
      this.conversationMgr = new ConversationManager({
        maxChars: config.maxContextChars,
        systemPrompt: buildSystemPrompt(input.intent),
      })
    }

    // Check if compaction needed before adding new batch
    if (this.conversationMgr.needsCompaction()) {
      await this.conversationMgr.compact(async (messages) => {
        // Summarize old messages using a small LLM call
        const allText = messages.map(m => `${m.role}: ${m.content}`).join('\n\n')
        const result = await callLLM({
          tier: 'small',
          prompt: `Summarize this conversation history in 2-3 paragraphs, preserving key entities, relationships, and facts:\n\n${allText.slice(0, 5000)}`,
          systemPrompt: 'You are a summarizer. Be concise but preserve all important knowledge graph elements.',
          category: 'kg-compaction',
          options: { temperature: 0.1, max_tokens: 500 },
        })
        return result.content
      })
    }

    // Format conversations into a single text block
    const conversationText = input.conversations
      .map(c => {
        const prefix = c.speaker !== 'user' ? `[${c.speaker}] ` : ''
        return `${prefix}${c.rawText}`
      })
      .join('\n\n')

    // Get working context
    const contextBlock = await this.workingContext.getContextBlock()

    // Append batch to conversation
    this.conversationMgr.appendBatch({
      conversations: conversationText,
      workingContext: contextBlock,
      systemReminder: `Current time: ${new Date().toISOString()}`,
    })

    // Call LLM
    let searchLoops = 0
    let rawResponse = ''

    const messages = this.conversationMgr.getMessages()
    const result = await callLLM({
      tier: config.tier,
      prompt: messages[messages.length - 1].content,
      systemPrompt: messages[0].content,
      category: 'kg-extraction-v2',
      options: {
        temperature: 0.3,
        max_tokens: config.maxOutputTokens,
      },
    })
    rawResponse = result.content

    // Search-and-inject loop
    let parsed = this.parseResponse(rawResponse)

    while (parsed.search && searchLoops < MAX_SEARCH_LOOPS) {
      searchLoops++
      logger.info('LLM requested search', { query: parsed.search.query, type: parsed.search.type })

      // Execute search against DuckDB
      const searchResults = await this.handleSearchRequest(parsed.search)

      // Inject results back into conversation
      const messages = this.conversationMgr.getMessages()
      const lastUserMsg = [...messages].reverse().find((m: ConversationMessage) => m.role === 'user')
      if (lastUserMsg) {
        this.conversationMgr.replaceLastUserMessage(
          lastUserMsg.content + `\n\n## Search Results for "${parsed.search.query}"\n${searchResults}\n\nNow extract entities, memories, topics, goals from the New Input above. Respond with JSON only.`
        )
      }

      // Re-call LLM
      const updatedMessages = this.conversationMgr.getMessages()
      const searchResult = await callLLM({
        tier: config.tier,
        prompt: updatedMessages[updatedMessages.length - 1].content,
        systemPrompt: updatedMessages[0].content,
        category: 'kg-extraction-v2-search',
        options: {
          temperature: 0.3,
          max_tokens: config.maxOutputTokens,
        },
      })
      rawResponse = searchResult.content
      parsed = this.parseResponse(rawResponse)
    }

    // Save response to conversation history (becomes cached for next batch)
    this.conversationMgr.appendResponse(rawResponse)

    // Extract KG subset
    const subset = parsed.subset ?? {
      nodes: [],
      edges: [],
      topics: [],
      goals: [],
      corrections: [],
      retractions: [],
    }

    // Touch mentioned entities in working context
    for (const node of subset.nodes) {
      if (node.labels.includes('entity')) {
        this.workingContext.touch(node.tempId, 0.3)
      }
    }

    return { subset, searchLoops, rawResponse }
  }

  /**
   * Parse LLM response — either a KG subset or a search request.
   */
  private parseResponse(raw: string): {
    subset?: KGSubset
    search?: { query: string; type: 'entity' | 'topic' }
  } {
    const { data, error } = parseLLMJSON<Record<string, unknown>>(raw)

    if (error || !data) {
      logger.warn('Failed to parse LLM response', { error, raw: raw.slice(0, 200) })
      return { subset: { nodes: [], edges: [], topics: [], goals: [], corrections: [], retractions: [] } }
    }

    // Check for search request
    if (data.search && typeof data.search === 'object') {
      const search = data.search as Record<string, unknown>
      if (typeof search.query === 'string') {
        return {
          search: {
            query: search.query,
            type: (search.type as 'entity' | 'topic') ?? 'entity',
          },
        }
      }
    }

    // Parse as KG subset
    return {
      subset: {
        nodes: Array.isArray(data.nodes) ? (data.nodes as KGSubset['nodes']) : [],
        edges: Array.isArray(data.edges) ? (data.edges as KGSubset['edges']) : [],
        topics: Array.isArray(data.topics) ? (data.topics as string[]) : [],
        goals: Array.isArray(data.goals) ? (data.goals as KGSubset['goals']) : [],
        corrections: Array.isArray(data.corrections) ? (data.corrections as KGSubset['corrections']) : [],
        retractions: Array.isArray(data.retractions) ? (data.retractions as string[]) : [],
      },
    }
  }

  /**
   * Handle a search request from the LLM.
   * Queries DuckDB graph for matching nodes and formats results.
   */
  private async handleSearchRequest(
    request: { query: string; type: 'entity' | 'topic' }
  ): Promise<string> {
    const terms = request.query.split(/\s+/).filter(w => w.length > 1)
    if (terms.length === 0) return '(no results)'

    // Search nodes by label and name substring
    const label = request.type === 'entity' ? 'entity' : 'topic'
    const searchPattern = `%${terms.join('%')}%`

    const nodes = await this.graph.query<{
      id: string
      labels: string[]
      properties: string
    }>(
      `SELECT id, labels, properties FROM nodes
       WHERE list_contains(labels, $1)
       AND LOWER(CAST(properties AS VARCHAR)) LIKE LOWER($2)
       ORDER BY updated_at DESC
       LIMIT 20`,
      [label, searchPattern]
    )

    if (nodes.length === 0) return '(no results)'

    return nodes.map(n => {
      const props = typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties
      const name = (props as Record<string, unknown>).name ?? n.id
      const desc = (props as Record<string, unknown>).description ?? (props as Record<string, unknown>).content ?? ''
      const truncDesc = typeof desc === 'string' && desc.length > 100 ? desc.slice(0, 100) + '...' : desc
      return `- [${n.id}] ${name}: ${truncDesc}`
    }).join('\n')
  }

  /**
   * Reset for a new session (clears conversation history).
   */
  reset(): void {
    this.conversationMgr = null
  }
}
