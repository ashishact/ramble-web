/**
 * Timeline Extraction — LLM-powered historian that synthesizes meaningful events
 * from raw memories.
 *
 * Single-turn LLM call (simpler than tree curation's multi-turn loop):
 * 1. Load memories + entities + recent existing timeline events
 * 2. Build short ID map
 * 3. Single LLM call with historian prompt
 * 4. Parse response, resolve short IDs, apply actions
 */

import { callLLM } from '../llmClient'
import { parseLLMJSON } from '../utils/jsonUtils'
import { entityStore, memoryStore, timelineEventStore } from '../../db/stores'
import { createShortIdMap, addMapping } from '../knowledgeTree/shortIdMap'
import { TIMELINE_SYSTEM_PROMPT, buildTimelineUserPrompt } from './timelinePrompt'
import { resolveTimelineShortIds } from './resolveIds'
import { applyTimelineActions } from './applyActions'
import type { TimelineAction, TimelineResponse } from './types'
import type { Intent } from '../types/recording'
import { createLogger } from '../utils/logger'

const logger = createLogger('TimelineExtractor')

/**
 * Extract timeline events from a set of memories.
 *
 * Called as a background task after System II extraction completes.
 * Does NOT block the main processing pipeline.
 */
export async function extractTimeline(params: {
  memoryIds: string[]
  entityIds: string[]
  conversationContext: string
  intent: Intent
}): Promise<TimelineAction[]> {
  const { memoryIds, entityIds, conversationContext, intent } = params

  // Step 1: Load memories
  const memories = (await Promise.all(
    memoryIds.map(id => memoryStore.getById(id))
  )).filter((m): m is NonNullable<typeof m> => m !== null)

  if (memories.length === 0) {
    logger.info('No memories to process, skipping timeline extraction')
    return []
  }

  // Step 2: Load entities
  const entities = (await Promise.all(
    entityIds.map(id => entityStore.getById(id))
  )).filter((e): e is NonNullable<typeof e> => e !== null)

  // Step 3: Load recent existing timeline events for dedup context
  // Get recent events + events related to mentioned entities, deduplicated
  const recentEvents = await timelineEventStore.getRecent(30)
  const entityEventSets = await Promise.all(
    entityIds.map(id => timelineEventStore.getByEntity(id))
  )

  const seenIds = new Set(recentEvents.map(e => e.id))
  const allEvents = [...recentEvents]
  for (const entityEvents of entityEventSets) {
    for (const event of entityEvents) {
      if (!seenIds.has(event.id)) {
        seenIds.add(event.id)
        allEvents.push(event)
      }
    }
  }
  // Cap at 30 to keep prompt manageable
  const existingEvents = allEvents.slice(0, 30)

  // Step 4: Build short ID map
  const idMap = createShortIdMap()

  for (const entity of entities) {
    addMapping(idMap, entity.id, 'e')
  }
  for (const mem of memories) {
    addMapping(idMap, mem.id, 'm')
  }
  for (const event of existingEvents) {
    addMapping(idMap, event.id, 't')
  }

  // Step 5: Build prompt
  const currentTime = new Date().toISOString()
  const userPrompt = buildTimelineUserPrompt({
    intent,
    currentTime,
    entities: entities.map(e => ({ id: e.id, name: e.name, type: e.type })),
    existingEvents,
    memories: memories.map(m => ({
      id: m.id,
      content: m.content,
      type: m.type,
      validFrom: m.validFrom ?? undefined,
    })),
    conversationContext,
    idMap,
  })

  // Step 6: Single LLM call
  let response: TimelineResponse
  try {
    const llmResult = await callLLM({
      tier: 'medium',
      prompt: userPrompt,
      systemPrompt: TIMELINE_SYSTEM_PROMPT,
      options: {
        temperature: 0.3,
      },
    })

    const { data, error } = parseLLMJSON<TimelineResponse>(llmResult.content)
    if (error || !data) {
      logger.warn('Failed to parse timeline response', { error, raw: llmResult.content.slice(0, 200) })
      return []
    }

    response = {
      actions: Array.isArray(data.actions) ? data.actions : [],
    }
  } catch (error) {
    logger.error('LLM call failed during timeline extraction', {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }

  if (response.actions.length === 0) {
    logger.info('No timeline actions returned')
    return []
  }

  // Step 7: Resolve short IDs -> real IDs
  const resolvedActions = response.actions.map(action => resolveTimelineShortIds(action, idMap))

  // Step 8: Apply actions to DB
  const applied = await applyTimelineActions(resolvedActions)

  logger.info('Timeline extraction complete', {
    actionsReturned: response.actions.length,
    actionsApplied: applied,
  })

  return resolvedActions
}
