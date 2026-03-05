# Knowledge Tree Architecture — Implementation Plan

> This document is the complete specification for adding knowledge trees to Ramble.
> A coding agent should be able to implement everything from this document alone.
> Read the full document before starting. Implement in phase order.

## Context: What Ramble Does Today

Ramble captures speech/text → normalizes → extracts entities, topics, memories, goals via LLM → stores in WatermelonDB.

**Problem**: Memories are a flat pile (598+ items). Only 10-15 fit in the LLM context window per call. Entity resolution fails because entities have no rich descriptions. Users get raw material (list of memories) not useful artifacts (portfolios, device specs, organized knowledge).

**Solution**: Knowledge trees — per-entity structured knowledge, maintained at write-time by LLM, navigable by heuristic routing. Trees are materialized indexes over base memories.

```
Layer 0: Raw conversations (immutable, exists — don't touch)
Layer 1: Base memories (atomic claims, exists — don't touch)
Layer 2: Knowledge trees (NEW — per-entity structured knowledge)
Layer 3: Timeline events (NEW — temporal event index)
Layer 4: Entity co-occurrence graph (NEW — disambiguation + routing)
```

**Existing tables/code to understand before starting**:
- `src/db/schema.ts` — current v8 schema (knowledge_nodes, entity_cooccurrences, timeline_events will be v9)
- `src/program/kernel/processor.ts` — extraction pipeline (tree curation hooks in after extraction)
- `src/program/WorkingMemory.ts` — context building (short ID pattern already used for m1/g1)
- `src/db/stores/entityStore.ts` — entity CRUD (tree creation triggered by entity mention threshold)
- `src/db/models/` — WatermelonDB model pattern to follow

---

## Phase 1: Foundation (DB + Types + Stores)

### 1.1 Schema Migration (v8 → v9)

Add three new tables in `src/db/schema.ts`. Single migration. All additive — no changes to existing tables.

**IMPORTANT**: Follow the existing naming rule in schema.ts: never use `updatedAt` as a model property name. Use `modifiedAt` instead.

```typescript
// Add these to the tables array in schema.ts

// knowledge_nodes — per-entity tree structure
tableSchema({
  name: 'knowledge_nodes',
  columns: [
    { name: 'entityId',      type: 'string', isIndexed: true },
    { name: 'parentId',      type: 'string', isOptional: true, isIndexed: true },
    { name: 'depth',         type: 'number', isIndexed: true },
    { name: 'sortOrder',     type: 'number' },
    { name: 'label',         type: 'string', isIndexed: true },
    { name: 'summary',       type: 'string', isOptional: true },
    { name: 'content',       type: 'string', isOptional: true },
    { name: 'nodeType',      type: 'string' },          // text|keyvalue|table|reference|group
    { name: 'source',        type: 'string' },          // user|document|meeting_other|inferred
    { name: 'verification',  type: 'string' },          // unverified|mentioned|confirmed|contradicted
    { name: 'memoryIds',     type: 'string' },          // JSON array
    { name: 'templateKey',   type: 'string', isOptional: true },
    { name: 'childCount',    type: 'number' },
    { name: 'metadata',      type: 'string' },          // JSON
    { name: 'createdAt',     type: 'number', isIndexed: true },
    { name: 'modifiedAt',    type: 'number', isIndexed: true },
  ]
}),

// entity_cooccurrences — disambiguation graph
tableSchema({
  name: 'entity_cooccurrences',
  columns: [
    { name: 'entityA',        type: 'string', isIndexed: true },  // smaller ID first (canonical)
    { name: 'entityB',        type: 'string', isIndexed: true },  // larger ID second
    { name: 'count',          type: 'number' },
    { name: 'lastSeen',       type: 'number' },
    { name: 'recentContexts', type: 'string' },         // JSON array of last 3 snippets
    { name: 'createdAt',      type: 'number' },
  ]
}),

// timeline_events — temporal event index
tableSchema({
  name: 'timeline_events',
  columns: [
    { name: 'entityIds',       type: 'string' },         // JSON array
    { name: 'eventTime',       type: 'number', isIndexed: true },  // INTERPRETED time, not createdAt
    { name: 'timeGranularity', type: 'string' },         // exact|day|week|month|approximate
    { name: 'timeConfidence',  type: 'number' },         // 0-1
    { name: 'title',           type: 'string' },
    { name: 'description',     type: 'string' },
    { name: 'significance',    type: 'string', isOptional: true },
    { name: 'memoryIds',       type: 'string' },         // JSON array
    { name: 'source',          type: 'string' },         // user|document|meeting_other|inferred
    { name: 'metadata',        type: 'string' },         // JSON
    { name: 'createdAt',       type: 'number', isIndexed: true },
  ]
}),
```

Add the v8→v9 migration using `createTable` for all three (follow the v6→v7 pattern in the existing migrations array).

Bump schema version to 9.

### 1.2 WatermelonDB Models

Create three new model files following the existing pattern (look at `src/db/models/Memory.ts` and `src/db/models/Entity.ts` as reference):

**`src/db/models/KnowledgeNode.ts`**
```typescript
import { Model } from '@nozbe/watermelondb'
import { field, text, json, readonly, date } from '@nozbe/watermelondb/decorators'

export type NodeType = 'text' | 'keyvalue' | 'table' | 'reference' | 'group'
export type NodeSource = 'user' | 'document' | 'meeting_other' | 'inferred'
export type NodeVerification = 'unverified' | 'mentioned' | 'confirmed' | 'contradicted'

export default class KnowledgeNode extends Model {
  static table = 'knowledge_nodes'

  @field('entityId') entityId!: string
  @field('parentId') parentId!: string | null
  @field('depth') depth!: number
  @field('sortOrder') sortOrder!: number
  @text('label') label!: string
  @text('summary') summary!: string | null
  @text('content') content!: string | null
  @field('nodeType') nodeType!: NodeType
  @field('source') source!: NodeSource
  @field('verification') verification!: NodeVerification
  @json('memoryIds', v => v ?? []) memoryIdsParsed!: string[]
  @field('templateKey') templateKey!: string | null
  @field('childCount') childCount!: number
  @json('metadata', v => v ?? {}) metadataParsed!: Record<string, unknown>
  @field('createdAt') createdAt!: number
  @field('modifiedAt') modifiedAt!: number
}
```

**`src/db/models/EntityCooccurrence.ts`**
```typescript
export default class EntityCooccurrence extends Model {
  static table = 'entity_cooccurrences'

  @field('entityA') entityA!: string      // smaller ID (canonical ordering)
  @field('entityB') entityB!: string      // larger ID
  @field('count') count!: number
  @field('lastSeen') lastSeen!: number
  @json('recentContexts', v => v ?? []) recentContextsParsed!: string[]
  @field('createdAt') createdAt!: number
}
```

**`src/db/models/TimelineEvent.ts`**
```typescript
export default class TimelineEvent extends Model {
  static table = 'timeline_events'

  @json('entityIds', v => v ?? []) entityIdsParsed!: string[]
  @field('eventTime') eventTime!: number        // interpreted time, NOT createdAt
  @field('timeGranularity') timeGranularity!: string  // exact|day|week|month|approximate
  @field('timeConfidence') timeConfidence!: number
  @text('title') title!: string
  @text('description') description!: string
  @text('significance') significance!: string | null
  @json('memoryIds', v => v ?? []) memoryIdsParsed!: string[]
  @field('source') source!: string
  @json('metadata', v => v ?? {}) metadataParsed!: Record<string, unknown>
  @field('createdAt') createdAt!: number
}
```

Register all three models in the database setup file (find where existing models are registered — likely in `src/db/index.ts` or similar).

### 1.3 Stores

Create three store files following the existing store pattern (look at `src/db/stores/entityStore.ts` and `src/db/stores/memoryStore.ts`):

**`src/db/stores/knowledgeNodeStore.ts`** — needs these methods:
```typescript
// Core CRUD
getByEntity(entityId: string): Promise<KnowledgeNode[]>          // all nodes for an entity
getChildren(parentId: string): Promise<KnowledgeNode[]>          // direct children
getSubtree(nodeId: string): Promise<KnowledgeNode[]>             // node + all descendants
getRoots(): Promise<KnowledgeNode[]>                             // all root nodes
create(data: CreateNodeData): Promise<KnowledgeNode>
update(id: string, data: Partial<UpdateNodeData>): Promise<void>
softDelete(id: string): Promise<void>                            // set a deleted flag in metadata
reparentChildren(fromId: string, toId: string): Promise<void>    // for delete/merge operations
updateChildCount(nodeId: string): Promise<void>                  // recount children

// Tree operations
createTreeFromTemplate(entityId: string, template: TreeTemplate): Promise<KnowledgeNode[]>
getOutline(entityId: string): Promise<NodeOutline[]>             // id, label, summary, childCount, depth
searchNodes(terms: string[], entityIds?: string[]): Promise<KnowledgeNode[]>  // label + summary text search
```

**`src/db/stores/cooccurrenceStore.ts`** — needs these methods:
```typescript
// Always use canonical ordering: entityA < entityB
increment(entityIdA: string, entityIdB: string, contextSnippet: string): Promise<void>
getCount(entityIdA: string, entityIdB: string): Promise<number>
getStrongCooccurrences(entityId: string, minCount?: number): Promise<{entityId: string, count: number}[]>
getCluster(entityId: string, minStrength?: number): Promise<string[]>  // IDs of strongly co-occurring entities
```

**`src/db/stores/timelineEventStore.ts`** — needs these methods:
```typescript
create(data: CreateTimelineData): Promise<TimelineEvent>
getByEntity(entityId: string): Promise<TimelineEvent[]>          // sorted by eventTime
getByTimeRange(start: number, end: number): Promise<TimelineEvent[]>
getRecent(limit?: number): Promise<TimelineEvent[]>
```

### 1.4 Type Definitions

Create `src/program/knowledgeTree/types.ts` with all the protocol types:

```typescript
// === Node Types ===
export type NodeType = 'text' | 'keyvalue' | 'table' | 'reference' | 'group'
export type NodeSource = 'user' | 'document' | 'meeting_other' | 'inferred'
export type NodeVerification = 'unverified' | 'mentioned' | 'confirmed' | 'contradicted'

// === Curation Protocol ===

export interface CurationResponse {
  actions: CurationAction[]
  needsMore: NeedsMoreRequest | null
}

// --- Content Actions ---

export interface EditAction {
  type: 'edit'
  node: string                    // short ID (n1, n2, ...)
  content?: string                // new full content
  summary?: string                // new summary
  memoryIds?: string[]            // memory short IDs to append
}

export interface CreateAction {
  type: 'create'
  parent: string                  // short ID of parent node
  label: string
  content: string
  summary: string
  nodeType?: NodeType             // default: 'text'
  memoryIds: string[]
  insertAfter?: string            // short ID of sibling (null = end)
}

export interface DeleteAction {
  type: 'delete'
  node: string
  reason: string
}

// --- Structural Actions ---

export interface MoveAction {
  type: 'move'
  node: string
  newParent: string
  insertAfter?: string
}

export interface MergeAction {
  type: 'merge'
  source: string                  // node to merge FROM (will be deleted)
  target: string                  // node to merge INTO (will be kept)
  mergedContent: string
  mergedSummary: string
}

export interface RenameAction {
  type: 'rename'
  node: string
  label: string
}

export interface SplitAction {
  type: 'split'
  node: string
  into: Array<{
    label: string
    content: string
    summary: string
    memoryIds: string[]
  }>
}

// --- Stub Actions (Phase 4, implement handler as no-op with log) ---

export interface RetypeAction {
  type: 'retype'
  node: string
  nodeType: NodeType
  content?: string
}

export interface LinkAction {
  type: 'link'
  fromNode: string
  toEntity: string
  toNode?: string
  relationship: string
}

export interface VerifyAction {
  type: 'verify'
  node: string
  verification: NodeVerification
  reason?: string
}

// --- Control ---

export interface SkipAction {
  type: 'skip'
  reason: string
}

export type CurationAction =
  | EditAction       // Phase 2 — implement
  | CreateAction     // Phase 2 — implement
  | DeleteAction     // Phase 2 — implement
  | MoveAction       // Phase 2 — implement
  | MergeAction      // Phase 2 — implement
  | RenameAction     // Phase 2 — implement
  | SplitAction      // Phase 2 — implement
  | RetypeAction     // Phase 4 — stub (log + skip)
  | LinkAction       // Phase 4 — stub (log + skip)
  | VerifyAction     // Phase 4 — stub (log + skip)
  | SkipAction       // Phase 2 — implement

// === Context Requests ===

export interface ExpandRequest {
  type: 'expand'
  node: string
}

export interface SearchRequest {
  type: 'search'
  terms: string[]
  scope?: 'related' | 'all'      // default: 'related'
}

export interface AskUserRequest {
  type: 'ask_user'
  question: string
  context: string
}

export type NeedsMoreRequest =
  | ExpandRequest
  | SearchRequest
  | AskUserRequest   // Phase 4 — stub (log + break loop)

// === Templates ===

export interface TemplateNode {
  key: string               // stable identifier, e.g. "identity.role"
  label: string
  nodeType: NodeType
  children?: TemplateNode[]
}

export interface TreeTemplate {
  type: string              // matches entity.type
  nodes: TemplateNode[]
}

// === Short ID Mapping ===

export interface ShortIdMap {
  toShort: Map<string, string>    // real ID → short ID
  toReal: Map<string, string>     // short ID → real ID
  nextIndex: Record<string, number>  // prefix → next counter (e: 1, n: 1, m: 1, etc.)
}
```

### 1.5 Templates

Create `src/program/knowledgeTree/templates.ts`:

```typescript
import type { TreeTemplate } from './types'

export const TEMPLATES: Record<string, TreeTemplate> = {

  person: {
    type: 'person',
    nodes: [
      { key: 'identity', label: 'Identity', nodeType: 'group', children: [
        { key: 'identity.role', label: 'Role', nodeType: 'text' },
        { key: 'identity.organization', label: 'Organization', nodeType: 'text' },
        { key: 'identity.location', label: 'Location', nodeType: 'text' },
      ]},
      { key: 'relationships', label: 'Relationships', nodeType: 'group' },
      { key: 'beliefs', label: 'Beliefs & Opinions', nodeType: 'group' },
      { key: 'goals', label: 'Goals', nodeType: 'group' },
      { key: 'concerns', label: 'Concerns', nodeType: 'group' },
      { key: 'key_facts', label: 'Key Facts', nodeType: 'group' },
    ]
  },

  application: {
    type: 'application',
    nodes: [
      { key: 'purpose', label: 'Purpose', nodeType: 'text' },
      { key: 'tech_stack', label: 'Tech Stack', nodeType: 'group' },
      { key: 'architecture', label: 'Architecture', nodeType: 'group' },
      { key: 'features', label: 'Features', nodeType: 'group' },
      { key: 'users', label: 'Users', nodeType: 'group' },
      { key: 'issues', label: 'Known Issues', nodeType: 'group' },
    ]
  },

  organization: {
    type: 'organization',
    nodes: [
      { key: 'about', label: 'What They Do', nodeType: 'text' },
      { key: 'people', label: 'People', nodeType: 'group' },
      { key: 'products', label: 'Products & Services', nodeType: 'group' },
      { key: 'relationship', label: 'Relationship To User', nodeType: 'text' },
    ]
  },

  device: {
    type: 'device',
    nodes: [
      { key: 'overview', label: 'Overview', nodeType: 'text' },
      { key: 'specs', label: 'Specifications', nodeType: 'keyvalue' },
      { key: 'sensors', label: 'Sensors', nodeType: 'group' },
      { key: 'connectivity', label: 'Connectivity', nodeType: 'text' },
      { key: 'compliance', label: 'Compliance', nodeType: 'group' },
      { key: 'deployment', label: 'Deployment', nodeType: 'group' },
    ]
  },

  project: {
    type: 'project',
    nodes: [
      { key: 'description', label: 'Description', nodeType: 'text' },
      { key: 'role', label: 'Role & Contribution', nodeType: 'text' },
      { key: 'technologies', label: 'Technologies', nodeType: 'group' },
      { key: 'outcome', label: 'Outcome & Impact', nodeType: 'text' },
      { key: 'duration', label: 'Duration', nodeType: 'text' },
    ]
  },

  concept: {
    type: 'concept',
    nodes: [
      { key: 'definition', label: 'Definition', nodeType: 'text' },
      { key: 'context', label: 'Context & Usage', nodeType: 'text' },
      { key: 'related', label: 'Related Concepts', nodeType: 'group' },
    ]
  },

  // Fallback for unknown/unmatched entity types
  _default: {
    type: '_default',
    nodes: [
      { key: 'about', label: 'About', nodeType: 'text' },
      { key: 'details', label: 'Details', nodeType: 'group' },
      { key: 'notes', label: 'Notes', nodeType: 'group' },
    ]
  },
}

// Template selection: entity.type → template key
// If entity.type doesn't match any template, use _default
export function getTemplateForEntityType(entityType: string): TreeTemplate {
  return TEMPLATES[entityType] ?? TEMPLATES._default
}
```

### 1.6 Short ID Mapping Utility

Create `src/program/knowledgeTree/shortIdMap.ts`:

```typescript
import type { ShortIdMap } from './types'

// Prefixes: e=entity, n=node, m=memory, g=goal, t=timeline
export function createShortIdMap(): ShortIdMap {
  return {
    toShort: new Map(),
    toReal: new Map(),
    nextIndex: { e: 1, n: 1, m: 1, g: 1, t: 1 },
  }
}

export function addMapping(map: ShortIdMap, realId: string, prefix: string): string {
  const existing = map.toShort.get(realId)
  if (existing) return existing

  const shortId = `${prefix}${map.nextIndex[prefix]++}`
  map.toShort.set(realId, shortId)
  map.toReal.set(shortId, realId)
  return shortId
}

export function resolveShortId(map: ShortIdMap, shortId: string): string | undefined {
  return map.toReal.get(shortId)
}

// Resolve all short IDs in an action's fields to real IDs
export function resolveActionIds<T extends Record<string, unknown>>(
  map: ShortIdMap,
  action: T,
  fields: string[]
): T {
  const resolved = { ...action }
  for (const field of fields) {
    const value = resolved[field]
    if (typeof value === 'string' && map.toReal.has(value)) {
      (resolved as Record<string, unknown>)[field] = map.toReal.get(value)!
    }
    if (Array.isArray(value)) {
      (resolved as Record<string, unknown>)[field] = value.map(v =>
        typeof v === 'string' && map.toReal.has(v) ? map.toReal.get(v)! : v
      )
    }
  }
  return resolved
}
```

### 1.7 Co-occurrence Increment in Existing Pipeline

In `src/program/kernel/processor.ts`, after entities are saved (find the entity creation loop), add:

```typescript
// After all entities are created/found for this extraction:
const entityIds = savedEntities.map(e => e.id)
for (let i = 0; i < entityIds.length; i++) {
  for (let j = i + 1; j < entityIds.length; j++) {
    await cooccurrenceStore.increment(
      entityIds[i],
      entityIds[j],
      conversationText.slice(0, 100)  // first 100 chars as context snippet
    )
  }
}
```

This is zero LLM cost — just counter increments during the existing extraction flow.

---

## Phase 2: Curation Loop

### 2.1 Tree Outline Formatter

Create `src/program/knowledgeTree/treeFormatter.ts`:

This formats a tree for LLM consumption with smart skipping.

**Input**: all nodes for an entity + relevance scores per node
**Output**: formatted string like:

```
Ashish Charan Tandi [e1]
  Identity [n1]
    ├── [n2] Role: "Founder, building Ramble and Superatom AI"
    └── [n3] Location: (empty)
  Relationships [n4] (5 children: Abha, Prashanth, Chetan, Matt, Pravin)
  Beliefs & Opinions [n5] (3 children)
  Concerns [n6] (2 children: "Abha's health", "STT quality")
  Current Work [n7]
    ├── [n10] Ramble: "Knowledge capture app, speech-to-text..."
    └── [n11] Superatom AI: "Medical device monitoring, IoT..."
  Goals [n8] (2 children: "Build Ramble...", "Create consistent knowledge...")
```

**Skipping rules**:
- Every node ALWAYS shows: label + short ID (so LLM can EXPAND it)
- Collapsed group nodes show: `(N children: child1_label, child2_label, ...)`
- Expanded nodes show: full summary or content
- If a group has >5 children, show first 3 labels + `...and N more`
- The child labels in the parenthetical act as a table of contents

**Relevance ranking** (to decide what to expand vs collapse):
For now, use simple keyword matching:
1. Tokenize new memories into words
2. For each node, check if any word matches the node label (case-insensitive)
3. Also check if any entity mentioned in the conversation matches a child label
4. Score: number of keyword matches. Top-scoring nodes get expanded.
5. Always expand root's direct children labels (L1 is always visible)

### 2.2 Tree Curation Prompt

Create `src/program/knowledgeTree/curationPrompt.ts`:

**System prompt**:
```
You are curating a knowledge tree for an entity. Your job is to surgically
update the tree with new information from a conversation.

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
  {"type": "search", "terms": ["keyword1", "keyword2"], "scope": "related"}
```

**User prompt template**:
```
## Entity: {entityName} [{entityShortId}]
Type: {entityType}

## Current Tree
{formattedTreeWithSkipping}

## New Information
{newMemories formatted as:}
- [m1] {memory content}
- [m2] {memory content}

## Conversation Context
{brief summary of conversation for temporal/speaker context}

{if additionalContext from previous EXPAND/SEARCH:}
## Additional Context (from your previous request)
{expanded node content or search results}

{if previousActions from earlier turns:}
## Actions Already Queued
{list of actions from previous turns, so LLM doesn't repeat}

What updates should be made to this tree?
```

### 2.3 Curation Loop

Create `src/program/knowledgeTree/curateTree.ts`:

```typescript
async function curateTree(
  entityId: string,
  newMemories: Array<{ id: string, content: string, type: string }>,
  conversationContext: string
): Promise<CurationAction[]> {

  // Step 1: Check if entity has a tree. If not, create from template.
  let nodes = await knowledgeNodeStore.getByEntity(entityId)
  if (nodes.length === 0) {
    const entity = await entityStore.getById(entityId)
    if (!entity) return []
    const template = getTemplateForEntityType(entity.type)
    nodes = await knowledgeNodeStore.createTreeFromTemplate(entityId, template)
  }

  // Step 2: Build short ID map
  const idMap = createShortIdMap()
  // Add entity
  addMapping(idMap, entityId, 'e')
  // Add all nodes
  for (const node of nodes) {
    addMapping(idMap, node.id, 'n')
  }
  // Add memories
  for (const mem of newMemories) {
    addMapping(idMap, mem.id, 'm')
  }

  // Step 3: Rank relevance and format tree with skipping
  const relevanceScores = rankNodesByRelevance(nodes, newMemories, conversationContext)
  const outline = formatWithSkipping(nodes, relevanceScores, idMap)

  // Step 4: Multi-turn curation loop
  const MAX_TURNS = 4
  const allActions: CurationAction[] = []
  let additionalContext = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callLLM({
      tier: 'medium',
      systemPrompt: TREE_CURATION_SYSTEM_PROMPT,
      userPrompt: buildCurationUserPrompt({
        outline,
        newMemories,
        conversationContext,
        additionalContext,
        previousActions: allActions,
        idMap,
      }),
      temperature: 0.3,
    })

    const parsed = parseCurationResponse(response)
    allActions.push(...parsed.actions)

    if (!parsed.needsMore) break

    if (parsed.needsMore.type === 'expand') {
      const realId = resolveShortId(idMap, parsed.needsMore.node)
      if (realId) {
        const expanded = await knowledgeNodeStore.getChildren(realId)
        // Add expanded nodes to idMap if not already mapped
        for (const child of expanded) addMapping(idMap, child.id, 'n')
        additionalContext += formatExpandedNode(expanded, idMap)
      }
    }

    if (parsed.needsMore.type === 'search') {
      const scope = parsed.needsMore.scope ?? 'related'
      // Two-tier search: co-occurring entities first
      const cooccurring = await cooccurrenceStore.getCluster(entityId, 3)
      let results = await knowledgeNodeStore.searchNodes(
        parsed.needsMore.terms,
        [entityId, ...cooccurring]
      )
      if (results.length === 0 && scope === 'all') {
        results = await knowledgeNodeStore.searchNodes(parsed.needsMore.terms)
      }
      for (const node of results) addMapping(idMap, node.id, 'n')
      additionalContext += formatSearchResults(results, idMap)
    }

    if (parsed.needsMore.type === 'ask_user') {
      // Phase 4: queue as widget prompt. For now: log and break.
      console.log('[tree-curation] LLM asks user:', parsed.needsMore.question)
      break
    }
  }

  // Step 5: Resolve short IDs back to real IDs
  const resolvedActions = allActions.map(action => resolveAllShortIds(action, idMap))

  // Step 6: Validate
  const validated = validateActions(resolvedActions, nodes)

  // Step 7: Apply to DB
  await applyActions(validated, entityId)

  // Step 8: Post-curation maintenance
  await knowledgeNodeStore.refreshChildCounts(entityId)

  return validated
}
```

### 2.4 Action Handlers

Create `src/program/knowledgeTree/applyActions.ts`:

Each action type gets a handler function. Apply actions in order within a single WatermelonDB batch write.

**Validation rules** (reject invalid actions, don't fail the batch):
- EDIT: node must exist in this tree
- CREATE: parent must exist, label not empty
- DELETE: node must exist, must NOT be root node
- MOVE: both nodes exist, no circular reference (node cannot become descendant of itself)
- MERGE: both nodes exist in same entity tree, source ≠ target
- RENAME: node exists, label not empty
- SPLIT: node exists, `into` has at least 2 entries
- RETYPE: log and skip (Phase 4 stub)
- LINK: log and skip (Phase 4 stub)
- VERIFY: log and skip (Phase 4 stub)
- SKIP: no-op

**Key implementation details for each action**:

DELETE: Soft-delete by setting `metadata.deleted = true`. Re-parent children to the deleted node's parent. Update depths of re-parented children recursively.

MOVE: Update node's `parentId`. Recalculate `depth` for the node and all descendants. Check for circular reference before applying: walk up from `newParent` to root — if we encounter `node`, reject.

MERGE: Copy source's `memoryIds` into target (union, no duplicates). Re-parent source's children to target. Soft-delete source.

SPLIT: Convert original node to `nodeType: 'group'`, clear its content. Create new children from `into` array with `parentId` = original node.

### 2.5 Wire into Processor Pipeline

In `src/program/kernel/processor.ts`, after the existing extraction and save logic, add a new durable task:

```typescript
// After base extraction is saved (entities, topics, memories, goals):

// Queue tree curation as a separate async task
const entitiesForCuration = savedEntities.filter(e =>
  e.mentionCount >= 3 ||
  e.name === userIdentityName  // from settings/data store
)

if (entitiesForCuration.length > 0) {
  await taskStore.create({
    taskType: 'curate-trees',
    payload: JSON.stringify({
      entityIds: entitiesForCuration.map(e => e.id),
      memoryIds: savedMemories.map(m => m.id),
      conversationId: conversation.id,
    }),
    priority: 5,  // lower priority than base extraction
  })
}
```

Then add a task handler for `curate-trees` in the task processing system (find where `process-input` tasks are handled):

```typescript
case 'curate-trees': {
  const { entityIds, memoryIds, conversationId } = JSON.parse(task.payload)
  const memories = await Promise.all(memoryIds.map(id => memoryStore.getById(id)))
  const conversation = await conversationStore.getById(conversationId)

  for (const entityId of entityIds) {
    await curateTree(
      entityId,
      memories.filter(Boolean).map(m => ({ id: m.id, content: m.content, type: m.type })),
      conversation?.summary ?? conversation?.rawText?.slice(0, 200) ?? ''
    )
  }
  break
}
```

---

## Phase 3: UI + Polish (next sprint, not now)

Not implementing now, but the data layer from Phase 1+2 should support these:

- Canvas widget to render entity trees (collapsible, shows verification badges)
- Word-gate triggers: time words → calendar widget, person names → person tree widget
- Timeline view widget rendering timeline_events sorted by eventTime
- Document upload: existing uploaded_files pipeline → bulk tree creation via LLM

---

## Phase 4: Intelligence (later)

Stubs exist in Phase 2 code. Full implementation later:

- **Embedding-based relevance**: transformer.js + supabase-gte-small in browser, store vectors in IndexedDB, use cosine similarity to rank nodes for skipping
- **Batch tree rebalancing**: Weekly durable task, large-context model, full tree + all memories loaded, outputs MOVE/MERGE/RENAME actions
- **Co-occurrence disambiguation**: In normalization pipeline (before LLM extraction), use cooccurrence scores to resolve phonetically similar entity names
- **Verification transitions**: Detect when user speech references content from document-sourced nodes, auto-promote unverified → mentioned
- **ASK_USER**: Queue as widget_record, show in question widget, user response feeds back into next curation cycle
- **Custom templates**: UI for creating/editing templates, stored in `data` table with key `template:{name}`

---

## Design Decisions (Locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Node content limit | 500 words max | LLM should SPLIT when exceeded |
| Summary limit | 30 words max | Summaries always shown in navigation |
| Tree curation LLM tier | **Medium** (Gemini Flash) | Balance of speed + intelligence |
| Rebalance trigger | **>16 children** per level | Inline: LLM suggests MOVEs. Batch: weekly |
| Search scope | **Two-tier**: co-occurring first, then all | Fast common case, broad fallback |
| Co-occurrence storage | **Pairs only** | Clusters derived at read time |
| Short IDs | Ephemeral per-call (`e1`, `n1`, `m1`, `g1`) | Saves tokens, never persisted |
| Action format | **JSON structured output** | Provider-agnostic, no tool calls |
| Max curation turns | 4 | Prevents runaway LLM loops |
| Tree creation threshold | mentionCount >= 3 OR user's own entity OR document-linked | Prevents trees for drive-by mentions |

---

## File Structure (new files to create)

```
src/
├── db/
│   ├── models/
│   │   ├── KnowledgeNode.ts          # Phase 1
│   │   ├── EntityCooccurrence.ts      # Phase 1
│   │   └── TimelineEvent.ts           # Phase 1
│   └── stores/
│       ├── knowledgeNodeStore.ts       # Phase 1
│       ├── cooccurrenceStore.ts        # Phase 1
│       └── timelineEventStore.ts       # Phase 1
└── program/
    └── knowledgeTree/
        ├── types.ts                    # Phase 1 — all type definitions
        ├── templates.ts                # Phase 1 — built-in templates
        ├── shortIdMap.ts               # Phase 1 — ephemeral ID mapping
        ├── treeFormatter.ts            # Phase 2 — outline + skipping
        ├── curationPrompt.ts           # Phase 2 — system + user prompts
        ├── curateTree.ts               # Phase 2 — main curation loop
        └── applyActions.ts             # Phase 2 — action handlers + validation
```

Plus modifications to:
- `src/db/schema.ts` — v9 migration
- `src/db/index.ts` (or wherever models are registered) — register 3 new models
- `src/program/kernel/processor.ts` — co-occurrence increment + curate-trees task queue
