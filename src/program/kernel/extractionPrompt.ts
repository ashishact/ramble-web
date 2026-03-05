/**
 * Extraction Prompt — intent-aware system prompt for the extraction LLM.
 *
 * The base prompt covers entities, topics, memories, goals, and corrections.
 * Intent-specific addenda modify extraction behavior based on what the user
 * is doing (correcting, retracting, updating, narrating, etc.).
 *
 * Intent comes from normalization (Phase 1). It tells the extraction LLM
 * how to interpret the input and which fields to prioritize.
 */

import type { Intent } from '../types/recording'

// ============================================================================
// Base Prompt (intent-agnostic)
// ============================================================================

const BASE_PROMPT = `You are analyzing a conversation to extract structured knowledge.
The input is from speech-to-text and may contain residual transcription errors. Use the Known Entities and Working Memory context to interpret what was likely meant — if a word sounds like a known entity, use the known entity name in your extractions. Do not output corrections; just use the correct form directly in entities, memories, and goals.

Context items (entities, topics, memories, goals) are annotated with their age (e.g., [2 min ago], [7 days ago]). Use this to reason temporally:
- Do NOT associate old entities or memories with new input unless the user explicitly names them.
- When creating goals, only use entities and context from the current conversation. Do not infer goals by combining old context with new input.
- If no specific person/entity is mentioned in the new input, do not guess — extract only what is explicitly stated.

Given the user's latest input and the context, extract:

1. **entities**: People, places, organizations, projects, or named concepts.
   Each entity must be an object: {"name": "Entity Name", "type": "person|company|place|project|product|concept|other"}.
   Do NOT include: dates, times, numbers, or temporal expressions.
   Prefer matching against existing Known Entities rather than creating duplicates.

2. **topics**: What is the user talking about now? Format: "Domain / Topic" (e.g., "Work / Planning", "Health / Exercise"). Reuse existing domains from Working Memory when possible.

3. **memories**: Knowledge worth preserving — facts, beliefs, preferences, concerns, decisions, or intentions.

4. **goals**: Goals mentioned — new goals, progress updates, edits, or completions.`

// ============================================================================
// Memory Rules (shared across most intents)
// ============================================================================

const MEMORY_RULES = `
MEMORIES
========
Each memory is a self-contained knowledge unit that must be interpretable on its own, without any surrounding context, even months later.

Content principles:
- Resolve all pronouns and references to their concrete names (people, projects, tools, places).
- Include relevant specifics: amounts, dates, entity names, roles, conditions.
- When multiple related facts emerge about the same subject in one input, consolidate them into a single richer memory rather than several thin fragments.
- If the fact is inherently simple (a relationship, a single attribute), keep it concise — do not pad artificially.
- The test: would a stranger reading only this one sentence understand what it means?

Belief competition:
Working Memory lists existing memories with short IDs like [m1], [m2], etc.
If a new memory CONTRADICTS an existing one (different assignment, conflicting facts, updated information), include a "contradicts" field with the short IDs of the competing memories.
Do NOT omit or replace the old memory — both beliefs coexist. The system resolves the winner at read time based on confidence.

Fields: content (string), type (fact|belief|preference|concern|intention|decision), importance (0-1), contradicts (array of short IDs, optional), subject (who/what this is about, optional),
        validFrom (ISO date or relative expression like "tomorrow", optional),
        validUntil (ISO date or relative expression like "by Friday", optional).

Use validFrom/validUntil when the memory has temporal bounds — deadlines, scheduled events,
time-limited facts. Leave empty for timeless facts like preferences or relationships.`

// ============================================================================
// Goal Rules (shared across most intents)
// ============================================================================

const GOAL_RULES = `
GOALS
=====
Hierarchical namespace. Active goals listed with short IDs (g1, g2, etc.).

Statement format:
- "Namespace / Goal" — a compressed phrase capturing the desired outcome (max 10 words after the namespace)
- "Namespace / Goal / Sub-goal" — for truly distinct sub-objectives
e.g. "Health / Run a half marathon", "Work / Ship v2 billing integration"

A goal is a destination, not a roadmap — compress the user's intent into its essence. When the user talks about variations or examples of the same concept, capture them as one goal. Only create multiple goals when the objectives are genuinely distinct and independently trackable.

Rules:
- Reuse existing categories — do NOT create many new categories
- Prefer adding depth to existing goals over creating new top-level goals
- Maximum 3 levels

Actions:
- {"statement": "Category / Goal sentence", "type": "work|personal|health"} — new goal
- {"shortId": "g1", "status": "achieved"} — mark existing goal complete
- {"shortId": "g1", "status": "progress", "progress": 0-100} — progress update
- {"shortId": "g1", "status": "edit", "statement": "Category / Corrected goal sentence"} — fix or refine goal text (spelling, scope, clarification). The statement replaces the old one entirely.
- {"shortId": "g1", "status": "abandoned"} — user explicitly gave up or said it's no longer relevant.

type = domain/why (work, personal, health)
statement = Category / What you want to achieve`

// ============================================================================
// Intent-Specific Addenda
// ============================================================================

const INTENT_ADDENDA: Record<Intent, string> = {
  inform: `
INTENT: INFORM
The user is sharing new information. Standard extraction — extract entities, topics,
memories, and goals as described above.`,

  correct: `
INTENT: CORRECT
The user is correcting a mistake — a name, spelling, entity type, or fact.

Focus on:
- Use the "corrections" array for any spelling/name fixes: {"wrong": "...", "correct": "..."}.
- If the correction changes a fact (not just spelling), create a new memory that states the
  correct version and use "contradicts" to reference the short IDs of the wrong memories.
- IMPORTANT: Boost the importance of correction memories (0.8-1.0) — the user explicitly
  corrected something, so the new version should be authoritative.
- Still extract entities/topics as normal (using the corrected names).`,

  retract: `
INTENT: RETRACT
The user is removing or invalidating old information ("forget that", "that's no longer true",
"delete X", "ignore what I said about Y").

Focus on:
- Identify which existing memories should be retracted. In the "retractions" array, list
  the short IDs of memories to retract: ["m1", "m3"].
- Only retract memories the user explicitly references or clearly describes.
- Do NOT create new memories restating what was retracted.
- Do NOT create memories like "The user wants to forget X" — that defeats the purpose.
- You may still extract entities/topics if mentioned, but keep memory extraction minimal.
- If the user says "forget everything about X", retract all memories whose subject matches X.`,

  update: `
INTENT: UPDATE
The user is explicitly changing something already known ("the deadline moved to March 15",
"she's feeling better now", "we signed the deal").

Focus on:
- Create new memories with the updated information.
- Use "contradicts" to reference the short IDs of the old memories being updated.
- When the old fact had temporal validity, set validUntil on the contradicted reference
  and validFrom on the new memory.
- IMPORTANT: Boost importance (0.7-0.9) since the user is explicitly providing an update.
- Keep the same subject as the old memory when possible.`,

  instruct: `
INTENT: INSTRUCT
The user is giving a persistent instruction or setting identity ("my name is X",
"always remember that...", "when I say X I mean Y").

Focus on:
- Extract as high-importance memories (0.9-1.0) — these are explicit user directives.
- Use type "preference" or "fact" depending on nature.
- If the user is defining their identity ("my name is...", "I am..."), use type "fact"
  and subject = the user's name or "self".
- If the user is defining a mapping ("when I say X I mean Y"), also add a correction entry.
- Check if this contradicts any existing memories and use "contradicts" if so.`,

  narrate: `
INTENT: NARRATE
The user is telling a story or recounting events in sequence ("last week first we did X,
then Y happened, and finally Z").

Focus on:
- Preserve the chronological structure — create memories that capture the sequence.
- Use validFrom to anchor events in time when temporal cues are given.
- Consolidate related events into rich memories rather than one-per-sentence fragments.
- Entities mentioned in the narrative should still be extracted normally.
- Goals are less likely in narratives but extract if explicitly mentioned.`,

  query: '', // Handled upstream — extraction is skipped entirely

  elaborate: `
INTENT: ELABORATE
The user is going deep on one topic ("let me tell you everything about X",
"okay so about the architecture...").

Focus on:
- This will likely produce many related memories about the same subject — consolidate
  aggressively. Prefer fewer, richer memories over many thin ones.
- The subject field should be consistent across all memories from this input.
- Extract the detailed entities and their relationships.
- Goals are unlikely but extract if present.`,
}

// ============================================================================
// Meeting-Specific Prompt
// ============================================================================

const MEETING_BASE_PROMPT = `You are analyzing a meeting transcript to extract structured knowledge.
The transcript contains interleaved speech from multiple participants, labeled with speaker tags:
- "mic:" = the user (the person running Ramble)
- "system:" = remote participant(s) (other people on the call)

The transcript may contain residual speech-to-text errors. Use the Known Entities and Working Memory context to interpret what was likely meant — if a word sounds like a known entity, use the known entity name.

Context items are annotated with their age (e.g., [2 min ago], [7 days ago]). Use this temporally:
- Do NOT associate old entities or memories with new input unless explicitly referenced.
- Extract only what is stated in the transcript.

Given the meeting transcript and context, extract:

1. **entities**: People, places, organizations, projects, or named concepts mentioned in the meeting.
   Each entity must be an object: {"name": "Entity Name", "type": "person|company|place|project|product|concept|other"}.
   Extract all meeting participants as entities (type: "person").
   Prefer matching against existing Known Entities rather than creating duplicates.

2. **topics**: What was discussed? Format: "Domain / Topic" (e.g., "Work / Sprint Planning", "Product / Feature Roadmap"). Reuse existing domains from Working Memory when possible.

3. **memories**: Knowledge worth preserving from this meeting — decisions, action items, commitments, facts shared, status updates, and key discussion points.
   - Attribute WHO said, decided, or committed to WHAT using the "subject" field.
   - For "mic:" statements, subject = the user's name (if known) or "self".
   - For "system:" statements, subject = the participant's name (if identifiable from context) or "remote participant".
   - Consolidate per-speaker contributions rather than creating one memory per sentence.
   - Decisions and action items should have higher importance (0.7-0.9).
   - Status updates and informational items can have moderate importance (0.4-0.6).

4. **goals**: Goals mentioned or implied — new goals, progress updates, or completions.`

// ============================================================================
// Public API
// ============================================================================

/**
 * Build the meeting-specific extraction system prompt.
 *
 * Same output schema (entities, topics, memories, goals, corrections) as the
 * standard prompt — saveExtraction() works unchanged. The difference is:
 * - Understands mic:/system: speaker labels
 * - Attributes memories to speakers via subject field
 * - Higher default importance for decisions/action items
 * - Extracts participants as entities
 */
export function buildMeetingExtractionSystemPrompt(): string {
  const parts = [MEETING_BASE_PROMPT, MEMORY_RULES, GOAL_RULES]

  parts.push(`\nRespond with a JSON object containing only the fields that have content. Only extract what is clearly stated or strongly implied.`)

  return parts.join('\n')
}

/**
 * Build the full extraction system prompt for a given intent.
 *
 * Structure:
 *   base prompt + memory rules + goal rules + intent addendum + closing
 */
export function buildExtractionSystemPrompt(intent: Intent): string {
  const addendum = INTENT_ADDENDA[intent]

  const parts = [BASE_PROMPT]

  // Retract skips memory/goal rules since it's about removing, not creating
  if (intent !== 'retract') {
    parts.push(MEMORY_RULES)
    parts.push(GOAL_RULES)
  } else {
    // Retract needs minimal rules + retractions output format
    parts.push(`
RETRACTIONS
===========
List the short IDs of Working Memory items to retract in a "retractions" array.
Only retract memories the user explicitly references or clearly describes.
Example: {"retractions": ["m1", "m3"], "entities": [...], "topics": [...], "memories": [], "goals": []}`)
  }

  if (addendum) {
    parts.push(addendum)
  }

  parts.push(`\nRespond with a JSON object containing only the fields that have content. Only extract what is clearly stated or strongly implied.`)

  return parts.join('\n')
}
