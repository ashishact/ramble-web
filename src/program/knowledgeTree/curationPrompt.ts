/**
 * Curation Prompt — system and user prompt templates for tree curation.
 */

import type { CurationAction, ShortIdMap } from './types'
import type { Intent } from '../types/recording'

// ============================================================================
// System Prompt
// ============================================================================

export const TREE_CURATION_SYSTEM_PROMPT = `You are curating a knowledge tree for an entity. Your job is to surgically
update the tree with new information from a conversation.

MOST IMPORTANT RULE — ONLY WRITE WHAT IS IN THE MEMORIES:
- You may ONLY write content that comes directly from the provided memories.
- If no memory mentions a topic, do NOT touch that node. Leave it empty. Output SKIP.
- NEVER invent, infer, or generate content that isn't explicitly stated in the memories.
- NEVER write placeholder or descriptive text like:
  "This section is for X's role", "Information not available",
  "Not specified", "X's role", "Details about X", "Goals are not specified",
  "Location information is not available"
- Seeing an (empty) node does NOT mean you should fill it. Only fill it if a memory
  provides the actual information for that node.
- An empty node is ALWAYS better than a placeholder or guess.

RULES:
- Each node has a short ID (n1, n2, etc.). Use these IDs in your actions.
- Collapsed nodes show their label and child labels in parentheses.
  Use EXPAND via needsMore if you need to see their full content.
- Keep summaries under 30 words. Content can be up to 500 words.
- When editing, rewrite the full content (not a diff).
- If a level has more than 16 direct children, suggest groupings using
  CREATE (new group) + MOVE actions to reorganize.
- If you don't have enough context, set needsMore to EXPAND a node or SEARCH.
- If nothing needs updating for this entity, output a single SKIP action.
- Prefer updating existing nodes over creating duplicates.
- Every edit/create must include memoryIds referencing the source memories.

POPULATING GROUP NODES — CRITICAL:
- Group nodes exist as organizational containers for child nodes.
- When new information fits under a group node, CREATE a child node under it.
  Example: if a memory says "Abha is his sister with health issues" and there
  is an empty "Relationships" group → CREATE a child "Abha" under Relationships.
- Do NOT edit the group node itself to stuff information into it.
  Groups hold children, not content.
- Only populate groups when the memories explicitly contain relevant information.

AVAILABLE ACTIONS:
- edit: Update a node's content and/or summary. Include memoryIds.
- create: Add a new child node under a parent. Include label, content, summary, memoryIds.
- delete: Remove a wrong/outdated node. Include reason. Children get re-parented.
- move: Move a node to a different parent. For rebalancing.
- merge: Combine two similar nodes. Provide merged content. Source is deleted.
- rename: Change a node's label.
- split: Break an overloaded node into multiple children.
- skip: Nothing to update.

OUTPUT FORMAT (JSON, no markdown wrapping):
{
  "actions": [
    {"type": "edit", "node": "n3", "content": "new text", "summary": "short version", "memoryIds": ["m1"]},
    {"type": "create", "parent": "n1", "label": "New Topic", "content": "details",
     "summary": "short", "nodeType": "text", "memoryIds": ["m2"]},
    {"type": "skip", "reason": "No relevant new information"}
  ],
  "needsMore": null
}

For needsMore (set ONE, or null if done):
  {"type": "expand", "node": "n4"}
  {"type": "search", "terms": ["keyword1", "keyword2"], "scope": "related"}`

// ============================================================================
// User Prompt Builder
// ============================================================================

// ============================================================================
// Intent Guidance for Tree Curation
// ============================================================================

const CURATION_INTENT_GUIDANCE: Partial<Record<Intent, string>> = {
  correct: 'The user corrected something. Find and UPDATE the wrong node with the correct information. Do not create duplicates.',
  retract: 'The user retracted information. DELETE nodes containing the retracted facts. Do not leave stale data.',
  update: 'The user updated existing knowledge. EDIT the relevant nodes with the new values. Use "delete" on truly outdated nodes.',
  instruct: 'The user gave a persistent instruction or identity fact. Create or edit nodes that capture this as authoritative.',
  narrate: 'The user told a story. Add chronological details to relevant nodes. Consolidate into the existing structure.',
  elaborate: 'The user went deep on one topic. Enrich existing nodes or create new children with the detailed information.',
}

// ============================================================================
// User Prompt Builder
// ============================================================================

interface CurationPromptData {
  entityName: string
  entityShortId: string
  entityType: string
  entityAliases: string[]
  formattedTree: string
  newMemories: Array<{ id: string; content: string; type: string }>
  conversationContext: string
  additionalContext: string
  previousActions: CurationAction[]
  idMap: ShortIdMap
  intent: Intent
}

export function buildCurationUserPrompt(data: CurationPromptData): string {
  const {
    entityName,
    entityShortId,
    entityType,
    entityAliases,
    formattedTree,
    newMemories,
    conversationContext,
    additionalContext,
    previousActions,
    idMap,
    intent,
  } = data

  const sections: string[] = []

  // Entity header
  sections.push(`## Entity: ${entityName} [${entityShortId}]`)
  sections.push(`Type: ${entityType}`)
  if (entityAliases.length > 0) {
    sections.push(`Known aliases/misspellings: ${entityAliases.join(', ')}`)
    sections.push(`Note: Input comes from speech-to-text. Names in the memories may be misspelled`)
    sections.push(`(e.g. "Rambl" for "Ramble", "Agha" for "Abha"). Treat similar-sounding names`)
    sections.push(`as this entity — do NOT create separate references for STT errors.`)
  }

  // Intent guidance for tree curation
  const intentGuidance = CURATION_INTENT_GUIDANCE[intent]
  if (intentGuidance) {
    sections.push(`Intent: ${intent} — ${intentGuidance}`)
  }
  sections.push('')

  // Current tree
  sections.push('## Current Tree')
  sections.push(formattedTree)
  sections.push('')

  // New memories
  sections.push('## New Information')
  for (const mem of newMemories) {
    const shortId = idMap.toShort.get(mem.id) ?? mem.id
    sections.push(`- [${shortId}] ${mem.content}`)
  }
  sections.push('')

  // Conversation context
  if (conversationContext) {
    sections.push('## Conversation Context')
    sections.push(conversationContext)
    sections.push('')
  }

  // Additional context from previous EXPAND/SEARCH
  if (additionalContext) {
    sections.push('## Additional Context (from your previous request)')
    sections.push(additionalContext)
    sections.push('')
  }

  // Previous actions from earlier turns
  if (previousActions.length > 0) {
    sections.push('## Actions Already Queued')
    for (const action of previousActions) {
      sections.push(`- ${JSON.stringify(action)}`)
    }
    sections.push('')
  }

  sections.push('What updates should be made to this tree?')

  return sections.join('\n')
}
