/**
 * DuckDB Schema DDL
 *
 * All tables for the Neo4j-style property graph, event log,
 * snapshots, branches, conversations, and working context.
 *
 * DuckDB supports JSON, arrays (LIST), and FLOAT[] natively —
 * no need for JSON stringification hacks.
 */

export const SCHEMA_VERSION = 1

export const CREATE_TABLES = `
-- ============================================================================
-- Branches (git-like, must exist before nodes/edges reference them)
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
-- Conversations (input log — replaces WatermelonDB conversations table)
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
  recording_id    VARCHAR,
  batch_id        VARCHAR,
  created_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conv_recording ON conversations(recording_id);
CREATE INDEX IF NOT EXISTS idx_conv_batch ON conversations(batch_id);
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);
CREATE INDEX IF NOT EXISTS idx_conv_processed ON conversations(processed);

-- ============================================================================
-- Working Context (LRU + relevance decay window)
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
`
