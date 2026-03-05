/**
 * Tree Editor Prompts — system and user prompt for multi-entity tree editing.
 *
 * Key differences from old curation prompts:
 * - Multi-entity: LLM sees trees from multiple entities, edits whichever need updating
 * - Grounded: the tree shows everything already known — don't duplicate
 * - Conversations = context only, not new information
 * - Search: LLM outputs searchTerms to explore more branches (replaces expand/search)
 * - STT-aware: similar-sounding names treated as same entity
 */

import type { TreeEditorContext } from './treeEditorContext'
import type { Intent } from '../types/recording'

// ============================================================================
// System Prompt
// ============================================================================

export const TREE_EDITOR_SYSTEM_PROMPT = `You are editing knowledge trees for multiple entities. Your job is to surgically update the trees with new information from a conversation.

You see trees from multiple entities. Edit whichever need updating. The trees show everything already known about each entity — if the tree already has the information, SKIP it.

CONTENT RULE — this overrides everything else:
The "content" and "summary" fields must contain the factual knowledge itself, stated plainly as it would appear in an encyclopedia entry. Never write action instructions, meta-commentary, placeholders, or descriptions of what the node is for. Every word in these fields should be information that a reader would find useful on its own, without any surrounding context. If no memory provides relevant information for a node, output SKIP — an empty node is always better than filler.

RECENT CONVERSATIONS:
- Recent conversations are provided for FLOW CONTEXT ONLY — they are NOT new information.
- Do NOT create nodes or edit content based on conversation context.
- Only use conversations to understand what the user is referring to in the new text.

STT AWARENESS:
- Input comes from speech-to-text. Names in the memories may be misspelled.
- Treat similar-sounding names as the same entity — do NOT create separate references for STT errors.
- Check entity aliases for known misspellings.

RULES:
- Each node has a short ID (n1, n2, etc.). Use these IDs in your actions.
- Collapsed nodes show their label and child labels in parentheses.
- Keep summaries under 30 words. Content can be up to 500 words.
- When editing, rewrite the full content (not a diff).
- If a level has more than 16 direct children, group them using CREATE + MOVE.
- If nothing needs updating, output a single SKIP action.
- Every edit/create must include memoryIds referencing the source memories.
- Before creating a node, review the existing siblings under the same parent.
  If one already covers the same topic, edit it instead of creating a duplicate.
  Node labels should describe the subject matter, not repeat the entity name.
- Group nodes are structural containers. Add information as children under them,
  never by editing the group node itself.

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
  "searchTerms": null
}

For searchTerms (set to null when done, which is most cases):
  "searchTerms": ["keyword1", "keyword2"]
Use searchTerms ONLY if you suspect there are relevant tree branches you can't see
(e.g. a collapsed section might have the node you need to update).`

// ============================================================================
// Intent Guidance
// ============================================================================

const INTENT_GUIDANCE: Partial<Record<Intent, string>> = {
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

export function buildTreeEditorUserPrompt(ctx: TreeEditorContext): string {
  const sections: string[] = []

  // Entity headers
  sections.push('## Entities')
  for (const entity of ctx.entities) {
    sections.push(`- **${entity.name}** [${entity.shortId}] (${entity.type})`)
    if (entity.aliases.length > 0) {
      sections.push(`  Aliases/misspellings: ${entity.aliases.join(', ')}`)
      sections.push(`  Note: Input from speech-to-text — treat similar-sounding names as this entity.`)
    }
  }
  sections.push('')

  // Intent guidance
  const intentGuidance = INTENT_GUIDANCE[ctx.intent]
  if (intentGuidance) {
    sections.push(`Intent: ${ctx.intent} — ${intentGuidance}`)
    sections.push('')
  }

  // Current knowledge trees (the main payload)
  sections.push('## Current Knowledge Trees')
  sections.push(ctx.treeSections)
  sections.push('')

  // New text (the conversation that triggered this)
  sections.push('## New Text')
  sections.push(ctx.newText)
  sections.push('')

  // Extracted information (memories with short IDs)
  sections.push('## Extracted Information')
  for (const mem of ctx.memories) {
    sections.push(`- [${mem.shortId}] ${mem.content}`)
  }
  sections.push('')

  // Recent conversations (for context only)
  if (ctx.conversationContext) {
    sections.push('## Recent Conversations (for context only)')
    sections.push(ctx.conversationContext)
    sections.push('')
  }

  sections.push('What updates should be made to these trees?')

  return sections.join('\n')
}

// ============================================================================
// Verification Prompt (for CREATE dedup check)
// ============================================================================

export const TREE_EDITOR_VERIFY_SYSTEM_PROMPT = `You are verifying whether proposed CREATE actions duplicate existing nodes.

For each proposed creation, I'll show you the proposed node and existing similar nodes.

RULES:
- If the proposed content adds NEW information not in any existing node → CREATE it (even if the same entity has other nodes)
- If an existing node covers the same TOPIC and the proposed content adds details → EDIT that node to merge the new info in
- ONLY use SKIP if the proposed content is truly redundant — the exact same fact already exists in an existing node
- NEVER skip new information. If in doubt between EDIT and CREATE, prefer EDIT to consolidate.
- When you EDIT, you MUST include the new information in the updated content — don't just return the old content.

OUTPUT FORMAT (JSON, no markdown wrapping):
{
  "actions": [
    {"type": "create", "parent": "n1", "label": "...", "content": "...", "summary": "...", "memoryIds": ["m1"]},
    {"type": "edit", "node": "n5", "content": "merged old + new content", "summary": "...", "memoryIds": ["m1"]},
    {"type": "skip", "reason": "Exact same fact already in n5"}
  ]
}`

export function buildVerificationPrompt(
  proposedCreates: Array<{ label: string; content: string; parent: string; memoryIds: string[] }>,
  existingMatches: Array<{ shortId: string; label: string; content: string; entityName: string }>
): string {
  const sections: string[] = []

  sections.push('## Proposed Creates')
  for (const c of proposedCreates) {
    sections.push(`- Label: "${c.label}", Content: "${c.content}", Parent: ${c.parent}`)
  }
  sections.push('')

  sections.push('## Existing Similar Nodes')
  for (const m of existingMatches) {
    sections.push(`- [${m.shortId}] ${m.label} (${m.entityName}): "${m.content}"`)
  }
  sections.push('')

  sections.push('For each proposed create: should we still CREATE it, EDIT an existing node instead, or SKIP?')

  return sections.join('\n')
}
