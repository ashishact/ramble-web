# Ramble Web — Architecture Reference

> Comprehensive system documentation for planning product changes.
> Auto-generated from codebase exploration. Last updated: 2026-03-18.

---

## Table of Contents

1. [System Overview & Data Flow](#1-system-overview--data-flow)
2. [DuckDB Graph Layer](#2-duckdb-graph-layer)
3. [Processing Engines](#3-processing-engines)
4. [Ontology System](#4-ontology-system)
5. [Kernel & Recording Lifecycle](#5-kernel--recording-lifecycle)
6. [LLM Client & Tier System](#6-llm-client--tier-system)
7. [Embedding & Vector Search](#7-embedding--vector-search)
8. [Branching & Draft Workflow](#8-branching--draft-workflow)
9. [Chrome Extension Bridge](#9-chrome-extension-bridge)
10. [UI Architecture](#10-ui-architecture)
11. [Services](#11-services)
12. [State Management](#12-state-management)
13. [Configuration & Build](#13-configuration--build)

---

## 1. System Overview & Data Flow

Ramble is a browser-native personal knowledge system. All data lives in-browser via OPFS-backed DuckDB. A dual-thinking architecture (SYS-I fast, SYS-II batch) extracts structured knowledge from speech, text, meetings, and documents into a property graph with cognitive memory modeling.

### Architecture Tiers

```
┌─────────────────────────────────────────────────────────────────┐
│  INPUT LAYER                                                     │
│  Voice (native app / cloud STT) | Text | Paste | File | Meeting │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  KERNEL (src/program/kernel/)                                    │
│  Saves conversation to DuckDB · Dedup · Recording lifecycle      │
└──────────┬──────────────────────────────────┬───────────────────┘
           ▼                                  ▼
┌─────────────────────┐          ┌──────────────────────────────┐
│  SYS-I ENGINE        │          │  SYS-II PERIOD SCHEDULER      │
│  Real-time response  │          │  6-hour batch synthesis        │
│  (ChatGPT or API)    │          │  Draft → commit workflow       │
│  Intent + emotion    │          │  Entity/memory/goal extraction │
│  TTS speak-back      │          │  Compaction → next period      │
└──────────┬───────────┘          └──────────────┬────────────────┘
           ▼                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  KNOWLEDGE GRAPH (DuckDB WASM + OPFS)                            │
│  15 tables · Property graph · Cognitive memory model              │
│  Event-driven reactivity · Background embeddings · Vector search  │
└──────────────────────────┬──────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  UI LAYER (React 19 + Bento Grid)                                │
│  27 widget types · Workspace templates · Lazy loading             │
│  Event bus subscriptions · Reactive store hooks                   │
└─────────────────────────────────────────────────────────────────┘
```

### Cross-System Communication

| Path | Mechanism |
|------|-----------|
| Web app ↔ Chrome extension | `window.postMessage` with typed protocol |
| Web app ↔ Ramble native (macOS) | WebSocket `ws://localhost:49999` |
| Web app ↔ Worker backend | HTTP fetch to `VITE_WORKER_URL` |
| Main thread ↔ DuckDB | Web Worker RPC (structured messages) |
| Widgets ↔ Widgets | EventBus (dual dispatch: handlers + CustomEvent) |
| React ↔ Graph | `graphEventBus` → `useSyncExternalStore` hooks |

---

## 2. DuckDB Graph Layer

### 2.1 Worker Architecture

All DuckDB operations run in a dedicated Web Worker (`src/graph/worker/duckdb.worker.ts`). The main thread communicates via a structured RPC protocol.

**Worker RPC Protocol:**

```
type WorkerRequestType = 'init' | 'exec' | 'query' | 'batch' | 'export' | 'close'

Main thread                              Worker thread
     │                                        │
     │──── { id, type:'init', payload } ─────▶│  Open OPFS db, create tables
     │◀─── { id, type:'result', ready } ──────│
     │                                        │
     │──── { id, type:'query', {sql,params} }▶│  Execute SELECT
     │◀─── { id, type:'result', rows[] } ─────│  (auto-parsed JSON, plain JS)
     │                                        │
     │──── { id, type:'exec', {sql,params} } ▶│  Execute INSERT/UPDATE/DELETE
     │◀─── { id, type:'result', {ok} } ───────│  Schedule CHECKPOINT
     │                                        │
     │──── { id, type:'batch', stmts[] } ────▶│  BEGIN; ...stmts...; COMMIT
     │◀─── { id, type:'result', {ok} } ───────│  Schedule CHECKPOINT
```

**Value conversion** (`toPlainValue`): DuckDB Arrow values are normalized — `bigint` → `number`, JSON strings auto-parsed, ArrayBuffer → `number[]`. Consumers always get plain JS objects.

**OPFS Persistence:**
- Path: `opfs://{profileName}.kg.duckdb`
- Debounced CHECKPOINT every 1s after writes (flushes WAL)
- Retry with backoff (10 attempts, 500–5000ms) for OPFS exclusive locks
- `beforeunload` → `GraphService.terminateNow()` (synchronous kill)
- HMR: `import.meta.hot.dispose()` → clean close for dev reload

**Limits:** 128MB memory, 1 thread, CDN-loaded WASM via blob URL workaround.

### 2.2 GraphService Singleton

```
src/graph/GraphService.ts — Main thread RPC proxy

GraphService.getInstance()
  ├── Fast path: return existing if same profile
  ├── Profile changed: close old worker, create new
  └── Concurrent callers: share single init promise

Methods:
  query<T>(sql, params) → T[]
  exec(sql, params) → void
  batch(statements[]) → void (atomic transaction)
  createNode(node) → GraphNode
  updateNode(id, updates) → void
  deleteNode(id) → void
  getNode(id) → GraphNode | null
  findNodesByLabel(label, branchId?) → GraphNode[]
  createEdge(edge) → GraphEdge
  getEdges(nodeId, type?, direction?) → GraphEdge[]
  exportBytes() → Uint8Array
```

### 2.3 Schema (15 Tables)

**Schema version:** 2. All DDL is idempotent (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

#### Core Tables (V1)

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `branches` | id, name, parent_branch_id, status | Git-like branching. Seed: `global` |
| `nodes` | id, branch_id, labels VARCHAR[], properties JSON, embedding FLOAT[] | Property graph nodes |
| `edges` | id, branch_id, start_id, end_id, type, properties JSON | Relationships |
| `events` | id, target_id, target_kind, op, delta JSON, timestamp | Append-only audit log |
| `snapshots` | id, target_id, state JSON, timestamp | Point-in-time captures |
| `conversations` | id, session_id, raw_text, source, speaker, intent, emotion, topic | Speech/text + SYS-I responses |
| `working_context` | id, node_id, relevance DOUBLE, last_accessed | LRU + decay window |
| `extraction_runs` | period_key, date, slot, status, branch_id, compaction, counts | SYS-II period state |
| `_schema_meta` | key, value | Schema version tracking |

#### V2 Tables — Embeddings

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `embeddings` | id, target_id, target_kind, vector FLOAT[384], model, source_text | Unified vector storage |

#### V2 Tables — Ontology

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `ontology_packages` | id, name, version, status | Installed domain templates |
| `ontology_nodes` | id, package_id, kind (concept/slot/probe), properties JSON | Template definitions |
| `ontology_edges` | id, start_id, end_id, type (HAS_SLOT/HAS_PROBE/REQUIRES/DEPENDS_ON) | Template relationships |
| `ontology_coverage` | id, slot_id, instance_node_id, filled, confidence, probe_count | Slot fill tracking |

**20+ indices** cover: branch filtering, timestamp ordering, edge traversal (start/end/type), label membership, ontology package/kind lookups, coverage slot/package.

### 2.4 Type System

#### GraphNode

```typescript
interface GraphNode {
  id: string
  branch_id: string           // 'global' or 'extraction/YYYY-MM-DD-pN'
  labels: string[]            // e.g. ['entity', 'person'] or ['memory', 'fact']
  properties: Record<string, unknown>  // Domain data (JSON column)
  embedding: Float32Array | null       // DEPRECATED v1 legacy
  created_at: number
  updated_at: number
}
```

#### CognitiveProperties (embedded in node.properties for memory nodes)

```typescript
interface CognitiveProperties {
  content: string
  type: 'fact' | 'event' | 'belief' | 'preference' | 'habit' | 'observation'
  subject?: string

  // Scoring (0–1)
  importance: number        // LLM-assigned significance
  confidence: number        // Origin-based prior
  activityScore: number     // Recency-weighted, 7-day half-life exponential decay
  ownership: number         // speech > typed > pasted > document

  // State machine
  state: 'provisional' | 'stable' | 'contested' | 'superseded' | 'retracted'

  // Temporal
  validFrom?: number
  validUntil?: number

  // Provenance
  origin: 'speech' | 'typed' | 'meeting' | 'pasted' | 'document'
  extractionVersion: string
  sourceConversationIds: string[]

  // Reinforcement
  reinforceCount: number
  lastReinforced: number

  // Contradiction
  contradictedBy?: string[]
  supersededBy?: string
}
```

#### Other Domain Properties

- **EntityProperties**: name, type (person/org/location/product/concept/other), description, aliases[], mentionCount, firstMentioned, lastMentioned
- **TopicProperties**: name, category, mentionCount, firstMentioned, lastMentioned
- **GoalProperties**: statement, type (short-term/long-term/recurring/milestone), status, progress, entityIds[], topicIds[]
- **GraphConversation**: session_id, raw_text, source, speaker ('user'|'sys1'), intent, emotion, topic, recording_id, processed

### 2.5 Domain Stores

Eight major stores, each a singleton accessed via lazy initialization (`src/graph/stores/singletons.ts`):

| Store | Pattern | Key Methods |
|-------|---------|-------------|
| `conversationStore` | Object literal | create, getRecent, getUnprocessed, getByTimeRange, getDailyCounts, markProcessed |
| `MemoryStore` | Class (ReactiveGraphService) | create (applies cognitive priors), getActive, reinforce, retract, supersede |
| `EntityStore` | Class | create, findOrCreate, findByName, recordMention |
| `TopicStore` | Class | create, findOrCreate, recordMention |
| `GoalStore` | Class | create, updateStatus, updateProgress |
| `SessionStore` | Class | create, getActive, endSession |
| `ontologyStore` | Object literal | getFullPackageTree, getUnfilledSlots, getProbesForSlot, areSlotsFilled |
| `widgetRecordStore` | Object literal | create, getLatest, upsert (on-demand widget output) |
| `learnedCorrectionStore` | Object literal | learn (context-scored), findCorrectionsForText |
| `dataStore` | Object literal | get/set/delete, getOnboarding, getUserProfile (localStorage-backed K-V) |

### 2.6 Query Patterns

```sql
-- Label-based filtering
WHERE list_contains(labels, 'entity')

-- JSON property extraction
json_extract_string(properties, '$.name')
CAST(json_extract(properties, '$.importance') AS DOUBLE)

-- Daily conversation counts
SELECT CAST(DATE_TRUNC('day', to_timestamp(created_at / 1000)) AS VARCHAR) AS day,
       COUNT(*) FROM conversations GROUP BY day

-- Graph traversal
SELECT e.* FROM edges e
  JOIN nodes n ON n.id = e.start_id
  WHERE list_contains(n.labels, 'entity') AND e.type = 'KNOWS'

-- Vector search (cosine similarity, UNION legacy support)
SELECT n.*, array_cosine_similarity(e.vector::FLOAT[384], $queryVec) AS similarity
  FROM embeddings e JOIN nodes n ON n.id = e.target_id
  ORDER BY similarity DESC LIMIT $1
```

**DuckDB WASM limitation**: Prepared statements can't bind JS arrays to `VARCHAR[]`/`FLOAT[]`. Workaround: inline array literals with proper escaping.

---

## 3. Processing Engines

Inspired by Kahneman's dual-process theory: SYS-I (fast, reactive) and SYS-II (slow, deliberate).

### 3.1 SYS-I — Real-Time Conversation Engine

**Location:** `src/modules/sys1/`

**Trigger:** `graph:tables:changed` event on conversations table (debounced 1s).

**Flow:**
```
graph:tables:changed (conversations)
  → [debounce 1s] enqueueLatest()
  → Fetch latest user conversation from DuckDB
  → Transport.send(text) with SYS-I prompt
  → Parse response sections (intent, emotion, response, topic, search)
  → [Optional] Vector search round-trips (max 2)
  → Store SYS-I response in conversations (speaker='sys1')
  → Emit sys1:response event
  → TTS speak-back
```

**Session Management:**
- Auto-reset triggers: 30k chars OR 60 turns OR 30min idle
- On reset: close old ChatGPT tab (60s delay), clear history, generate new `chatSessionId`
- `withContext: true` → re-bootstrap from DB, flush to new session
- Persistent state in profileStorage: session-id, chat-url, pending queue, history, metrics

**Intent Classification** (fixed vocabulary):
| Intent | Behavior |
|--------|----------|
| `assert` / `explore` | Ask ONE deepening follow-up question |
| `query` | Answer from context, or request vector search |
| `correct` | One-sentence acknowledgment |
| `command` | Confirm understanding |
| `social` | Brief conversational reply |

**Emotion Classification** (fixed vocabulary):
`neutral`, `excited`, `frustrated`, `curious`, `anxious`, `confident`, `hesitant`, `reflective`

**Stored format:** `"INTENT:EMOTION"` in conversations.intent (e.g., `"ASSERT:curious"`)

**Transports** (`src/modules/sys1/transports.ts`):

| Transport | Mechanism | History | When Used |
|-----------|-----------|---------|-----------|
| `ChatGPTTransport` | Chrome extension → ChatGPT tab | ChatGPT maintains natively | Extension available |
| `LLMApiTransport` | Direct API via `callLLM()` | Local turn history (last 20) | Extension unavailable |

**State machine:** `idle` → `sending` → `idle` (success) or `error`. Also `no-transport` when extension unavailable.

### 3.2 SYS-II — Batch Synthesis Engine

**Location:** `src/modules/synthesis/`

**6-hour periods:**
| Slot | Window |
|------|--------|
| p1 | 00:00–06:00 (Night) |
| p2 | 06:00–12:00 (Morning) |
| p3 | 12:00–18:00 (Afternoon) |
| p4 | 18:00–24:00 (Evening) |

**PeriodScheduler** (singleton):
- 10-minute check interval
- On startup: catch-up lookback (2 days)
- Serial processing (one period at a time)
- Status: `pending` → `running` → `done` → `committed` (or `error` / `interim`)

**ExtractionEngine Flow:**
```
1. Load conversations for period (user only, length > 5)
2. Prepend previous period's compaction as context
3. Send to LLM (large tier) with SYS-II prompt
4. Handle search round-trips (max 5) for graph context
5. Parse JSON response (flexible: plain, code block, or extract first {})
6. Create nodes + edges in draft branch (extraction/YYYY-MM-DD-pN)
7. Save compaction for next period (150–200 word summary)
8. Mark status done
```

**Extracted node types:**
- **Entities**: person, organization, location, product, concept, other. Confidence 0.3–0.7 based on mention frequency.
- **Memories**: DEADLINE, HEALTH, RELATIONSHIP, FINANCIAL, DECISION, EVENT, FACT, GENERIC. Self-contained content. Slots object tracks missing fields.
- **Goals**: Only when user clearly expresses intention. Types: short-term, long-term, recurring, milestone. Namespaced: "Category / Sub-category / Goal".
- **Topics**: "Domain / Short Topic" format (e.g., "Career / Job Search").
- **Relationships**: Free-form edge types (USES, WORKS_AT, PART_OF, MANAGES, KNOWS, etc.). Source/target resolved via entity name → ID map.

**Commit/Discard:**
- `commit(pKey)` → `BranchManager.mergeBranch(branchId)` (draft → global)
- `discard(pKey)` → Delete branch nodes/edges, archive branch, reset status to `pending`

---

## 4. Ontology System

**Location:** `src/modules/ontology/`, `src/data/`

Proactive question generation via deterministic slot-filling. The ontology defines **what** to learn about the user; the navigator picks the **next question** to ask.

### 4.1 Package Structure

```
PackageDefinition
  ├── id, name, version, description
  └── concepts[] (priority-ordered)
       ├── id, name, description, priority (0–1)
       ├── requires?: string[] (concept dependencies)
       └── slots[] (knowledge gaps to fill)
            ├── id, name, description
            ├── value_type: text | number | boolean | date | list
            ├── required: boolean
            ├── depends_on?: string[] (slot dependencies)
            └── probes[] (question variations)
                 ├── id, question
                 └── style: casual | direct | reflective
```

### 4.2 Default Packages

| Package | Concepts |
|---------|----------|
| `about-me.json` | Basic Info, Health & Wellness, Interests & Values |
| `work-career.json` | Current Role, Goals, Skills |
| `family-home.json` | Family, Relationships, Living Situation |

### 4.3 OntologyNavigator (Deterministic Picker)

```
getNextQuestion() algorithm:
  1. Get active packages
  2. For each package, iterate concepts by priority DESC
  3. Check REQUIRES edges (skip if dependencies unfilled)
  4. Get unfilled slots sorted by probe_count ASC (least-asked first)
  5. Check DEPENDS_ON edges (skip if dependencies unfilled)
  6. Load probes for slot, pick first
  7. Increment probe_count
  8. Return OntologySuggestion { questionText, style, slotId, conceptName, packageName }
```

### 4.4 Schema (5 Tables)

Ontology data stored as DuckDB tables (see section 2.3). Edge types: `HAS_SLOT`, `HAS_PROBE`, `REQUIRES`, `DEPENDS_ON`, `RELATED_TO`, `ALTERNATIVE_TO`.

Coverage table bridges slots to user graph nodes with confidence scores and probe exposure counts.

### 4.5 PackageInstaller

- Idempotent (checks if already installed)
- Computes embeddings for slot descriptions (async, non-blocking)
- Inserts nodes (packages, concepts, slots, probes) and edges

### 4.6 Events

- `ontology:suggestion` → emitted after slot selected (carries question, style, slot/concept/package names)
- `ontology:suggestion-cleared` → emitted when all slots filled

---

## 5. Kernel & Recording Lifecycle

### 5.1 Recording Manager

**Location:** `src/program/kernel/recordingManager.ts`

Universal recording abstraction for all input types:

| Type | Behavior |
|------|----------|
| `voice` | Multiple intermediate chunks from native app or cloud STT |
| `text` | Single chunk per submission |
| `paste` | Single chunk, lower confidence |
| `document` | File preview text, lowest confidence |
| `image` | OCR text extraction |
| `meeting` | Multi-speaker transcript from native app |

**Lifecycle:** `start(type, options?)` → `addChunk(text, audioType?, timing?)` (repeatable) → `end()` → returns `{ recording, fullText, chunks }`

**Throughput rate** (chars/second) as confidence signal:
- Speech: ~2.5 chars/sec (physical effort → high confidence)
- Typing: 5–10 chars/sec
- Paste/Document: capped at 1000 (instant → lower confidence)

**Events:** `recording:started`, `recording:chunk`, `recording:ended`

### 5.2 Kernel

**Location:** `src/program/kernel/kernel.ts` — Singleton orchestrator

**Responsibilities:**
1. Listens to native app events (`native:recording-started`, `native:transcription-*`, `native:meeting-transcript-complete`)
2. Wires native events to RecordingManager lifecycle
3. Saves conversations to DuckDB (`conversationStore.create()`)
4. Handles input queue (async, serial processing)
5. Duplicate suppression (hash-based, 2-min TTL)

**Key behavior:** The kernel does NOT extract knowledge — only saves raw text. Extraction is delegated to SYS-I (real-time) and SYS-II (batch).

**Special handling:**
- Solo native speech: NOT saved to DB (user must explicitly paste)
- Meeting speech: SAVED automatically via native app
- Cloud STT final: Skipped (only meeting transcripts auto-ingested)

### 5.3 Recording Types

```typescript
type RecordingType = 'voice' | 'text' | 'paste' | 'document' | 'image'

interface Recording {
  id: string
  type: RecordingType
  startedAt: number
  endedAt?: number
  audioType?: 'mic' | 'system'
  throughputRate?: number
  origin: 'in-app' | 'out-of-app'
  mode?: 'system-i' | 'system-ii'
}
```

---

## 6. LLM Client & Tier System

### 6.1 Tier Abstraction

**Location:** `src/program/llmClient.ts`, `src/program/types/llmTiers.ts`

```
type LLMTier = 'small' | 'medium' | 'large'

Defaults:
  small  → Groq (fast/cheap, e.g. GPT-OSS 120B)
  medium → Gemini 2.5 Flash
  large  → Gemini 2.5 Pro
```

Application code specifies tier, not concrete model. The resolver maps tier → provider + model based on user settings.

### 6.2 Unified Interface

```typescript
callLLM(request: LLMRequest): Promise<LLMResponse>
  1. Resolve tier to concrete provider
  2. Map to cfGateway provider prefix
  3. Build messages array
  4. Call cfGateway.chat() or .streamChat()
  5. Track telemetry (tokens, latency, status)
  6. Return response with estimated tokens
```

### 6.3 Supported Providers

| Provider | Models |
|----------|--------|
| Gemini | 2.5 Flash, 2.5 Flash Lite |
| OpenAI | GPT-5, GPT-5 Mini, GPT-5 Nano |
| Anthropic | Claude Sonnet 4.5, Claude Haiku 4.5, Claude Opus 4.5 |
| Groq | GPT-OSS 120B, GPT-OSS 20B, Kimi K2, Qwen 3 32B, Llama 3.1 8B |

### 6.4 cfGateway

**Location:** `src/services/cfGateway.ts` — Legacy proxy (TODO: migrate to v1 routes)

```
POST /api/cf-gateway
{ apiKey, model, messages, stream, temperature?, maxTokens? }
```

Convenience wrappers: `geminiFlash.chat()/.stream()`, `groqGptOss.chat()/.stream()`, `claudeSonnet.chat()/.stream()`

### 6.5 Working Memory

**Location:** `src/program/WorkingMemory.ts`

Builds unified context for LLM consumption by querying DuckDB:

| Size | Conversations | Entities | Topics | Memories | Goals |
|------|--------------|----------|--------|----------|-------|
| small | 5 | 15 | 5 | 5 | 3 |
| medium | 10 | 15 | 10 | 10 | 5 |
| large | 15 | 15 | 15 | 20 | 10 |

- Deduplicates memories whose `sourceConversationIds` appear in context
- Token estimation: `(totalChars / 4) * 1.2`
- Always fresh (queries DB on every call, no cache)

---

## 7. Embedding & Vector Search

### 7.1 EmbeddingService

**Location:** `src/graph/embeddings/EmbeddingService.ts`

- **Model:** Xenova/bge-small-en-v1.5 (ONNX, 384-dim, q8 quantized, ~33MB)
- **Load:** Lazy, first call downloads from Hugging Face → cached in OPFS
- **Pipeline:** `text → pipeline({pooling: 'mean', normalize: true}) → number[384]`

```
embed(text) → number[384]
embedNode(nodeId) → builds source_text from name/content/description/labels/edges → embed → UPSERT embeddings table
embedNodes(nodeIds[]) → batch embed, returns success count
```

### 7.2 EmbeddingListener (Background Queue)

**Location:** `src/graph/embeddings/EmbeddingListener.ts`

Listens to `graph:node:created` and `graph:node:updated` events. Queue-based with dedup:

- Debounce: 2000ms quiet period
- Batch size: 10 nodes per processing cycle
- Fire-and-forget async batches
- Recursive drain until queue empty

### 7.3 VectorSearch

**Location:** `src/graph/embeddings/VectorSearch.ts`

In-database cosine similarity using DuckDB's `array_cosine_similarity()`:

```
findSimilar(queryVector, limit, labelFilter?) → VectorSearchResult[]
  UNION: embeddings table (v2) + legacy nodes.embedding (v1)
  Dedup on node ID (highest similarity wins)
  Return top-K with scores

searchByText(query, limit) → embed(query) → findSimilar(vector)
findSimilarTo(nodeId, limit) → get embedding → findSimilar(vector, exclude self)
```

---

## 8. Branching & Draft Workflow

### 8.1 Branch Model

Git-like branching stored in `branches` table:

| Branch | Purpose |
|--------|---------|
| `global` | Committed, reviewed nodes (always exists) |
| `extraction/YYYY-MM-DD-pN` | SYS-II draft nodes per period |

Status: `active` → `merged` or `archived`

### 8.2 Draft Lifecycle

```
SYS-II extraction creates draft branch
  → Nodes/edges written with branch_id = 'extraction/2026-03-18-p2'
  → User reviews in Synthesis widget
  → commit(pKey): mergeBranch(branchId) → nodes move to global
  → discard(pKey): delete branch nodes/edges, archive branch, reset to pending
```

### 8.3 Extraction Run Tracking

```typescript
interface PeriodExtractionState {
  periodKey: string        // "2026-03-15-p2"
  date: string
  slot: 'p1' | 'p2' | 'p3' | 'p4'
  status: 'pending' | 'running' | 'interim' | 'done' | 'error' | 'committed'
  branchId: string | null
  conversationCount: number
  compaction: string | null  // Summary for next period
  chatSessionId: string | null
  chatUrl: string | null
  counts: { entities, memories, goals, topics, relationships: number }
}
```

---

## 9. Chrome Extension Bridge

### 9.1 Protocol

**Location:** `src/modules/chrome-extension/protocol.ts`, Chrome ext `types/protocol.ts`

Communication via `window.postMessage` with typed envelopes:

```typescript
// Web app → Extension
{ source: "ramble-web", type: MessageType, requestId: string, payload: unknown }

// Extension → Web app
{ source: "ramble-ext", type: string, requestId: string, payload: unknown }
```

Request-response matching via unique `requestId` with 120s timeout.

### 9.2 Message Types

| Type | Purpose | Tab Strategy |
|------|---------|-------------|
| `PING` | Check extension presence + version | — |
| `AI_CONVERSATION` | Persistent multi-turn ChatGPT conversation | Reuse by conversationId |
| `AI_QUERY` | Data extraction + AI analysis | New tab |
| `AI_RAW` | Direct prompt (no data extraction) | New tab |
| `MEETING_STARTED/ENDED/TRANSCRIPT` | Meeting mode integration | Dedicated meeting tab |
| `CLOSE_TAB` | Close ChatGPT tab by URL | — |

### 9.3 Extension Components

| Component | File | Purpose |
|-----------|------|---------|
| Content script (ramble-web) | `contents/ramble-web.ts` | Bridge postMessage ↔ chrome.runtime |
| Content script (ChatGPT) | `contents/chatgpt-ramble.ts` | ChatGPT automation, `[ramble:*]` injection |
| Content script (Claude) | `contents/claude-ramble.ts` | Claude.ai automation |
| Background worker | `background.ts` | Tab management, message routing, offscreen doc |
| Conversation engine | `lib/conversation-engine.ts` | Per-conversation state, tab resolution, serialized sends |
| Meeting engine | `lib/meeting-engine.ts` | Transcript accumulation, 8k char limit, speaker labels |
| Ramble inject | `lib/ramble-inject.ts` | `[ramble:goals]` etc. → inline data panels in ChatGPT |
| Sidepanel | `sidepanel.tsx` | Settings, status, toggles |

### 9.4 Conversation Engine (Extension)

Per-conversation state with exclusive send queue:

```
Tab resolution order:
  1. In-memory tabId (validate still exists)
  2. chatUrl lookup (find matching open tab)
  3. Reuse idle ChatGPT homepage tab
  4. Create new tab

withLock(conversationId, fn):
  Chain promises per conversation ID
  Prevents duplicate tabs from concurrent sends
```

Session storage persistence for chatUrl/sendCount (survives service worker restart). tabId cannot be persisted (stale after restart).

### 9.5 Meeting Mode Flow

```
native:mode-changed (meeting) → postMessage → extension
  → Background: startMeeting(recordingId) → open ChatGPT tab
  → native:transcription-intermediate → accumulate (min 100 chars per send)
  → Send to ChatGPT with meeting system prompt
  → native:meeting-transcript-complete → final send + endMeeting()
```

### 9.6 `[ramble:*]` Data Injection

User types `[ramble:goals]` in ChatGPT input → content script detects pattern → fetches data from web app via `window.ramble.exportGoals()` → shows inline panel with expand/copy/paste buttons.

Commands: `goals`, `memories`, `entities`, `topics`, `conversations`, `all`, `alltext`

---

## 10. UI Architecture

### 10.1 Entry Point & Routing

**`src/main.tsx`:** React 19 + StrictMode. Initializes database, connects to Ramble native, loads debug utils.

**`src/App.tsx`:** React Router with routes:
- `/` → Default profile BentoApp
- `/u/:profileName` → Profile-specific BentoApp
- `/settings`, `/u/:profileName/settings` → Settings

### 10.2 BentoApp (Main Layout)

**Location:** `src/components/BentoApp.tsx`

**Header bar** (8px): System pause | Native status | Cloud STT | WorkspaceSwitcher | SpotlightBar | ProfileMenu | Edit Layout | Settings

**Initialization chain (useEffect):**
1. Database + DuckDB graph setup
2. EmbeddingListener initialization
3. SYS-I engine startup
4. SYS-II period scheduler
5. Ontology system initialization
6. Auto-backup system

**Tree operations** (all pure, return new trees):
- `splitNode(tree, id, direction, ratio)` → Leaf becomes split + 2 children
- `removeNode(tree, id)` → Merge with sibling
- `updateNodeRatio(tree, id, ratio)` → Resize
- `swapNodes(tree, id1, id2)` → Swap widget content
- `updateNodeWidgetType(tree, id, widgetType)` → Change widget

### 10.3 Bento Grid System

**Location:** `src/components/bento/`

Binary tree structure:

```typescript
interface BentoTree {
  rootId: string
  nodes: Record<string, BentoNode>
}

type BentoNode = SplitNode | LeafNode

SplitNode: { type:'split', direction:'horizontal'|'vertical', ratio:number, first:string, second:string }
LeafNode:  { type:'leaf', content:string, color:string, widgetType:WidgetType, widgetConfig?: Record }
```

**BentoNode** — Recursive renderer. Split nodes use flex with `ratio/1-ratio` basis. Leaves delegate to BentoLeaf.

**BentoLeaf** — Widget card with:
- Edit mode: drag handle, rename, split (H/V with live preview, Alt snaps to 5%), switch widget, 25-color palette, delete with confirmation
- Drag & drop: widget swap (edit mode) + file drop (always)
- ResizeObserver for responsive breakpoints

**Resizer** — Draggable 1px divider between split panels.

### 10.4 Widget System

**26 widget types** across 6 categories:

| Category | Widgets |
|----------|---------|
| Input | voice-recorder, text-input |
| Display | conversation, entities, topics, memories, goals, stats, working-memory, learned-corrections, tts |
| AI | questions, suggestions, speak-better, meeting-transcription, meta-query, google-search |
| Knowledge | knowledge-tree, timeline, knowledge-map |
| Tools | settings, pipeline-monitor, llm-dashboard, embedding-test, synthesis |
| Special | empty (widget picker) |

**Lazy loading:** TTSWidget, KnowledgeTreeWidget, TimelineWidget, KnowledgeMapWidget code-split via `React.lazy()` with Suspense boundaries.

**Widget props:** `{ nodeId, config?, onConfigChange? }`

**Widget state:** Per-nodeId persistent storage via `profileStorage` (profile-scoped).

**Widget pause:** `useWidgetPause(widgetId)` → persistent toggle, space bar shortcut on hovered widget.

### 10.5 Workspace System

**Location:** `src/stores/workspaceStore.ts`

```typescript
interface Workspace {
  id: string
  name: string
  tree: BentoTree
  builtIn: boolean
  templateId?: string
  theme?: string       // DaisyUI theme
  order: number
}
```

- Multiple independent layouts per profile
- Built-in templates seeded on first load
- Keyboard: Ctrl+[/] cycle, Ctrl+1-9 jump
- Per-workspace DaisyUI theming
- Create from template or blank, duplicate, rename, delete

### 10.6 Lens System

**Location:** `src/lib/lensController.ts`

Widgets that intercept the input stream and bypass core pipeline. For "meta queries" without polluting conversation history.

- Singleton state: `isLensActive()`, `getActiveLensId()`, `routeInput(text, source)`
- Visual feedback: CSS classes (`.lens-mode-active`, `data-active-lens`)
- Ephemeral results stored in profileStorage

### 10.7 Key Patterns

- **State:** `useSyncExternalStore` for all reactive stores (workspace, hover, auth, settings)
- **Responsive:** ResizeObserver breakpoints + Tailwind
- **Drag & Drop:** Native HTML5 API with `dataTransfer.setData('application/bento-node-id', id)`
- **Pure tree ops:** All mutations return new trees (immutable, undo/redo feasible)

---

## 11. Services

### 11.1 Speech-to-Text

**Location:** `src/services/stt/`

| Provider | Transport | Tier |
|----------|-----------|------|
| Groq Whisper | HTTP POST (chunk-based) | small |
| Deepgram Nova | WebSocket streaming | medium |
| Deepgram Flux | WebSocket streaming | large |
| Gemini | HTTP POST (chunk-based) | — |
| Mistral | WebSocket streaming | — |

**STTService** singleton: `connect(config, callbacks)` → `startRecording()` → `sendAudio(data)` → `stopRecording()` / `stopRecordingAndWait(timeout)`

**Chunking strategies:** `simple` (full recording) or `vad` (Voice Activity Detection, 10–30s chunks)

### 11.2 Ramble Native Bridge

**Location:** `src/services/stt/rambleNative.ts`

WebSocket to macOS app at `ws://localhost:49999`. Bridges native events to eventBus:
- `state_changed`, `intermediate_text`, `transcription_complete`, `mode_changed`, `meeting_transcript_complete`
- Message deduplication (10s window)
- Auto-reconnect with exponential backoff (3s–30s)

### 11.3 Text-to-Speech

**Location:** `src/services/tts/`

- **Engine:** Kokoro ONNX v1.0 (82M parameters, 54 voices, 8 languages)
- **WebGPU** device support, lazy model loading
- **Text chunker:** Paragraph → sentence splitting, sanitization (asterisks, dashes, pauses after ?)
- **Queue:** `speak(text)`, `queueText()`, `playNext()`, `playPrev()`, `stop()`, `pause()`, `resume()`
- **States:** `idle` → `loading-model` → `generating` → `playing` → `paused`
- **Default voice:** `bf_lily` (British English Female)

### 11.4 File Upload

**Location:** `src/services/fileUpload.ts`

- File System Access API + DuckDB metadata storage
- Supported: TXT, MD, CSV, JSON, XML, HTML, PDF, DOCX, DOC, PNG, JPG, WEBP, GIF, SVG
- Directory handle stored in IndexedDB (`ramble-file-handles:upload-folder`)
- File metadata + preview stored as `uploaded_file` graph nodes

### 11.5 Ramble API Client

**Location:** `src/services/rambleApi.ts`

- Auth: `register()`, `login()`, `refreshToken()` with proactive refresh (2min before expiry), 401 retry
- Cloud storage: `storePut/Get/Delete/List` at `/api/v1/store/{namespace}/{key}`

### 11.6 Phonetic Matcher

**Location:** `src/program/services/phoneticMatcher.ts`

- Double Metaphone encoding
- Levenshtein edit distance
- Combined scoring for entity matching
- Word diff detection with context tracking (3 words left/right) for STT correction learning

---

## 12. State Management

### 12.1 Event Bus

**Location:** `src/lib/eventBus.ts`

Dual dispatch: internal handlers (`eventBus.on()`) AND window CustomEvents (`ramble:{event}`). Framework-agnostic — required for dynamic widgets that can't import React contexts.

**API:** `on(event, handler) → unsubscribe`, `emit(event, payload)`, `hasListeners(event)`, `clear(event?)`

**Bridge:** Lazy-initializes bridge to `graphEventBus` for `graph:tables:changed`, `graph:node:created`, `graph:edge:created`.

### 12.2 All Event Types (70+)

#### Lens Events
| Event | Payload |
|-------|---------|
| `lens:activate` | `{ lensId, lensType, lensName? }` |
| `lens:deactivate` | `{}` |
| `lens:input` | `{ lensId, text, source }` |

#### Pipeline Events
| Event | Payload |
|-------|---------|
| `pipeline:input-received` | `{ text, source }` |

#### STT Events
| Event | Payload |
|-------|---------|
| `stt:recording-started` | `{}` |
| `stt:recording-stopped` | `{}` |
| `stt:transcribing` | `{}` |
| `stt:intermediate` | `{ text }` |
| `stt:final` | `{ text }` |
| `stt:vad-activity` | `{ speechDuration, speaking }` |

#### Native Recording Events
| Event | Payload |
|-------|---------|
| `native:recording-started` | `{ ts, recordingId? }` |
| `native:recording-ended` | `{ ts, recordingId? }` |
| `native:recording-cancelled` | `{ reason, ts }` |
| `native:mode-changed` | `{ mode: 'meeting'|'solo', ts }` |

#### Native Transcription Events
| Event | Payload |
|-------|---------|
| `native:transcription-intermediate` | `{ text, audioType, mode?, ts, speechStartMs?, speechEndMs?, recordingId?, speakerIndex? }` |
| `native:intermediate-entities` | `{ ts, recordingId?, entities?, nlTaggerEntities?, sessionEntities? }` |
| `native:transcription-final` | `{ text, audioType, mode?, ts, duration?, recordingId?, entities? }` |
| `native:meeting-transcript-complete` | `{ recordingId?, duration?, ts, segments[], transcript }` |

#### TTS Events
| Event | Payload |
|-------|---------|
| `tts:speak` | `{ text, voice?, mode? }` |
| `tts:generated` | `{ partId, text }` |
| `tts:started` | `{ partId }` |
| `tts:ended` | `{ reason: 'completed' }` |
| `tts:cancelled` | `{ reason: 'user-stopped' }` |
| `tts:stop` | `{}` |

#### Recording Events
| Event | Payload |
|-------|---------|
| `recording:started` | `{ recording }` |
| `recording:chunk` | `{ chunk, recording }` |
| `recording:ended` | `{ recording, fullText }` |

#### Processing Events
| Event | Payload |
|-------|---------|
| `processing:system-i` | `{ recordingId, chunkIndex, result, hints }` |
| `processing:system-ii` | `{ recordingId?, conversationId?, result, context? }` |
| `processing:consolidation` | `{ result }` |

#### SYS-I Events
| Event | Payload |
|-------|---------|
| `sys1:response` | `{ response, question, intent, emotion, topic, timestamp }` |
| `sys1:stream` | `{ text, conversationId }` |
| `sys1:status` | `{ conversationId, status }` |
| `sys1:state` | `{ state: 'idle'|'sending'|'error'|'no-transport' }` |

#### Synthesis Events (SYS-II)
| Event | Payload |
|-------|---------|
| `synthesis:scheduler-state` | `{ state: 'idle'|'running' }` |
| `synthesis:period-progress` | `{ periodKey, message }` |
| `synthesis:period-done` | `{ periodKey, summary }` |
| `synthesis:period-error` | `{ periodKey, error }` |

#### Widget Events
| Event | Payload |
|-------|---------|
| `questions:updated` | `{ questions[] }` |

#### Chrome Extension Events
| Event | Payload |
|-------|---------|
| `ext:meeting-cards` | `{ status, cards[] }` |
| `ext:google-search` | `{ query, requestId }` |
| `ext:google-search-result` | `{ query, result, requestId }` |
| `ext:google-search-error` | `{ query, error, requestId }` |

#### Navigation Events
| Event | Payload |
|-------|---------|
| `navigate:entity` | `{ entityId }` |
| `highlight:node` | `{ nodeId }` |

#### Ontology Events
| Event | Payload |
|-------|---------|
| `ontology:suggestion` | `{ questionText, style, slotId, slotName, conceptName, packageName }` |
| `ontology:suggestion-cleared` | `{}` |

#### Tree Activity Events
| Event | Payload |
|-------|---------|
| `tree:activity` | `{ type, entityName?, entityId?, message, detail?, timestamp }` |

Activity types: `entity-created`, `entity-resolved`, `curation-start`, `curation-llm-call`, `curation-llm-response`, `curation-llm-error`, `curation-actions-applied`, `curation-complete`, `tree-created`, `curation-action`

#### Graph Events (graphEventBus)
| Event | Payload |
|-------|---------|
| `graph:node:created` | `{ node }` |
| `graph:node:updated` | `{ nodeId, updates }` |
| `graph:node:deleted` | `{ nodeId }` |
| `graph:edge:created` | `{ edge }` |
| `graph:edge:updated` | `{ edgeId, updates }` |
| `graph:edge:deleted` | `{ edgeId }` |
| `graph:tables:changed` | `{ tables[] }` |

### 12.3 Reactive Stores

| Store | Scope | Persistence | Pattern |
|-------|-------|-------------|---------|
| `workspaceStore` | Profile | localStorage | `useSyncExternalStore` |
| `hoveredWidgetStore` | Session | Memory only | `useSyncExternalStore` |
| `authStore` | Global | localStorage | `useSyncExternalStore` |
| `settingsStore` | Global | localStorage | `useSyncExternalStore` |
| `profileStorage` | Profile | localStorage | Namespaced `ramble:{profile}:{key}` |
| `systemPause` | Session | Memory only | `useSyncExternalStore` |

### 12.4 Two Input Paradigms

| Paradigm | Trigger | Processing | LLM Timing |
|----------|---------|------------|------------|
| **Streaming** (meeting mode) | `native:transcription-intermediate` | Continuous VAD segments | WHILE recording |
| **Batch** (solo mode) | `native:transcription-final` or direct input | Full text after stop | AFTER recording |

| Focus Context | Input Source | Origin |
|---------------|-------------|--------|
| **In-app** | Typing, paste, or speech (solo) | `typed`/`pasted`/`speech` |
| **Out-of-app** | Native app background, WebSocket | `speech` (solo) or `meeting` |

---

## 13. Configuration & Build

### 13.1 Build Pipeline

- **Bundler:** Vite 7.1.7 with React + Tailwind CSS plugins
- **Target:** ES2022, ESNext modules, bundler resolution
- **CORS headers** for SharedArrayBuffer (DuckDB WASM requirement):
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- **DuckDB WASM** excluded from Vite optimization (loaded at runtime via CDN)
- **Worker format:** ESM
- **Path alias:** `@/` → `./src/`
- **Code splitting:** React.lazy for heavy widgets (echarts, TTS, knowledge map)

### 13.2 Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `VITE_WORKER_URL` | Backend API endpoint | `http://localhost:8787` |
| `VITE_DUCKDB_WASM_URL` | DuckDB WASM location | jsdelivr CDN |

### 13.3 Dependencies

| Category | Key Packages |
|----------|-------------|
| Framework | React 19.2, React Router 7.9, TypeScript 5.8, Vite 7.1 |
| UI | Tailwind CSS 4.1, DaisyUI 5.3, Lucide icons, Iconify |
| Visualization | ECharts 6.0 |
| Database | DuckDB WASM 1.33.1-dev |
| AI/ML | Vercel AI SDK (Anthropic, Google, Groq, OpenAI), Hugging Face Transformers |
| TTS | Kokoro TTS |

### 13.4 Backend (Cloudflare Worker)

**Middleware chain:** CORS → Identity → Rate limit → Route handler → Response logging

**API v0 (legacy):**
- `POST /api/cf-gateway` — AI proxy
- `POST /api/groq-whisper` — STT
- `/api/ramble/*` — Corrections

**API v1:**
- `POST /api/v1/gateway` — Unified LLM gateway (streaming support)
- `POST /api/v1/transcribe` — Multi-provider STT
- `POST /api/v1/correct` — Grammar/spelling
- `POST /api/v1/transform` — Text normalization
- `PUT/GET/DELETE /api/v1/store/{namespace}/{key}` — Cloud storage

**Rate limits:** 20 req/min (anonymous), 60 req/min (authenticated)

**Auth:** Device ID + JWT + password hashing. Proactive refresh, 401 auto-retry.

**Durable Objects:**
| Object | Scope | Purpose |
|--------|-------|---------|
| `RambleSystem` | Global singleton | Metrics, request log, registered users |
| `UserObject` | Per-user | Quotas, usage log, refresh tokens, store entries |
| `PublicUsers` | Global | Public profiles, shared knowledge |

**Required secrets:** `GROQ_API_KEY`, `MISTRAL_API_KEY`, `GEMINI_API_KEY`, `JWT_SECRET`, `ADMIN_SECRET`

### 13.5 Chrome Extension Build

- **Framework:** Plasmo 0.90.5
- **Manifest:** MV3, permissions: sidePanel, tabs, scripting, activeTab, offscreen, storage
- **Host permissions:** `<all_urls>`
- **Build:** `pnpm build` → `build/chrome-mv3-prod`

### 13.6 Profile Isolation

All data scoped per profile via URL routing (`/u/{profile-name}`):

| Data | Isolation |
|------|-----------|
| DuckDB | Separate OPFS file per profile |
| Workspace state | Profile-scoped localStorage |
| SYS-I session | Profile-scoped profileStorage |
| SYS-II extraction state | Profile-scoped extraction_runs |
| Widget state | Profile-scoped profileStorage |
| Backup | Shared folder, per-profile timestamps |

### 13.7 Backup System

- File System Access API (folder picker)
- Handle persistence via IndexedDB
- File naming: `{profile}-{YYYY-MM-DD}.duckdb` (same-day overwrites)
- Pruning: keep last 10 per profile
- Auto-backup: `visibilitychange` + 30min idle (if >24h since last)

### 13.8 Debug Utilities

**`window.ramble`** interface (exposed in dev):

```
resetOnboarding(), getOnboardingStatus(), clearOnboardingData()
getUserProfile(), clearUserProfile()
getSettings(), clearApiKeys()
resetDatabase()
getData(key), setData(key, type, value), deleteData(key)
exportWorkspaces(), exportMemories(), exportConversations(limit?)
exportEntities(), exportTopics(), exportGoals()
exportAll(), exportAllText(), copyAll(), copyAllText()
```

---

## File Reference

### Core Paths

| Path | Purpose |
|------|---------|
| `src/main.tsx` | Entry point |
| `src/App.tsx` | Router setup |
| `src/components/BentoApp.tsx` | Main layout + initialization |
| `src/components/bento/` | Bento grid (types, node, leaf, resizer, utils) |
| `src/widgets/` | Widget registry + all widget implementations |
| `src/graph/` | DuckDB graph layer |
| `src/graph/worker/` | DuckDB Web Worker + schema |
| `src/graph/stores/` | Domain stores (conversation, memory, entity, etc.) |
| `src/graph/embeddings/` | Embedding service, listener, vector search |
| `src/modules/sys1/` | SYS-I real-time engine |
| `src/modules/synthesis/` | SYS-II batch extraction |
| `src/modules/ontology/` | Ontology navigator + installer |
| `src/modules/chrome-extension/` | Extension bridge protocol |
| `src/program/kernel/` | Kernel + recording manager |
| `src/program/WorkingMemory.ts` | LLM context builder |
| `src/program/llmClient.ts` | Unified LLM interface |
| `src/program/types/` | Recording types, LLM tiers |
| `src/services/cfGateway.ts` | Cloudflare AI gateway client |
| `src/services/stt/` | STT providers + native bridge |
| `src/services/tts/` | Kokoro TTS service |
| `src/services/fileUpload.ts` | File upload service |
| `src/services/rambleApi.ts` | Backend API client |
| `src/lib/eventBus.ts` | Central event bus |
| `src/lib/lensController.ts` | Lens system |
| `src/lib/profile.ts` | Profile URL routing |
| `src/lib/profileStorage.ts` | Profile-scoped localStorage |
| `src/lib/shortcuts.ts` | Keyboard shortcut registry |
| `src/lib/systemPause.ts` | Global pause toggle |
| `src/lib/debugUtils.ts` | window.ramble debug interface |
| `src/stores/` | Reactive stores (workspace, auth, settings, hover) |
| `src/data/` | Ontology package JSON definitions |

### External Systems

| Path | Purpose |
|------|---------|
| `chrome-ext-ramble/` | Chrome extension (Plasmo) |
| `chrome-ext-ramble/background.ts` | Extension service worker |
| `chrome-ext-ramble/contents/` | Content scripts (ramble-web, chatgpt, claude) |
| `chrome-ext-ramble/lib/` | Conversation engine, meeting engine, inject |
| `ramble-worker/src/` | Cloudflare Worker backend |
| `ramble-worker/src/durable-objects/` | RambleSystem, UserObject, PublicUsers |
