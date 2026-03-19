/**
 * TimeTravel — Snapshot + Delta Replay
 *
 * Reconstructs the state of any node at any point in time:
 * 1. Find the nearest snapshot BEFORE the target timestamp
 * 2. Find all events AFTER that snapshot and BEFORE the target timestamp
 * 3. Replay deltas on top of the snapshot
 *
 * Snapshots are created periodically (e.g. hourly) to bound replay cost.
 */

import type { GraphService } from '../GraphService'
import type { GraphSnapshot, GraphEvent } from '../types'
import { nid } from '../../program/utils/id'

export class TimeTravel {
  private graph: GraphService

  constructor(graph: GraphService) {
    this.graph = graph
  }

  // ==========================================================================
  // State Reconstruction
  // ==========================================================================

  /**
   * Get the state of a node at a specific timestamp.
   * Returns null if no data exists for this node before the given time.
   */
  async getStateAt(
    nodeId: string,
    timestamp: number
  ): Promise<Record<string, unknown> | null> {
    // 1. Find the nearest snapshot before timestamp
    const snapshots = await this.graph.query<GraphSnapshot>(
      `SELECT * FROM snapshots
       WHERE target_id = $1 AND timestamp <= $2
       ORDER BY timestamp DESC LIMIT 1`,
      [nodeId, timestamp]
    )

    let state: Record<string, unknown>

    if (snapshots.length > 0) {
      const snap = snapshots[0]
      state = typeof snap.state === 'string' ? JSON.parse(snap.state) : snap.state
    } else {
      // No snapshot — start from empty and replay all events
      state = {}
    }

    // 2. Find events between snapshot and target timestamp
    const snapshotTime = snapshots.length > 0 ? snapshots[0].timestamp : 0
    const events = await this.graph.query<GraphEvent>(
      `SELECT * FROM events
       WHERE target_id = $1 AND timestamp > $2 AND timestamp <= $3
       ORDER BY timestamp ASC`,
      [nodeId, snapshotTime, timestamp]
    )

    // 3. Replay deltas
    for (const event of events) {
      const delta = typeof event.delta === 'string' ? JSON.parse(event.delta) : event.delta

      switch (event.op) {
        case 'create':
          state = { ...delta }
          break
        case 'update':
          state = { ...state, ...delta }
          break
        case 'delete':
          return null // Node was deleted before target time
        case 'merge':
          state = { ...state, ...delta }
          break
        case 'retract':
          state = { ...state, state: 'retracted' }
          break
      }
    }

    return Object.keys(state).length > 0 ? state : null
  }

  // ==========================================================================
  // Snapshot Management
  // ==========================================================================

  /**
   * Create a snapshot of a node's current state.
   * Call this periodically to bound time-travel replay cost.
   */
  async createSnapshot(nodeId: string): Promise<void> {
    const node = await this.graph.query<{ properties: Record<string, unknown> }>(
      `SELECT properties FROM nodes WHERE id = $1`,
      [nodeId]
    )

    if (node.length === 0) return

    const state = node[0].properties ?? {}

    await this.graph.exec(
      `INSERT INTO snapshots (id, target_id, target_kind, state, timestamp)
       VALUES ($1, $2, 'node', $3, $4)`,
      [nid.snapshot(), nodeId, JSON.stringify(state), Date.now()]
    )
  }

  /**
   * Bulk create snapshots for multiple nodes.
   */
  async createSnapshots(nodeIds: string[]): Promise<void> {
    if (nodeIds.length === 0) return

    const placeholders = nodeIds.map((_, i) => `$${i + 1}`).join(', ')
    const nodes = await this.graph.query<{ id: string; properties: Record<string, unknown> }>(
      `SELECT id, properties FROM nodes WHERE id IN (${placeholders})`,
      nodeIds
    )

    const now = Date.now()
    const statements = nodes.map(node => {
      const state = JSON.stringify(node.properties)

      return {
        sql: `INSERT INTO snapshots (id, target_id, target_kind, state, timestamp)
              VALUES ($1, $2, 'node', $3, $4)`,
        params: [nid.snapshot(), node.id, state, now],
      }
    })

    await this.graph.batch(statements)
  }

  // ==========================================================================
  // Event Log
  // ==========================================================================

  /**
   * Record an event in the audit log.
   */
  async recordEvent(event: {
    targetId: string
    targetKind: 'node' | 'edge'
    op: string
    delta: Record<string, unknown>
    source: string
    recordingId?: string
  }): Promise<void> {
    const id = nid.event()

    await this.graph.exec(
      `INSERT INTO events (id, target_id, target_kind, op, delta, timestamp, source, recording_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        event.targetId,
        event.targetKind,
        event.op,
        JSON.stringify(event.delta),
        Date.now(),
        event.source,
        event.recordingId ?? null,
      ]
    )
  }

  /**
   * Get the event history for a node.
   */
  async getHistory(
    nodeId: string,
    limit = 50
  ): Promise<GraphEvent[]> {
    return this.graph.query<GraphEvent>(
      `SELECT * FROM events
       WHERE target_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [nodeId, limit]
    )
  }
}
