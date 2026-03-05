# Knowledge Tree UI & Testing Plan

> This document specifies the frontend widgets needed to visualize and test
> the knowledge tree system. Implement AFTER Phase 1+2 of KNOWLEDGE_TREE_PLAN.md
> are complete (schema, models, stores, curation loop exist).
>
> Read KNOWLEDGE_TREE_PLAN.md first for the data model and curation protocol.

## Overview

Three new widgets + one backfill utility:

1. **KnowledgeTreeWidget** — Interactive tree viewer for any entity
2. **TimelineWidget** — Chronological event view
3. **TreeDevToolsWidget** — Testing panel with backfill button + curation logs
4. **Backfill service** — Replays existing conversations through tree curation

---

## Widget Registration Checklist

For each new widget, you need to:
1. Create the component file in `src/widgets/cards/`
2. Add the widget type to the `WidgetType` union in `src/components/bento/types.ts`
3. Add to `WIDGET_OPTIONS` array in `src/components/bento/BentoLeaf.tsx`
4. Add case in `renderWidget` switch in `src/components/BentoApp.tsx`
5. Export from `src/widgets/index.ts`

Follow the existing patterns exactly — look at `GoalsWidget.tsx` or `EntitiesWidget.tsx` as reference.

---

## 1. KnowledgeTreeWidget

**File**: `src/widgets/cards/KnowledgeTreeWidget.tsx`
**Widget type**: `'knowledge-tree'`
**Icon**: `GitBranch` from lucide-react

### What it shows

A collapsible tree view for a single entity's knowledge tree. The user picks
which entity to view from a dropdown, then sees the full tree with expand/collapse.

### Layout

```
┌─────────────────────────────────────┐
│ 🌳 Knowledge Tree    [entity dropdown ▾]│  ← header
├─────────────────────────────────────┤
│ ▼ Ashish Charan Tandi               │  ← root node
│   ▼ Identity                         │  ← group node (expanded)
│     ├─ Role: "Founder, building..."  │  ← text node with summary
│     ├─ Organization: "Superatom AI"  │
│     └─ Location: (empty)             │  ← empty node, dimmed
│   ▶ Relationships (5)               │  ← collapsed group with count
│   ▶ Beliefs & Opinions (3)          │
│   ▼ Current Work                     │  ← expanded group
│     ├─ Ramble: "Knowledge capture..." │
│     └─ Superatom: "Medical device.." │
│   ▶ Goals (2)                        │
│   ▶ Key Facts (4)                    │
├─────────────────────────────────────┤
│ nodes: 23 │ depth: 3 │ last: 2m ago │  ← footer stats
└─────────────────────────────────────┘
```

### Behavior

**Entity selection**:
- Dropdown shows all entities that have a knowledge tree (root node exists)
- Sorted by most recently modified tree
- Shows entity name + type + node count
- Selection persisted in widget config via `onConfigChange`

**Tree rendering**:
- Each node is a row with indent based on depth
- Group nodes have ▶/▼ expand/collapse toggle
- Text nodes show: label + summary (truncated to 1 line)
- Clicking a node expands it inline to show full content
- Empty nodes (content = null) shown dimmed with "(empty)"

**Node details (click to expand)**:
When a node row is clicked, expand below it to show:
```
┌────────────────────────────────────┐
│ Role                         [text]│
│ ──────────────────────────────────│
│ Founder of Superatom AI, building  │  ← full content
│ Ramble knowledge capture system.   │
│ ──────────────────────────────────│
│ source: user │ verified: confirmed │
│ memories: m12, m45 │ modified: 2h  │
│ template: identity.role            │
└────────────────────────────────────┘
```

**Live updates**:
- Subscribe to `knowledge_nodes` table filtered by selected entityId
- `.observe().subscribe()` — auto-updates when curation writes new nodes
- When nodes change, preserve expand/collapse state (track by node ID)

**Color coding** (verification status):
- `confirmed` → normal text
- `mentioned` → normal text
- `unverified` → `text-slate-400` (dimmed)
- `contradicted` → `text-red-400` with strikethrough

**Node type indicators** (small badge next to label):
- `text` → no badge (default)
- `group` → no badge (has expand arrow)
- `keyvalue` → `KV` badge
- `table` → `TBL` badge
- `reference` → `REF` badge

### Component structure

```typescript
// Main widget
KnowledgeTreeWidget: FC<WidgetProps>
  ├── EntitySelector        // dropdown of entities with trees
  ├── TreeView              // recursive tree renderer
  │   └── TreeNodeRow       // single node row (recursive for children)
  │       └── NodeDetail    // expanded detail panel
  └── TreeStats             // footer with counts

// State
- selectedEntityId: string | null (from widget config)
- nodes: KnowledgeNode[] (from DB subscription)
- expandedNodeIds: Set<string> (local UI state)
- detailNodeId: string | null (which node shows full detail)
```

### Data access

```typescript
useEffect(() => {
  if (!selectedEntityId) return

  const query = database
    .get<KnowledgeNode>('knowledge_nodes')
    .query(Q.where('entityId', selectedEntityId))

  const subscription = query.observe().subscribe(nodes => {
    // Filter out soft-deleted nodes (metadata.deleted !== true)
    const active = nodes.filter(n => !n.metadataParsed?.deleted)
    setNodes(active)
  })

  return () => subscription.unsubscribe()
}, [selectedEntityId])
```

Build tree structure in `useMemo` from flat nodes array:
```typescript
const tree = useMemo(() => buildTreeFromFlatNodes(nodes), [nodes])

function buildTreeFromFlatNodes(nodes: KnowledgeNode[]) {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const children = new Map<string | null, KnowledgeNode[]>()

  for (const node of nodes) {
    const parentId = node.parentId
    if (!children.has(parentId)) children.set(parentId, [])
    children.get(parentId)!.push(node)
  }

  // Sort children by sortOrder
  for (const [, kids] of children) {
    kids.sort((a, b) => a.sortOrder - b.sortOrder)
  }

  const root = children.get(null)?.[0] ?? null
  return { root, children, byId }
}
```

---

## 2. TimelineWidget

**File**: `src/widgets/cards/TimelineWidget.tsx`
**Widget type**: `'timeline'`
**Icon**: `Clock` from lucide-react

### What it shows

A chronological list of timeline events, grouped by day, with entity tags.

### Layout

```
┌─────────────────────────────────────┐
│ 🕐 Timeline           [filter ▾]   │  ← header with entity filter
├─────────────────────────────────────┤
│ ── Today ────────────────────────── │
│ 3:00 PM  Met with DHL team          │
│          [Ashish] [DHL] [PT-100]    │  ← entity tags
│          "First demo of sensor..."   │  ← significance (if exists)
│                                      │
│ 11:00 AM Sent invoice to Bluelinks  │
│          [Ashish] [Bluelinks]       │
│                                      │
│ ── Yesterday ───────────────────── │
│ 2:30 PM  Abha hospital visit        │
│          [Ashish] [Abha]            │
│          ~approximate               │  ← time granularity hint
│                                      │
│ ── Feb 28 ──────────────────────── │
│ ...                                  │
├─────────────────────────────────────┤
│ 12 events │ 5 entities │ span: 39d  │
└─────────────────────────────────────┘
```

### Behavior

**Filtering**:
- Dropdown: "All entities" or pick specific entity
- When filtered, only shows events involving that entity

**Grouping**:
- Group by calendar day (using `eventTime`, not `createdAt`)
- Within day, sort by time descending (newest first)
- Day headers: "Today", "Yesterday", date string for older

**Time display**:
- `exact` → show time (3:00 PM)
- `day` → show "during the day"
- `week` → show "this week" / "last week"
- `month` → show month name
- `approximate` → show "~approximate" indicator

**Entity tags**:
- Small badges with entity name, clickable
- Click → switches KnowledgeTreeWidget (if present) to that entity
  (use eventBus to communicate between widgets: `eventBus.emit('navigate:entity', entityId)`)

**Live updates**:
- Subscribe to `timeline_events` table, sorted by `eventTime` desc

### Data access

```typescript
useEffect(() => {
  const query = database
    .get<TimelineEvent>('timeline_events')
    .query(Q.sortBy('eventTime', Q.desc), Q.take(100))

  const subscription = query.observe().subscribe(events => {
    setEvents(filterEntityId ? events.filter(e =>
      e.entityIdsParsed.includes(filterEntityId)
    ) : events)
  })

  return () => subscription.unsubscribe()
}, [filterEntityId])
```

---

## 3. TreeDevToolsWidget

**File**: `src/widgets/cards/TreeDevToolsWidget.tsx`
**Widget type**: `'tree-dev-tools'`
**Icon**: `FlaskConical` from lucide-react

This is the testing widget. It has controls to run backfill, view curation logs, and monitor the system.

### Layout

```
┌──────────────────────────────────────┐
│ 🧪 Tree Dev Tools                    │
├──────────────────────────────────────┤
│                                      │
│ ── Backfill ──────────────────────── │
│ Replay existing conversations through │
│ tree curation to populate trees.     │
│                                      │
│ Conversations: 216  Processed: 0     │
│ Entities eligible: 12 (≥3 mentions)  │
│                                      │
│ [▶ Start Backfill]  [⏸ Pause] [⏹ Stop] │
│                                      │
│ ── Progress ─────────────────────── │
│ ████████░░░░░░░░░ 48/216 (22%)      │
│ Current: "Hello, my name is Ashish.."│
│ Trees updated: 8  Nodes created: 47  │
│ Actions: 23 edits, 41 creates, 2 moves│
│ Errors: 1                            │
│ Time elapsed: 2m 34s                 │
│                                      │
│ ── Curation Log ─────────────────── │
│ 14:23:05 [Ashish] EDIT n3 "Role"    │
│ 14:23:05 [Ashish] CREATE under n1   │
│ 14:23:04 [Ramble] SKIP "no new info"│
│ 14:23:02 [Superatom] EDIT n15       │
│ 14:22:58 [Ashish] EXPAND n4         │
│ ... (scrollable)                     │
│                                      │
│ ── Stats ────────────────────────── │
│ Trees: 12 │ Total nodes: 156        │
│ Avg depth: 2.3 │ Max depth: 4       │
│ Co-occurrences: 45 pairs            │
│ Timeline events: 28                  │
│                                      │
│ [🗑 Reset All Trees] [📊 Export Trees]│
└──────────────────────────────────────┘
```

### Behavior

**Backfill controls**:
- **Start Backfill**: Begins processing conversations from oldest to newest
- **Pause**: Pauses after current conversation completes
- **Stop**: Stops immediately, progress is preserved (can resume)
- Shows real-time progress bar and stats

**Curation log**:
- Live-scrolling log of all curation actions
- Each entry: timestamp, entity name, action type, target node label
- Color-coded by action type (edit=blue, create=green, delete=red, move=yellow, skip=gray)
- Click on a log entry → highlight that node in KnowledgeTreeWidget
  (emit `eventBus.emit('navigate:entity', entityId)` + `eventBus.emit('highlight:node', nodeId)`)

**Stats panel**:
- Live counts from DB queries
- Refresh on each backfill step

**Reset All Trees**:
- Confirmation dialog ("This will delete all knowledge nodes. Continue?")
- Deletes all rows from knowledge_nodes table
- Also resets co-occurrences and timeline events
- Useful for re-running backfill with different prompts

**Export Trees**:
- Dumps all knowledge_nodes as JSON to clipboard or download
- Useful for debugging and sharing

### Component structure

```typescript
TreeDevToolsWidget: FC<WidgetProps>
  ├── BackfillControls        // start/pause/stop buttons + progress
  ├── BackfillProgress        // progress bar + current conversation + stats
  ├── CurationLog             // scrollable log of actions
  └── TreeStats               // aggregate stats from DB
```

---

## 4. Backfill Service

**File**: `src/program/knowledgeTree/backfill.ts`

This is NOT a widget — it's a service the TreeDevToolsWidget calls. It replays
existing conversations through the tree curation pipeline.

### Algorithm

```typescript
import { curateTree } from './curateTree'

interface BackfillState {
  status: 'idle' | 'running' | 'paused' | 'complete'
  processedCount: number
  totalCount: number
  currentConversationId: string | null
  stats: {
    treesUpdated: Set<string>
    nodesCreated: number
    actionsApplied: Record<string, number>  // action type → count
    errors: number
  }
  log: BackfillLogEntry[]
}

interface BackfillLogEntry {
  timestamp: number
  entityName: string
  entityId: string
  actionType: string
  nodeLabel?: string
  nodeId?: string
  detail?: string
}

class BackfillService {
  private state: BackfillState = { status: 'idle', ... }
  private abortController: AbortController | null = null

  // Observable state for UI binding
  private stateSubject = new BehaviorSubject<BackfillState>(this.state)
  get state$() { return this.stateSubject.asObservable() }

  async start(): Promise<void> {
    this.abortController = new AbortController()
    this.state.status = 'running'
    this.emit()

    // 1. Load all conversations, sorted by timestamp ASC (oldest first)
    const conversations = await database
      .get<Conversation>('conversations')
      .query(Q.sortBy('timestamp', Q.asc))
      .fetch()

    this.state.totalCount = conversations.length

    // 2. Load all memories (we need them to find which memories
    //    were extracted from each conversation)
    const allMemories = await database
      .get<Memory>('memories')
      .query()
      .fetch()

    // Build lookup: conversationId → memories
    const memoriesByConvId = new Map<string, Memory[]>()
    for (const mem of allMemories) {
      for (const convId of mem.sourceConversationIdsParsed ?? []) {
        if (!memoriesByConvId.has(convId)) memoriesByConvId.set(convId, [])
        memoriesByConvId.get(convId)!.push(mem)
      }
    }

    // 3. Process each conversation
    for (const conv of conversations) {
      if (this.abortController.signal.aborted) break
      if (this.state.status === 'paused') {
        await this.waitForResume()
        if (this.abortController.signal.aborted) break
      }

      this.state.currentConversationId = conv.id
      this.emit()

      try {
        // Find memories from this conversation
        const memories = memoriesByConvId.get(conv.id) ?? []
        if (memories.length === 0) {
          this.state.processedCount++
          this.emit()
          continue
        }

        // Find entities mentioned in these memories
        const entityIds = new Set<string>()
        for (const mem of memories) {
          for (const eid of mem.entityIdsParsed ?? []) {
            entityIds.add(eid)
          }
        }

        // Filter to entities with mentionCount >= 3
        const entities = await Promise.all(
          [...entityIds].map(id => entityStore.getById(id))
        )
        const eligible = entities.filter(e => e && e.mentionCount >= 3)

        // Also increment co-occurrences
        const eligibleIds = eligible.map(e => e!.id)
        for (let i = 0; i < eligibleIds.length; i++) {
          for (let j = i + 1; j < eligibleIds.length; j++) {
            await cooccurrenceStore.increment(
              eligibleIds[i], eligibleIds[j],
              conv.rawText?.slice(0, 100) ?? ''
            )
          }
        }

        // Curate tree for each eligible entity
        for (const entity of eligible) {
          if (!entity) continue

          const actions = await curateTree(
            entity.id,
            memories.map(m => ({ id: m.id, content: m.content, type: m.type })),
            conv.summary ?? conv.rawText?.slice(0, 200) ?? ''
          )

          // Log actions
          for (const action of actions) {
            this.state.log.push({
              timestamp: Date.now(),
              entityName: entity.name,
              entityId: entity.id,
              actionType: action.type,
              nodeLabel: 'node' in action ? action.node : undefined,
              detail: action.type === 'skip' ? action.reason : undefined,
            })

            // Update stats
            this.state.stats.actionsApplied[action.type] =
              (this.state.stats.actionsApplied[action.type] ?? 0) + 1
            if (action.type === 'create') this.state.stats.nodesCreated++
            this.state.stats.treesUpdated.add(entity.id)
          }
        }
      } catch (err) {
        this.state.stats.errors++
        this.state.log.push({
          timestamp: Date.now(),
          entityName: 'ERROR',
          entityId: '',
          actionType: 'error',
          detail: String(err),
        })
      }

      this.state.processedCount++
      this.emit()
    }

    this.state.status = 'complete'
    this.state.currentConversationId = null
    this.emit()
  }

  pause() { this.state.status = 'paused'; this.emit() }
  resume() { this.state.status = 'running'; this.emit() }
  stop() { this.abortController?.abort(); this.state.status = 'idle'; this.emit() }

  private emit() { this.stateSubject.next({ ...this.state }) }
  private waitForResume(): Promise<void> { /* poll state.status every 500ms */ }
}

// Singleton
export const backfillService = new BackfillService()
```

### Key design decisions

- Process oldest conversations first (chronological order) so trees build up naturally
- Use existing memories (not re-extract) — we're testing tree curation, not extraction
- Co-occurrence counters incremented during backfill too
- Each conversation processed independently (no batching across conversations)
- RxJS BehaviorSubject for reactive state → widget subscribes and auto-updates
- Pause/resume to allow inspecting intermediate results

### Rate limiting

Add a configurable delay between conversations to avoid hammering the LLM:
```typescript
// After each conversation:
await new Promise(resolve => setTimeout(resolve, this.delayMs))
// Default delayMs = 500 (adjustable from UI)
```

The TreeDevToolsWidget should have a slider: "Delay between conversations: 500ms"

---

## Cross-Widget Communication

Widgets communicate via eventBus (existing pattern):

```typescript
// New events to add:
'navigate:entity'    → { entityId: string }     // switch KnowledgeTreeWidget to entity
'highlight:node'     → { nodeId: string }        // flash-highlight a node in tree view
'backfill:progress'  → BackfillState             // backfill status updates
```

**KnowledgeTreeWidget** listens for:
- `navigate:entity` → changes selected entity
- `highlight:node` → scrolls to node, adds brief flash animation

**TimelineWidget** listens for:
- `navigate:entity` → filters to that entity

**TreeDevToolsWidget** emits:
- `navigate:entity` when clicking curation log entries
- `highlight:node` when clicking specific node references in log

---

## Styling Guide

Follow existing widget conventions exactly:

```
Container:     w-full h-full flex flex-col overflow-hidden
Header:        flex-shrink-0 px-2 py-1 flex items-center gap-1.5
               border-b border-slate-100
Content:       flex-1 overflow-auto p-1.5
Footer:        flex-shrink-0 px-2 py-1 text-[9px] text-slate-400
               border-t border-slate-100

Text sizes:    text-[10px] for labels, text-[9px] for metadata, text-xs for content
Colors:        text-slate-600 primary, text-slate-400 secondary
               bg-slate-100/60 and bg-slate-50/40 alternating rows
Icons:         12px Lucide icons
Badges:        text-[8px] px-1 rounded bg-slate-200/60
Buttons:       btn btn-xs btn-ghost (DaisyUI)
```

### Tree-specific styles

```
Indent:        pl-{depth * 4} (16px per level)
Expand arrow:  text-[10px] w-3 text-center, ▶ collapsed, ▼ expanded
Node label:    text-[10px] font-medium text-slate-700
Node summary:  text-[10px] text-slate-500 truncate
Empty node:    text-[10px] text-slate-300 italic "(empty)"
Node detail:   bg-slate-50 border border-slate-200 rounded p-2 mt-0.5 mb-1 mx-2
```

### Verification colors
```
confirmed:     (default text color)
mentioned:     (default text color)
unverified:    text-slate-400 opacity-60
contradicted:  text-red-400/70 line-through
```

### Curation log colors
```
edit:          text-blue-600
create:        text-green-600
delete:        text-red-600
move:          text-amber-600
merge:         text-purple-600
rename:        text-cyan-600
split:         text-orange-600
skip:          text-slate-400
error:         text-red-500 font-bold
```

---

## File Structure

```
src/widgets/cards/
├── KnowledgeTreeWidget.tsx          # Main tree viewer
├── TimelineWidget.tsx               # Timeline event view
├── TreeDevToolsWidget.tsx           # Testing panel

src/program/knowledgeTree/
├── backfill.ts                      # Backfill service (singleton)
```

Plus modifications to:
- `src/components/bento/types.ts` — add 'knowledge-tree', 'timeline', 'tree-dev-tools' to WidgetType
- `src/components/bento/BentoLeaf.tsx` — add to WIDGET_OPTIONS
- `src/components/BentoApp.tsx` — add cases in renderWidget switch
- `src/widgets/index.ts` — export new widgets

---

## Implementation Order

1. **KnowledgeTreeWidget** first — you need to see the tree to know if curation is working
2. **TreeDevToolsWidget + BackfillService** — to populate trees from existing data
3. **TimelineWidget** — once timeline extraction is wired up

After implementing, the testing workflow is:
1. Open Ramble with 3 widgets: KnowledgeTreeWidget, TreeDevToolsWidget, ConversationWidget
2. Hit "Start Backfill" in dev tools
3. Watch the KnowledgeTreeWidget live-update as trees get populated
4. Inspect curation log for any weird actions
5. Click through entities to verify tree quality
6. If trees look wrong: hit "Reset All Trees", adjust curation prompt, re-run
