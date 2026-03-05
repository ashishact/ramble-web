# Tree-Guided Question System — Plan

> Build AFTER the knowledge tree system is stable and tested (Phase 1+2 of KNOWLEDGE_TREE_PLAN.md).
> This replaces the question generation logic in `src/widgets/on-demand/questions/process.ts`
> while keeping the existing Widget.tsx UI mostly unchanged.

## Problem

The current question system (`process.ts:generateQuestions`) asks questions based on
the last few conversations with a small WorkingMemory context (5 convs, 5 memories, 3 goals).
It has no awareness of what knowledge is already captured vs what's missing. After 200
conversations it still asks surface-level follow-ups because it doesn't know what gaps exist.

## Solution

Use knowledge trees to identify structural gaps and guide question generation.
Instead of "what did the user just say → what's missing?", the logic becomes
"what does the user's knowledge tree look like → where are the gaps → what's
the best question right now given what they just said?"

## Three Question Modes

### Mode 1: Gap-Filling (empty or thin nodes)

Find nodes in relevant entity trees that are empty or have minimal content.

```
Tree for Ashish:
  Identity
    ├── Role: "Founder, building Ramble and Superatom AI"  ← filled
    ├── Organization: "Superatom AI"                        ← filled
    └── Location: (empty)                                   ← GAP
  Relationships
    ├── Abha: "Sister, health issues..."                    ← filled
    └── Chetan: (name only, no detail)                      ← THIN

→ Question: "Where are you based — still in the same city as Superatom?"
→ Question: "What does Chetan work on at Superatom?"
```

**Detection**: `node.content === null` OR `node.content.length < 50` for non-group nodes.

**Priority**: Higher when the entity has high mention count or co-occurrence with
the current conversation's entities.

### Mode 2: Depth-Seeking (important but shallow)

Nodes that exist and have some content, but are shallow relative to how important
the entity is (measured by co-occurrence count and mention frequency).

```
Superatom: mentioned 80+ times, co-occurs with Ashish 15 times
  Products & Services
    └── "Medical device monitoring" (1 sentence)   ← SHALLOW for such a central entity

→ Question: "You mention Superatom a lot — what specific products do you offer beyond monitoring?"
```

**Detection**: `cooccurrenceScore(entity, user) > 10` AND `totalContentLength(tree) < threshold`
where threshold scales with mention count.

### Mode 3: Staleness Refresh (old but important)

Nodes that haven't been updated recently but are marked as important or
have high verification status.

```
Ashish / Concerns / "Abha's health"
  Last modified: 14 days ago
  Verification: confirmed
  Importance: high (from memory importance scores)

→ Question: "How is Abha doing — any updates on the thyroid situation?"
```

**Detection**: `node.modifiedAt < (now - 7 days)` AND node has confirmed/mentioned
verification AND linked memories have high importance.

**Sensitivity**: This mode should be used sparingly — stale personal topics
(health, family) need careful framing. Only trigger when user is in solo mode
and has been talking about related topics recently.

---

## Architecture Change

### Current Flow
```
Event (system-i / system-ii)
  → generateQuestions(focusTopic?, previousQuestions?)
    → WorkingMemory.fetch({ size: 'small' })
    → formatForLLM()
    → callLLM({ tier: 'small', prompt, systemPrompt })
    → parse questions
    → save to widget_records
```

### New Flow
```
Event (system-i / system-ii)
  → generateQuestions(focusTopic?, previousQuestions?)
    → WorkingMemory.fetch({ size: 'small' })          // keep for conversation context
    → analyzeTreeGaps(conversationEntityIds)            // NEW
    → buildQuestionPrompt(wmContext, treeGaps)           // NEW
    → callLLM({ tier: 'small', prompt, systemPrompt })  // same tier
    → parse questions
    → save to widget_records
```

The key addition is `analyzeTreeGaps()` which runs BEFORE the LLM call and provides
structured gap information to the prompt.

---

## Implementation

### File: `src/widgets/on-demand/questions/treeGapAnalysis.ts` (NEW)

```typescript
interface TreeGap {
  entityId: string
  entityName: string
  entityType: string
  mode: 'gap' | 'depth' | 'staleness'
  nodePath: string          // e.g., "Identity / Location"
  nodeLabel: string
  nodeId: string
  detail: string            // human-readable gap description
  priority: number          // 0-1 score
}

async function analyzeTreeGaps(
  conversationEntityIds: string[],
  maxGaps: number = 8
): Promise<TreeGap[]> {

  const gaps: TreeGap[] = []

  // 1. Get entities to analyze
  //    Start with entities from current conversation
  //    Add strongly co-occurring entities (they may have relevant gaps)
  const entityIds = new Set(conversationEntityIds)
  for (const eid of conversationEntityIds) {
    const cluster = await cooccurrenceStore.getCluster(eid, 3)
    for (const related of cluster.slice(0, 5)) {
      entityIds.add(related)
    }
  }

  // 2. For each entity, check its tree
  for (const entityId of entityIds) {
    const nodes = await knowledgeNodeStore.getByEntity(entityId)
    if (nodes.length === 0) continue  // no tree yet

    const entity = await entityStore.getById(entityId)
    if (!entity) continue

    const now = Date.now()
    const isConversationEntity = conversationEntityIds.includes(entityId)

    for (const node of nodes) {
      if (node.metadataParsed?.deleted) continue
      if (node.nodeType === 'group' && node.childCount > 0) continue  // group with children is fine

      // --- Mode 1: Gap-Filling ---
      if (node.content === null || node.content === '') {
        // Empty node in a template = structural gap
        const priority = isConversationEntity ? 0.8 : 0.4
        gaps.push({
          entityId, entityName: entity.name, entityType: entity.type,
          mode: 'gap',
          nodePath: await getNodePath(node, nodes),
          nodeLabel: node.label,
          nodeId: node.id,
          detail: `"${node.label}" is empty for ${entity.name}`,
          priority: priority * (entity.mentionCount > 10 ? 1.0 : 0.7),
        })
        continue
      }

      // Thin content (exists but very short)
      if (node.content && node.content.length < 50 && node.nodeType === 'text') {
        const priority = isConversationEntity ? 0.6 : 0.3
        gaps.push({
          entityId, entityName: entity.name, entityType: entity.type,
          mode: 'gap',
          nodePath: await getNodePath(node, nodes),
          nodeLabel: node.label,
          nodeId: node.id,
          detail: `"${node.label}" for ${entity.name} has minimal detail`,
          priority,
        })
        continue
      }

      // --- Mode 2: Depth-Seeking ---
      // Entity is frequently mentioned but this node is shallow
      if (entity.mentionCount > 8 && node.content && node.content.length < 100) {
        const cooccurScore = isConversationEntity
          ? entity.mentionCount  // direct mention = high signal
          : await getMaxCooccurrence(entityId, conversationEntityIds)

        if (cooccurScore > 5) {
          gaps.push({
            entityId, entityName: entity.name, entityType: entity.type,
            mode: 'depth',
            nodePath: await getNodePath(node, nodes),
            nodeLabel: node.label,
            nodeId: node.id,
            detail: `${entity.name} is frequently discussed but "${node.label}" is shallow`,
            priority: 0.5 * Math.min(cooccurScore / 20, 1.0),
          })
        }
      }

      // --- Mode 3: Staleness Refresh ---
      const daysSinceModified = (now - node.modifiedAt) / (1000 * 60 * 60 * 24)
      if (daysSinceModified > 7 && node.verification !== 'unverified') {
        // Only for confirmed/mentioned nodes that are getting stale
        const linkedMemories = node.memoryIdsParsed ?? []
        // Check if any linked memory has high importance
        // (We don't load all memories — estimate from count)
        if (linkedMemories.length >= 2) {
          gaps.push({
            entityId, entityName: entity.name, entityType: entity.type,
            mode: 'staleness',
            nodePath: await getNodePath(node, nodes),
            nodeLabel: node.label,
            nodeId: node.id,
            detail: `"${node.label}" for ${entity.name} hasn't been updated in ${Math.floor(daysSinceModified)} days`,
            priority: 0.3 * Math.min(daysSinceModified / 30, 1.0),
          })
        }
      }
    }
  }

  // 3. Sort by priority, take top N
  gaps.sort((a, b) => b.priority - a.priority)
  return gaps.slice(0, maxGaps)
}

// Helper: build path string like "Identity / Location"
function getNodePath(node: KnowledgeNode, allNodes: KnowledgeNode[]): string {
  const parts: string[] = [node.label]
  let current = node
  const byId = new Map(allNodes.map(n => [n.id, n]))

  while (current.parentId) {
    const parent = byId.get(current.parentId)
    if (!parent || parent.depth === 0) break  // skip root
    parts.unshift(parent.label)
    current = parent
  }

  return parts.join(' / ')
}

// Helper: get max co-occurrence between an entity and any of the conversation entities
async function getMaxCooccurrence(
  entityId: string,
  conversationEntityIds: string[]
): Promise<number> {
  let max = 0
  for (const convEntityId of conversationEntityIds) {
    const count = await cooccurrenceStore.getCount(entityId, convEntityId)
    if (count > max) max = count
  }
  return max
}
```

### File: `src/widgets/on-demand/questions/process.ts` (MODIFY)

Replace `generateQuestions` with a version that includes tree gap analysis.

**Changes to the system prompt** — replace the current system prompt (lines 87-114) with:

```
You analyze a user's conversation to identify what questions would help
build their knowledge base. You have two sources of signal:

1. CONVERSATION CONTEXT: What the user just said (for relevance and natural flow)
2. KNOWLEDGE GAPS: Structural gaps in the user's knowledge trees (what's missing or thin)

Your job is to ask questions that:
- Feel natural given what the user just talked about
- Strategically fill the most valuable knowledge gaps
- Are SHORT (10-20 words) and prompt the user to SPEAK MORE

QUESTION MODES:
- gap: An important field is empty or barely filled → ask to fill it
- depth: A frequently discussed topic is shallow → ask to go deeper
- staleness: Important info hasn't been updated in a while → ask for an update
- follow_up: Natural continuation of what was just said (no tree gap, just conversation flow)
- clarification: Something in the last message was vague

PRIORITY RULES:
- Gaps in entities the user JUST mentioned = highest priority
- Gaps in frequently co-occurring entities = high priority
- Staleness refreshes = low priority (only if user is in a reflective/solo mood)
- Always connect the question to something the user recently said (don't ask out of nowhere)

Return 1 to 3 questions. Fewer is better — only ask when there's a real gap.
If previous questions are provided, find NEW gaps. Do not repeat.

JSON format:
{
  "questions": [
    {
      "text": "What does Chetan focus on at Superatom?",
      "topic": "Work / Team",
      "category": "gap",
      "priority": "high",
      "targetEntity": "Chetan",
      "targetNode": "Role"
    }
  ]
}

category: gap | depth | staleness | follow_up | clarification
priority: high | medium | low
targetEntity: entity name the question aims to fill (optional, for gap/depth/staleness)
targetNode: node label the answer would fill (optional)

SHORT questions that prompt more input. No solutions. No lectures.
```

**Changes to the user prompt** — add a tree gaps section:

```typescript
async function generateQuestions(
  focusTopic?: string,
  previousQuestions?: string[]
): Promise<QuestionResult> {

  const wmData = await workingMemory.fetch({ size: 'small' })
  const contextPrompt = workingMemory.formatForLLM(wmData)

  // NEW: Analyze tree gaps
  const conversationEntityIds = wmData.entities.map(e => e.id)
  const treeGaps = await analyzeTreeGaps(conversationEntityIds, 8)

  // Build tree gaps section for prompt
  let treeGapsSection = ''
  if (treeGaps.length > 0) {
    treeGapsSection = '\n## Knowledge Gaps (from entity trees)\n'
    for (const gap of treeGaps) {
      treeGapsSection += `- [${gap.mode}] ${gap.entityName} / ${gap.nodePath}: ${gap.detail}\n`
    }
  }

  // Latest conversation section (keep existing logic)
  const latestSection = buildLatestSection(wmData)

  // Previous questions section (keep existing logic)
  const previousSection = previousQuestions?.length
    ? `\n## Previous Questions (do not repeat)\n${previousQuestions.map(q => `- ${q}`).join('\n')}\n`
    : ''

  const userPrompt = `Current time: ${wmData.userContext.currentTime}

## Working Memory
${contextPrompt}
${latestSection}
${treeGapsSection}
${previousSection}
${focusTopic ? `Focus your analysis on the topic: "${focusTopic}"\n` : ''}
Analyze gaps and generate questions. Respond with JSON only.`

  const response = await callLLM({
    tier: 'small',
    prompt: userPrompt,
    systemPrompt: TREE_GUIDED_SYSTEM_PROMPT,
    options: { temperature: 0.7, max_tokens: 1000 },
  })

  // Parse response (keep existing normalizeQuestions logic,
  // but add targetEntity and targetNode to schema)
  ...
}
```

### File: `src/widgets/on-demand/questions/Widget.tsx` (MINOR CHANGES)

**Changes to the question schema**:

```typescript
const QuestionSchema = z.object({
  id: z.string(),
  text: z.string(),
  topic: z.string(),
  category: z.enum([
    'gap',              // NEW: empty/thin tree node
    'depth',            // NEW: shallow node for important entity
    'staleness',        // NEW: stale node refresh
    'follow_up',        // KEEP: natural conversation continuation
    'clarification',    // KEEP: vague input
    // REMOVED: missing_info, action, explore (folded into gap/depth)
  ]),
  priority: z.enum(['high', 'medium', 'low']),
  targetEntity: z.string().optional(),    // NEW: which entity this fills
  targetNode: z.string().optional(),      // NEW: which node this fills
})
```

**Changes to category display**:

```typescript
const CATEGORY_CONFIG = {
  gap:           { icon: Search,         color: 'warning',   label: 'gap' },
  depth:         { icon: Layers,         color: 'info',      label: 'deepen' },
  staleness:     { icon: Clock,          color: 'secondary', label: 'refresh' },
  follow_up:     { icon: MessageCircle,  color: 'success',   label: 'follow-up' },
  clarification: { icon: HelpCircle,     color: 'accent',    label: 'clarify' },
}
```

**Optional enhancement** — show target entity/node as a small tag:

```
┌────────────────────────────────────┐
│ 🔍 gap │ Work / Team              │
│ What does Chetan focus on at       │
│ Superatom?                         │
│                  → Chetan / Role   │  ← target hint (dimmed)
└────────────────────────────────────┘
```

This shows the user WHERE in the knowledge tree the answer will land.
Clicking the target hint could navigate to that node in KnowledgeTreeWidget
(via `eventBus.emit('navigate:entity', entityId)`).

---

## Topic-Focused Mode Enhancement

When user clicks a topic filter, instead of just telling the LLM "focus on this topic",
also filter tree gaps to that topic's related entities:

```typescript
if (focusTopic) {
  // Find entities associated with this topic
  const topicEntities = await topicStore.getEntitiesForTopic(focusTopic)
  const topicTreeGaps = await analyzeTreeGaps(topicEntities, 8)
  // Use topicTreeGaps instead of general treeGaps
}
```

This makes topic-focused questions much more targeted — they'll ask about gaps
in that specific topic's entity trees rather than general gaps.

---

## Question Frequency / Restraint

The current system generates 1-4 questions on every System II event.
With tree-guided questions, we should be more selective:

**Rule: Only show tree-guided questions when there are genuine gaps.**

```typescript
// In generateQuestions():
if (treeGaps.length === 0) {
  // No structural gaps found — fall back to pure conversation follow-up
  // Use existing system prompt (no tree gaps section)
  // Limit to 1 question max
}
```

As trees fill up, gaps decrease, and questions naturally become fewer.
A well-documented entity generates zero gap questions — only follow-ups
when the user says something new about it.

This solves the "interrogation" problem — the system asks fewer questions
as it learns more, which is the natural behavior users expect.

---

## Backwards Compatibility

**If knowledge trees don't exist yet** (Phase 1+2 not implemented):
- `analyzeTreeGaps()` returns empty array (no trees in DB)
- Falls back to current behavior (conversation-only questions)
- No breaking changes

**Category mapping for existing data**:
- Old `missing_info` → maps to `gap` in display
- Old `action` → maps to `follow_up`
- Old `explore` → maps to `depth`
- The normalizeQuestions function should accept both old and new categories

---

## Files Summary

```
NEW:
  src/widgets/on-demand/questions/treeGapAnalysis.ts    # Gap detection from trees

MODIFY:
  src/widgets/on-demand/questions/process.ts            # New prompt + gap integration
  src/widgets/on-demand/questions/Widget.tsx             # Updated categories + target hints
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM tier | Keep 'small' | Gap analysis is pre-computed, LLM just frames the question |
| Max questions | 1-3 (down from 1-4) | Fewer but better; tree gaps provide focus |
| Gap analysis scope | Current entities + co-occurring cluster | Balances relevance with discovery |
| Max gaps sent to LLM | 8 | Enough options without overwhelming the prompt |
| Staleness threshold | 7 days | Configurable, start conservative |
| Staleness in meetings | Disabled | Don't ask stale personal questions during work meetings |
| Thin node threshold | < 50 chars | ~1 sentence or less = thin |
| Depth-seeking threshold | mentionCount > 8 AND content < 100 chars | Frequently mentioned but shallow |
| Category changes | 5 categories (gap, depth, staleness, follow_up, clarification) | Cleaner mapping to tree modes |
| Target hint in UI | Optional, dimmed text | Shows where answer lands without cluttering |
