/**
 * BranchManager — Git-Like Day Branches
 *
 * Each day automatically gets its own branch. Writes go to the day branch.
 * Queries can overlay day branch on top of global (branch shadows global).
 * At end of day (or on demand), branch is merged into global.
 *
 * Branch hierarchy:
 *   global (root)
 *   ├── day/2024-03-12
 *   ├── day/2024-03-13
 *   └── manual/experiment-1
 */

import type { GraphService } from '../GraphService'
import type { GraphBranch } from '../types'
import { nid } from '../../program/utils/id'

export class BranchManager {
  private graph: GraphService

  constructor(graph: GraphService) {
    this.graph = graph
  }

  // ==========================================================================
  // Branch Lifecycle
  // ==========================================================================

  /**
   * Create a named branch under a parent.
   */
  async createBranch(name: string, parentBranchId = 'global'): Promise<GraphBranch> {
    const id = nid.branch()
    const now = Date.now()

    await this.graph.exec(
      `INSERT INTO branches (id, name, parent_branch_id, created_at, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [id, name, parentBranchId, now]
    )

    return {
      id,
      name,
      parent_branch_id: parentBranchId,
      created_at: now,
      merged_at: null,
      status: 'active',
    }
  }

  /**
   * Get or create today's day branch.
   * Name format: "day/YYYY-MM-DD"
   */
  async getOrCreateDayBranch(): Promise<GraphBranch> {
    const today = new Date().toISOString().split('T')[0]
    const name = `day/${today}`

    // Check if today's branch exists
    const existing = await this.graph.query<GraphBranch>(
      `SELECT * FROM branches WHERE name = $1 AND status = 'active'`,
      [name]
    )

    if (existing.length > 0) return existing[0]

    // Create today's branch
    return this.createBranch(name, 'global')
  }

  /**
   * Get a branch by ID.
   */
  async getBranch(branchId: string): Promise<GraphBranch | null> {
    const rows = await this.graph.query<GraphBranch>(
      `SELECT * FROM branches WHERE id = $1`,
      [branchId]
    )
    return rows[0] ?? null
  }

  /**
   * List all active branches.
   */
  async listActive(): Promise<GraphBranch[]> {
    return this.graph.query<GraphBranch>(
      `SELECT * FROM branches WHERE status = 'active' ORDER BY created_at DESC`
    )
  }

  // ==========================================================================
  // Overlay Queries
  // ==========================================================================

  /**
   * Query nodes with branch overlay.
   * Branch nodes shadow global nodes with the same ID.
   *
   * Returns: all global nodes + branch-specific nodes,
   * where branch versions override global versions.
   */
  async queryNodesWithOverlay(
    branchId: string,
    whereSql = '',
    params: unknown[] = []
  ): Promise<Record<string, unknown>[]> {
    // Use a CTE that prefers branch nodes over global
    const sql = `
      WITH overlay AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY
          CASE WHEN branch_id = $1 THEN 0 ELSE 1 END
        ) AS rn
        FROM nodes
        WHERE branch_id IN ($1, 'global')
      )
      SELECT * FROM overlay WHERE rn = 1 ${whereSql ? 'AND ' + whereSql : ''}
    `
    return this.graph.query(sql, [branchId, ...params])
  }

  /**
   * Query edges with branch overlay (same logic as nodes).
   */
  async queryEdgesWithOverlay(
    branchId: string,
    whereSql = '',
    params: unknown[] = []
  ): Promise<Record<string, unknown>[]> {
    const sql = `
      WITH overlay AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY id ORDER BY
          CASE WHEN branch_id = $1 THEN 0 ELSE 1 END
        ) AS rn
        FROM edges
        WHERE branch_id IN ($1, 'global')
      )
      SELECT * FROM overlay WHERE rn = 1 ${whereSql ? 'AND ' + whereSql : ''}
    `
    return this.graph.query(sql, [branchId, ...params])
  }

  // ==========================================================================
  // Merge
  // ==========================================================================

  /**
   * Merge a branch into global.
   * Branch wins on conflicts (nodes/edges with same ID).
   * After merge, branch status is set to 'merged'.
   */
  async mergeBranch(branchId: string): Promise<void> {
    // Move all branch nodes to global (upsert)
    await this.graph.exec(
      `INSERT OR REPLACE INTO nodes
       SELECT id, 'global' AS branch_id, labels, properties, embedding, created_at, updated_at
       FROM nodes WHERE branch_id = $1`,
      [branchId]
    )

    // Move all branch edges to global (upsert)
    await this.graph.exec(
      `INSERT OR REPLACE INTO edges
       SELECT id, 'global' AS branch_id, start_id, end_id, type, properties, created_at, updated_at
       FROM edges WHERE branch_id = $1`,
      [branchId]
    )

    // Delete the branch copies (now in global)
    await this.graph.exec(`DELETE FROM nodes WHERE branch_id = $1`, [branchId])
    await this.graph.exec(`DELETE FROM edges WHERE branch_id = $1`, [branchId])

    // Mark branch as merged
    await this.graph.exec(
      `UPDATE branches SET status = 'merged', merged_at = $1 WHERE id = $2`,
      [Date.now(), branchId]
    )
  }
}
