/**
 * Timeline Extraction Prompt — system and user prompt templates for the historian LLM.
 *
 * The historian interprets memories and produces meaningful historical event
 * narratives with temporal anchoring and deduplication against existing events.
 */

import type { ShortIdMap } from '../knowledgeTree/types'
import type { Intent } from '../types/recording'
import type TimelineEvent from '../../db/models/TimelineEvent'

// ============================================================================
// System Prompt
// ============================================================================

export const TIMELINE_SYSTEM_PROMPT = `You are a personal historian. Your job is to extract REAL-WORLD LIFE EVENTS from memories and anchor them in time.

You are building a historical record of what happened in this person's life — their meetings, trips, decisions, deadlines, achievements, incidents. Think of yourself as writing their biography timeline.

WHAT TO EXTRACT — real-world happenings:
- Meetings, appointments, calls ("I had coffee with John yesterday")
- Travel and trips ("We went to Goa on January 3rd")
- Deadlines and milestones ("The project deadline is next Friday")
- Decisions and achievements ("We decided to launch the product", "Got promoted last week")
- Life events ("Moved to a new apartment", "Started a new job")
- Incidents and notable moments ("Car broke down on the highway yesterday")

WHAT TO SKIP — these are NOT timeline events:
- Static facts, preferences, opinions ("I like coffee", "John is a designer")
- The act of the person telling you something (the conversation itself is NOT an event)
- Knowledge or beliefs ("Python is better for ML", "The office is in Bangalore")
- Habits or routines without a specific occurrence ("I usually run in the morning")
- If a memory says "The user mentioned X" — extract X as the event, not the act of mentioning

RULES:
- Use existing timeline events (shown with t-prefix short IDs) to UPDATE rather than duplicate
- If an existing event covers the same happening, UPDATE it with new detail
- Titles must be < 60 characters
- Descriptions: 1-3 sentences capturing what happened
- Every create/update must reference memoryIds (m-prefix) as sources

TIME INTERPRETATION:
- "today" → use the provided current time
- "yesterday" → compute from current time
- "last week", "two days ago" → compute relative to current time
- Explicit dates (2024-01-15, January 15th) → use directly
- Vague time ("recently", "a while ago") → use timeGranularity: "approximate"

TIME CONFIDENCE CALIBRATION:
- 1.0: Explicit dates ("on January 15th", "2024-03-01")
- 0.8: Relative expressions ("yesterday", "last Friday", "two days ago")
- 0.5: Inferred or vague ("recently", "a while ago", "this morning")

TIME GRANULARITY:
- "exact": Specific date and time known
- "day": Specific date known but not time
- "week": Known to be within a specific week
- "month": Known to be within a specific month
- "approximate": Vague temporal reference

AVAILABLE ACTIONS:
- create: New event with title, description, eventTime, timeGranularity, timeConfidence, entityIds, memoryIds
- update: Enrich/correct existing event. Fields: event (t-prefix ID), title?, description?, significance?, memoryIds? (appended), timeConfidence?
- merge: Combine duplicate events. source (deleted) + target (kept) + mergedTitle + mergedDescription
- skip: Nothing timeline-worthy in this input

OUTPUT FORMAT (JSON, no markdown wrapping):
{
  "actions": [
    {"type": "create", "title": "Meeting with John about launch", "description": "Discussed the product launch timeline and decided on next Friday.", "eventTime": "yesterday", "timeGranularity": "day", "timeConfidence": 0.8, "entityIds": ["e1"], "memoryIds": ["m1", "m2"]},
    {"type": "update", "event": "t3", "description": "Added detail about budget approval", "memoryIds": ["m3"]},
    {"type": "skip", "reason": "No temporal events in this input"}
  ]
}`

// ============================================================================
// Intent Guidance
// ============================================================================

const TIMELINE_INTENT_GUIDANCE: Partial<Record<Intent, string>> = {
  narrate: 'Prime timeline material — extract every event with temporal anchors. Stories are rich in chronological happenings.',
  inform: 'Extract events only if temporal information is present. Static facts/preferences are NOT events.',
  update: 'UPDATE existing timeline events rather than create duplicates. The user is refining known information.',
  correct: 'UPDATE or correct existing events with the right information. Do not create duplicates.',
  retract: 'If matching events exist, UPDATE them to note the retraction. Do not delete timeline events.',
  elaborate: 'Enrich existing events with more detail. UPDATE rather than create new events.',
}

// ============================================================================
// User Prompt Builder
// ============================================================================

interface TimelinePromptData {
  intent: Intent
  currentTime: string
  entities: Array<{ id: string; name: string; type: string }>
  existingEvents: TimelineEvent[]
  memories: Array<{ id: string; content: string; type: string; validFrom?: number }>
  conversationContext: string
  idMap: ShortIdMap
}

export function buildTimelineUserPrompt(data: TimelinePromptData): string {
  const {
    intent,
    currentTime,
    entities,
    existingEvents,
    memories,
    conversationContext,
    idMap,
  } = data

  const sections: string[] = []

  // Intent guidance
  const intentGuidance = TIMELINE_INTENT_GUIDANCE[intent]
  if (intentGuidance) {
    sections.push(`## Intent: ${intent}`)
    sections.push(intentGuidance)
    sections.push('')
  }

  // Current time
  sections.push(`## Current Time`)
  sections.push(currentTime)
  sections.push('')

  // Entities
  if (entities.length > 0) {
    sections.push('## Entities')
    for (const entity of entities) {
      const shortId = idMap.toShort.get(entity.id) ?? entity.id
      sections.push(`- [${shortId}] ${entity.name} (${entity.type})`)
    }
    sections.push('')
  }

  // Existing recent events (for dedup context)
  if (existingEvents.length > 0) {
    sections.push('## Existing Timeline Events (use these IDs to UPDATE, not duplicate)')
    for (const event of existingEvents) {
      const shortId = idMap.toShort.get(event.id) ?? event.id
      const date = new Date(event.eventTime).toISOString().split('T')[0]
      const entityIds = event.entityIdsParsed.map(id => idMap.toShort.get(id) ?? id).join(', ')
      sections.push(`- [${shortId}] "${event.title}" (${date}, confidence: ${event.timeConfidence}) entities: [${entityIds}]`)
      if (event.description) {
        sections.push(`  ${event.description}`)
      }
    }
    sections.push('')
  }

  // New memories
  sections.push('## New Memories to Process')
  for (const mem of memories) {
    const shortId = idMap.toShort.get(mem.id) ?? mem.id
    const validFromStr = mem.validFrom ? ` [validFrom: ${new Date(mem.validFrom).toISOString().split('T')[0]}]` : ''
    sections.push(`- [${shortId}] ${mem.content}${validFromStr}`)
  }
  sections.push('')

  // Conversation context
  if (conversationContext) {
    sections.push('## Conversation Context')
    sections.push(conversationContext)
    sections.push('')
  }

  sections.push('Extract timeline events from the new memories. Output JSON with actions array.')

  return sections.join('\n')
}
