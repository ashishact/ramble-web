/**
 * DuckDB Schema DDL — Knowledge Graph + Ontology System
 *
 * This file defines every table in the DuckDB WASM database. The database
 * lives in OPFS (Origin Private File System) and is per-profile — each
 * Ramble profile gets its own isolated DuckDB instance.
 *
 * Architecture follows "two-level modeling" (inspired by OpenEHR):
 *   Level 1 — Generic storage model (nodes, edges, embeddings) — stable, rarely changes
 *   Level 2 — Domain templates (ontology_*) — defines what knowledge to capture
 *
 * The ontology system is a conversational slot-filling framework:
 *   - Packages define domain templates (e.g., "Health & Fitness")
 *   - Concepts group related knowledge areas (e.g., "Sleep Patterns")
 *   - Slots are empty data points to fill (e.g., "sleep_duration")
 *   - Probes are question templates the LLM uses to elicit slot values
 *   - Coverage tracks which slots have been filled with user data
 *
 * The navigator algorithm (in OntologyNavigator) uses these tables
 * deterministically: find unfilled slots, check dependencies, load probes.
 * The LLM handles all fuzzy work (phrasing questions, extracting values,
 * judging depth). Our schema only tracks what's mechanical.
 *
 * Schema versioning:
 *   _schema_meta stores the current version. On startup, if the stored
 *   version < SCHEMA_VERSION, migration DDL runs to upgrade in-place.
 *   Migrations are idempotent (IF NOT EXISTS / IF EXISTS everywhere).
 *
 * DuckDB supports JSON, arrays (LIST), and FLOAT[] natively —
 * no need for JSON stringification hacks.
 */

export const SCHEMA_VERSION = 2

// ============================================================================
// V1 Tables — Core property graph, event log, conversations
// ============================================================================

export const CREATE_TABLES = `
-- ============================================================================
-- Branches (git-like, must exist before nodes/edges reference them)
--
-- Enables draft/review workflow: SYS-II writes to extraction/* branches,
-- user reviews and merges to main. Time travel uses branch snapshots.
-- ============================================================================
CREATE TABLE IF NOT EXISTS branches (
  id              VARCHAR PRIMARY KEY,
  name            VARCHAR NOT NULL,
  parent_branch_id VARCHAR,
  created_at      BIGINT NOT NULL,
  merged_at       BIGINT,
  status          VARCHAR NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_branches_status ON branches(status);

-- Seed the global branch (always exists)
INSERT OR IGNORE INTO branches (id, name, parent_branch_id, created_at, status)
VALUES ('global', 'global', NULL, ${Date.now()}, 'active');

-- ============================================================================
-- Nodes (entities, topics, memories, goals — all as labeled property nodes)
--
-- Neo4j-style: labels[] for type tagging, properties JSON for all data.
-- This is the Level 1 "generic storage model" — domain knowledge lives
-- in the properties JSON, not in the table schema.
--
-- The embedding column is DEPRECATED (v1 legacy). New embeddings go to
-- the dedicated 'embeddings' table. This column is kept for backward
-- compatibility during migration — new code reads from 'embeddings' table.
-- ============================================================================
CREATE TABLE IF NOT EXISTS nodes (
  id              VARCHAR PRIMARY KEY,
  branch_id       VARCHAR NOT NULL DEFAULT 'global',
  labels          VARCHAR[] NOT NULL DEFAULT [],
  properties      JSON NOT NULL DEFAULT '{}',
  embedding       FLOAT[],
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nodes_branch ON nodes(branch_id);
CREATE INDEX IF NOT EXISTS idx_nodes_updated ON nodes(updated_at);

-- ============================================================================
-- Edges (relationships between nodes)
--
-- Type is a free-form string (e.g., KNOWS, RELATES_TO, HAS_GOAL).
-- Properties JSON carries edge-specific data (weight, context, etc.).
-- ============================================================================
CREATE TABLE IF NOT EXISTS edges (
  id              VARCHAR PRIMARY KEY,
  branch_id       VARCHAR NOT NULL DEFAULT 'global',
  start_id        VARCHAR NOT NULL,
  end_id          VARCHAR NOT NULL,
  type            VARCHAR NOT NULL,
  properties      JSON NOT NULL DEFAULT '{}',
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edges_start ON edges(start_id);
CREATE INDEX IF NOT EXISTS idx_edges_end ON edges(end_id);
CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
CREATE INDEX IF NOT EXISTS idx_edges_start_type ON edges(start_id, type);
CREATE INDEX IF NOT EXISTS idx_edges_end_type ON edges(end_id, type);

-- ============================================================================
-- Events (append-only audit log)
--
-- Every graph mutation (create, update, delete, merge, retract) is logged.
-- Enables time-travel queries and provenance tracking.
-- ============================================================================
CREATE TABLE IF NOT EXISTS events (
  id              VARCHAR PRIMARY KEY,
  target_id       VARCHAR NOT NULL,
  target_kind     VARCHAR NOT NULL,
  op              VARCHAR NOT NULL,
  delta           JSON NOT NULL DEFAULT '{}',
  timestamp       BIGINT NOT NULL,
  source          VARCHAR NOT NULL,
  recording_id    VARCHAR
);

CREATE INDEX IF NOT EXISTS idx_events_target_ts ON events(target_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_recording ON events(recording_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

-- ============================================================================
-- Snapshots (point-in-time state captures for time travel)
-- ============================================================================
CREATE TABLE IF NOT EXISTS snapshots (
  id              VARCHAR PRIMARY KEY,
  target_id       VARCHAR NOT NULL,
  target_kind     VARCHAR NOT NULL,
  state           JSON NOT NULL,
  timestamp       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_target_ts ON snapshots(target_id, timestamp);

-- ============================================================================
-- Conversations (input log)
--
-- Every speech-to-text result, typed input, and SYS-I response is stored.
-- The 'intent' column stores the format "INTENT:EMOTION" (e.g., "ASSERT:curious").
-- Intent is classified by the LLM. Emotion is also LLM-classified from the
-- same response (no extra LLM call — just a colon-separated extension).
--
-- Fixed intent vocabulary: ASSERT, QUERY, CORRECT, EXPLORE, COMMAND, SOCIAL
-- Fixed emotion vocabulary: neutral, excited, frustrated, curious, anxious,
--   confident, hesitant, reflective
--
-- The 'emotion' column stores just the emotion part separately for queries.
-- This denormalization avoids parsing intent:emotion on every read.
-- ============================================================================
CREATE TABLE IF NOT EXISTS conversations (
  id              VARCHAR PRIMARY KEY,
  session_id      VARCHAR NOT NULL,
  timestamp       BIGINT NOT NULL,
  raw_text        VARCHAR NOT NULL,
  source          VARCHAR NOT NULL,
  speaker         VARCHAR NOT NULL DEFAULT 'user',
  processed       BOOLEAN NOT NULL DEFAULT false,
  intent          VARCHAR,
  topic           VARCHAR,
  recording_id    VARCHAR,
  batch_id        VARCHAR,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_recording ON conversations(recording_id);
CREATE INDEX IF NOT EXISTS idx_conv_batch ON conversations(batch_id);
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conv_processed ON conversations(processed);

-- v1 migration: add topic column (safe if already exists)
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS topic VARCHAR;

-- ============================================================================
-- Working Context (LRU + relevance decay window)
--
-- Tracks which nodes are "active" in the user's current working memory.
-- Used by WorkingMemory builder to prioritize what context to give the LLM.
-- ============================================================================
CREATE TABLE IF NOT EXISTS working_context (
  id              VARCHAR PRIMARY KEY,
  node_id         VARCHAR NOT NULL,
  relevance       DOUBLE NOT NULL DEFAULT 1.0,
  last_accessed   BIGINT NOT NULL,
  added_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wc_node ON working_context(node_id);
CREATE INDEX IF NOT EXISTS idx_wc_relevance ON working_context(relevance);

-- ============================================================================
-- Schema metadata
-- ============================================================================
CREATE TABLE IF NOT EXISTS _schema_meta (
  key   VARCHAR PRIMARY KEY,
  value VARCHAR NOT NULL
);

INSERT OR IGNORE INTO _schema_meta (key, value) VALUES ('version', '${SCHEMA_VERSION}');

-- ============================================================================
-- Extraction runs (SYS-II period state — separate from the property graph)
--
-- Tracks which 6-hour periods have been processed by SYS-II.
-- 4 periods/day: p1(12a-6a) p2(6a-12p) p3(12p-6p) p4(6p-12a)
-- ============================================================================
CREATE TABLE IF NOT EXISTS extraction_runs (
  period_key          VARCHAR PRIMARY KEY,
  date                VARCHAR NOT NULL,
  slot                VARCHAR NOT NULL,
  status              VARCHAR NOT NULL DEFAULT 'pending',
  branch_id           VARCHAR,
  conversation_count  INTEGER NOT NULL DEFAULT 0,
  extracted_at        BIGINT,
  compaction          VARCHAR,
  chat_session_id     VARCHAR,
  chat_url            VARCHAR,
  error               VARCHAR,
  entity_count        INTEGER NOT NULL DEFAULT 0,
  memory_count        INTEGER NOT NULL DEFAULT 0,
  goal_count          INTEGER NOT NULL DEFAULT 0,
  topic_count         INTEGER NOT NULL DEFAULT 0,
  relationship_count  INTEGER NOT NULL DEFAULT 0,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL
);

-- v1 migration: add relationship_count (safe if already exists)
ALTER TABLE extraction_runs ADD COLUMN IF NOT EXISTS relationship_count INTEGER;

-- ============================================================================
-- V2 Tables — Embeddings + Ontology System
-- ============================================================================

-- ============================================================================
-- Embeddings (unified vector storage)
--
-- WHY A SEPARATE TABLE:
-- Previously, embeddings lived as a FLOAT[] column on the nodes table.
-- This was limiting because:
--   1. Only nodes could have embeddings (not edges, conversations, or ontology nodes)
--   2. Re-embedding with a different model required updating every node row
--   3. No way to track which model produced which embedding
--
-- The embeddings table decouples vectors from their source entities.
-- Any entity type can have an embedding via target_id + target_kind.
--
-- The 'model' column tracks which model produced the vector, enabling
-- future model upgrades without losing old embeddings.
--
-- The 'source_text' column stores the original text that was embedded,
-- enabling re-embedding if the model changes (no need to reconstruct
-- the text from node properties + edge types).
--
-- Vector search uses: JOIN embeddings ON target_id = nodes.id
-- with DuckDB's array_cosine_similarity() for in-DB cosine similarity.
-- ============================================================================
CREATE TABLE IF NOT EXISTS embeddings (
  id          VARCHAR PRIMARY KEY,
  target_id   VARCHAR NOT NULL,
  target_kind VARCHAR NOT NULL,
  vector      FLOAT[] NOT NULL,
  model       VARCHAR NOT NULL DEFAULT 'bge-small-en-v1.5',
  source_text VARCHAR,
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_emb_target ON embeddings(target_id);
CREATE INDEX IF NOT EXISTS idx_emb_kind ON embeddings(target_kind);

-- ============================================================================
-- Ontology Packages (installed domain templates)
--
-- A package is a downloadable/installable domain template that defines
-- what knowledge to capture about a specific subject area.
--
-- Examples: "Health & Fitness", "Personal Finance", "Project Management"
--
-- Packages are installed from JSON files. The JSON contains nodes, edges,
-- and pre-computed embeddings. On install, these are loaded into the
-- ontology_nodes, ontology_edges, and embeddings tables.
--
-- Status: 'active' means the navigator will consider this package.
-- 'disabled' means it's installed but the navigator ignores it.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ontology_packages (
  id          VARCHAR PRIMARY KEY,
  name        VARCHAR NOT NULL,
  version     VARCHAR NOT NULL,
  description VARCHAR,
  status      VARCHAR NOT NULL DEFAULT 'active',
  installed_at BIGINT NOT NULL
);

-- ============================================================================
-- Ontology Nodes (concepts, slots, probes)
--
-- Three kinds only — everything else is a property, not a node:
--
-- 'concept': A topic area within the domain (e.g., "Sleep Patterns").
--   properties: { name, description, priority (0-1) }
--   Priority determines which concept's slots get asked first.
--
-- 'slot': An empty data point to fill (e.g., "sleep_duration").
--   properties: { name, description, value_type, required,
--                 constraints: { min, max, unit }, examples: [...] }
--   Constraints and examples are PROPERTIES, not separate nodes.
--   This matches how FHIR profiles and CRM systems work — constraints
--   as facets on fields, not as separate entities. Simpler queries,
--   fewer rows, no loss of functionality.
--
-- 'probe': A question template for eliciting a slot value.
--   properties: { question, style ('casual'|'direct'|'reflective') }
--   The navigator loads a probe when it wants to ask about a slot.
--   The LLM decides how to weave the question into conversation naturally.
--   Multiple probes per slot enable variety (rotate least-recently-used).
--
-- WHY NOT MORE KINDS (constraint, example, etc.):
--   Research shows every production ontology system (FHIR, OpenEHR, CRM)
--   puts constraints as properties on slots, not separate entities.
--   Separate constraint nodes would add edge types, JOIN complexity,
--   and more rows — with no practical benefit. The LLM doesn't need
--   a graph traversal to check "is 25 hours valid for sleep_duration?"
--   It just reads the constraint from the slot's properties JSON.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ontology_nodes (
  id          VARCHAR PRIMARY KEY,
  package_id  VARCHAR NOT NULL,
  kind        VARCHAR NOT NULL,
  properties  JSON NOT NULL DEFAULT '{}',
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ont_node_pkg ON ontology_nodes(package_id);
CREATE INDEX IF NOT EXISTS idx_ont_node_kind ON ontology_nodes(kind);

-- ============================================================================
-- Ontology Edges (relationships between ontology nodes)
--
-- Edge types and their meaning:
--
--   HAS_SLOT:       concept → slot    "This concept has this data point"
--   HAS_PROBE:      slot → probe      "This slot can be asked with this question"
--   REQUIRES:       concept → concept "Must explore A before B" (navigator checks)
--   DEPENDS_ON:     slot → slot       "Slot B only after slot A is filled" (navigator checks)
--   RELATED_TO:     concept → concept "Topically related" (informational only)
--   ALTERNATIVE_TO: probe → probe     "Different way to ask same thing" (informational only)
--
-- HAS_SLOT, HAS_PROBE, REQUIRES, DEPENDS_ON are used by the navigator
-- algorithm for deterministic question selection. RELATED_TO and
-- ALTERNATIVE_TO are informational — no special handling in code.
--
-- Adding new edge types costs nothing (just a string in the type column).
-- Only add navigator handling when a type needs deterministic behavior.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ontology_edges (
  id          VARCHAR PRIMARY KEY,
  package_id  VARCHAR NOT NULL,
  start_id    VARCHAR NOT NULL,
  end_id      VARCHAR NOT NULL,
  type        VARCHAR NOT NULL,
  properties  JSON NOT NULL DEFAULT '{}',
  created_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ont_edge_start ON ontology_edges(start_id);
CREATE INDEX IF NOT EXISTS idx_ont_edge_end ON ontology_edges(end_id);
CREATE INDEX IF NOT EXISTS idx_ont_edge_type ON ontology_edges(type);

-- ============================================================================
-- Ontology Coverage (bridge: ontology template ↔ user's instance graph)
--
-- Tracks which slots have been filled with actual user data.
-- This is the provenance link between "what the template asked for"
-- and "what the user actually said."
--
-- The navigator uses this to find unfilled slots:
--   SELECT s.id FROM ontology_nodes s
--   LEFT JOIN ontology_coverage c ON c.slot_id = s.id
--   WHERE s.kind = 'slot' AND (c.filled IS NULL OR c.filled = false)
--
-- 'filled': Boolean — either the slot has been answered or it hasn't.
--   We do NOT track depth levels (0/1/2/3) because the LLM can judge
--   whether an answer is deep enough. Mechanical depth scoring adds
--   complexity without matching LLM judgment quality.
--
-- 'instance_node_id': Points to the actual knowledge node in the user's
--   main graph that filled this slot. This enables:
--   - "What's missing?" → WHERE filled = false
--   - "Where did this come from?" → JOIN instance_node_id → nodes
--   - "Re-probe stale data" → if instance node gets retracted, reset filled
--
-- 'probe_count': How many times we've asked about this slot. Used for
--   exposure control (don't keep asking the same thing — from CAT research).
--
-- 'confidence': How confident the system is in the filled value (0-1).
--   Set by the extraction pipeline based on how clearly the user answered.
-- ============================================================================
CREATE TABLE IF NOT EXISTS ontology_coverage (
  id               VARCHAR PRIMARY KEY,
  slot_id          VARCHAR NOT NULL,
  package_id       VARCHAR NOT NULL,
  instance_node_id VARCHAR,
  filled           BOOLEAN NOT NULL DEFAULT false,
  confidence       DOUBLE NOT NULL DEFAULT 0.0,
  probe_count      INTEGER NOT NULL DEFAULT 0,
  last_probed_at   BIGINT,
  conversation_id  VARCHAR,
  updated_at       BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cov_slot ON ontology_coverage(slot_id);
CREATE INDEX IF NOT EXISTS idx_cov_pkg ON ontology_coverage(package_id);

-- ============================================================================
-- V2 Migrations (run on existing databases upgrading from v1)
-- These are idempotent — safe to run on both fresh and existing databases.
-- ============================================================================

-- Add emotion column to conversations.
-- Stores the emotional tone of the user's turn as a fixed vocabulary term.
-- Classified by the LLM alongside intent (same call, format: "INTENT:EMOTION").
-- Fixed vocabulary: neutral, excited, frustrated, curious, anxious,
--   confident, hesitant, reflective
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS emotion VARCHAR;

-- Add attachments column — JSON array of R2 file attachment metadata.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS attachments VARCHAR DEFAULT '[]';

-- Migrate existing node embeddings to the new embeddings table.
-- This copies all non-null embeddings from nodes.embedding to the
-- dedicated embeddings table. The INSERT OR IGNORE ensures this is
-- idempotent — re-running the migration won't create duplicates.
-- After migration, nodes.embedding is kept for backward compatibility
-- but new code writes to the embeddings table exclusively.
INSERT OR IGNORE INTO embeddings (id, target_id, target_kind, vector, model, source_text, created_at)
  SELECT
    'migrated-' || id,
    id,
    'node',
    embedding,
    'bge-small-en-v1.5',
    NULL,
    updated_at
  FROM nodes
  WHERE embedding IS NOT NULL;

-- Update schema version to v2
UPDATE _schema_meta SET value = '${SCHEMA_VERSION}' WHERE key = 'version';
`
