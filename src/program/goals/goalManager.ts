/**
 * Goal Manager
 *
 * Manages goals - tracking what the person wants to achieve.
 * Handles goal hierarchy, progress tracking, blockers, and milestones.
 */

import type {
  Goal,
  CreateGoal,
  GoalType,
  GoalTimeframe,
  GoalStatus,
  Milestone,
  Blocker,
  Claim,
  BlockerType,
  BlockerSeverity,
} from '../types';
import type { ProgramStoreInstance } from '../store';
import {
  parseMilestones,
  serializeMilestones,
  parseBlockers,
  serializeBlockers,
} from '../schemas/goal';
import { createLogger } from '../utils/logger';
import { generateId } from '../utils/id';
import { now } from '../utils/time';

const logger = createLogger('Goal');

// ============================================================================
// Types
// ============================================================================

export interface GoalManagerConfig {
  /** Default priority for new goals (1-10) */
  defaultPriority: number;
  /** Maximum depth of goal hierarchy */
  maxHierarchyDepth: number;
}

export interface GoalWithContext extends Goal {
  milestones: Milestone[];
  blockers: Blocker[];
  children: Goal[];
  claimCount: number;
}

export interface GoalTreeNode {
  goal: Goal;
  children: GoalTreeNode[];
  depth: number;
}

export interface GoalProgressUpdate {
  goalId: string;
  previousValue: number;
  newValue: number;
  reason: string;
  evidenceClaimId?: string;
}

const DEFAULT_CONFIG: GoalManagerConfig = {
  defaultPriority: 5,
  maxHierarchyDepth: 4,
};

// ============================================================================
// Goal Manager Implementation
// ============================================================================

export class GoalManager {
  private store: ProgramStoreInstance;
  private config: GoalManagerConfig;

  constructor(store: ProgramStoreInstance, config?: Partial<GoalManagerConfig>) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Create a new goal from a claim
   */
  async createGoal(
    claim: Claim,
    options: {
      goalType: GoalType;
      timeframe: GoalTimeframe;
      parentGoalId?: string;
      motivation?: string;
      deadline?: number;
      priority?: number;
    }
  ): Promise<Goal> {
    // Validate hierarchy depth if parent specified
    if (options.parentGoalId) {
      const depth = await this.getHierarchyDepth(options.parentGoalId);
      if (depth >= this.config.maxHierarchyDepth) {
        throw new Error(`Goal hierarchy too deep (max ${this.config.maxHierarchyDepth} levels)`);
      }
    }

    const data: CreateGoal = {
      statement: claim.statement,
      goalType: options.goalType,
      timeframe: options.timeframe,
      parentGoalId: options.parentGoalId ?? null,
      priority: options.priority ?? this.config.defaultPriority,
      progressType: this.inferProgressType(options.goalType, options.timeframe),
      sourceClaimId: claim.id,
      motivation: options.motivation ?? null,
      deadline: options.deadline ?? null,
      achievedAt: null,
      status: 'active',
      progressValue: 0,
      progressIndicatorsJson: '[]',
      blockersJson: '[]',
    };

    const goal = await this.store.goals.create(data);

    logger.info('Created goal', {
      id: goal.id,
      statement: goal.statement.slice(0, 50),
      type: goal.goalType,
      timeframe: goal.timeframe,
    });

    return goal;
  }

  /**
   * Infer progress type from goal characteristics
   */
  private inferProgressType(
    goalType: GoalType,
    timeframe: GoalTimeframe
  ): 'binary' | 'percentage' | 'milestone' | 'continuous' {
    // Maintenance and process goals are continuous
    if (goalType === 'maintenance' || goalType === 'process') {
      return 'continuous';
    }

    // Short-term outcome goals are often binary
    if (goalType === 'outcome' && (timeframe === 'immediate' || timeframe === 'shortTerm')) {
      return 'binary';
    }

    // Long-term goals use milestones
    if (timeframe === 'longTerm' || timeframe === 'life') {
      return 'milestone';
    }

    // Default to percentage
    return 'percentage';
  }

  /**
   * Get depth of a goal in the hierarchy
   */
  private async getHierarchyDepth(goalId: string): Promise<number> {
    let depth = 0;
    let currentGoal = await this.store.goals.getById(goalId);

    while (currentGoal && currentGoal.parentGoalId) {
      depth++;
      currentGoal = await this.store.goals.getById(currentGoal.parentGoalId);

      // Safety limit
      if (depth > 10) break;
    }

    return depth;
  }

  /**
   * Update goal progress
   */
  async updateProgress(
    goalId: string,
    newValue: number,
    reason: string,
    evidenceClaimId?: string
  ): Promise<GoalProgressUpdate> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    const previousValue = goal.progressValue;
    const clampedValue = Math.max(0, Math.min(100, newValue));

    await this.store.goals.updateProgress(goalId, clampedValue);
    await this.store.goals.updateLastReferenced(goalId);

    // Auto-transition status if progress reaches 100%
    if (clampedValue >= 100 && goal.status === 'active') {
      await this.store.goals.updateStatus(goalId, 'achieved');
      logger.info('Goal achieved', { goalId, statement: goal.statement.slice(0, 50) });
    }

    logger.debug('Updated goal progress', {
      goalId,
      previousValue,
      newValue: clampedValue,
      reason,
    });

    return {
      goalId,
      previousValue,
      newValue: clampedValue,
      reason,
      evidenceClaimId,
    };
  }

  /**
   * Add a milestone to a goal
   */
  async addMilestone(goalId: string, description: string): Promise<Milestone> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    const milestones = parseMilestones(goal.progressIndicatorsJson);

    const milestone: Milestone = {
      id: generateId(),
      description,
      status: 'pending',
      achievedAt: null,
      evidenceClaimId: null,
    };

    milestones.push(milestone);

    await this.store.goals.update(goalId, {
      progressIndicatorsJson: serializeMilestones(milestones),
    });

    logger.debug('Added milestone', { goalId, milestoneId: milestone.id });

    return milestone;
  }

  /**
   * Mark a milestone as achieved
   */
  async achieveMilestone(
    goalId: string,
    milestoneId: string,
    evidenceClaimId?: string
  ): Promise<Milestone | null> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) return null;

    const milestones = parseMilestones(goal.progressIndicatorsJson);
    const milestone = milestones.find((m) => m.id === milestoneId);

    if (!milestone) return null;

    milestone.status = 'achieved';
    milestone.achievedAt = now();
    milestone.evidenceClaimId = evidenceClaimId ?? null;

    await this.store.goals.update(goalId, {
      progressIndicatorsJson: serializeMilestones(milestones),
    });

    // Update progress based on milestone completion
    if (goal.progressType === 'milestone') {
      const achieved = milestones.filter((m) => m.status === 'achieved').length;
      const total = milestones.length;
      const progress = total > 0 ? Math.round((achieved / total) * 100) : 0;
      await this.store.goals.updateProgress(goalId, progress);
    }

    logger.debug('Achieved milestone', { goalId, milestoneId });

    return milestone;
  }

  /**
   * Add a blocker to a goal
   */
  async addBlocker(
    goalId: string,
    description: string,
    blockerType: BlockerType,
    severity: BlockerSeverity,
    resolutionPath?: string
  ): Promise<Blocker> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }

    const blockers = parseBlockers(goal.blockersJson);

    const blocker: Blocker = {
      id: generateId(),
      description,
      blockerType: blockerType,
      severity,
      status: 'active',
      resolutionPath: resolutionPath ?? null,
    };

    blockers.push(blocker);

    await this.store.goals.update(goalId, {
      blockersJson: serializeBlockers(blockers),
    });

    // Update goal status if blocker is severe
    if (severity === 'blocking' && goal.status === 'active') {
      await this.store.goals.updateStatus(goalId, 'blocked');
    }

    logger.debug('Added blocker', { goalId, blockerId: blocker.id, severity });

    return blocker;
  }

  /**
   * Resolve a blocker
   */
  async resolveBlocker(goalId: string, blockerId: string): Promise<Blocker | null> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) return null;

    const blockers = parseBlockers(goal.blockersJson);
    const blocker = blockers.find((b) => b.id === blockerId);

    if (!blocker) return null;

    blocker.status = 'resolved';

    await this.store.goals.update(goalId, {
      blockersJson: serializeBlockers(blockers),
    });

    // Check if goal can be unblocked
    const activeBlockers = blockers.filter(
      (b) => b.status === 'active' && b.severity === 'blocking'
    );

    if (activeBlockers.length === 0 && goal.status === 'blocked') {
      await this.store.goals.updateStatus(goalId, 'active');
      logger.info('Goal unblocked', { goalId });
    }

    logger.debug('Resolved blocker', { goalId, blockerId });

    return blocker;
  }

  /**
   * Get goal with full context
   */
  async getGoalWithContext(goalId: string): Promise<GoalWithContext | null> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) return null;

    const milestones = parseMilestones(goal.progressIndicatorsJson);
    const blockers = parseBlockers(goal.blockersJson);
    const children = await this.store.goals.getChildren(goalId);

    // Count claims related to this goal
    const allClaims = await this.store.claims.getAll();
    const claims = allClaims.filter(
      (c) => c.id === goal.sourceClaimId || c.subject.toLowerCase().includes(goal.statement.toLowerCase().slice(0, 20))
    );

    return {
      ...goal,
      milestones,
      blockers,
      children,
      claimCount: claims.length,
    };
  }

  /**
   * Build goal tree from roots
   */
  async buildGoalTree(): Promise<GoalTreeNode[]> {
    const roots = await this.store.goals.getRoots();
    return Promise.all(roots.map((goal) => this.buildTreeNode(goal, 0)));
  }

  /**
   * Build a tree node recursively
   */
  private async buildTreeNode(goal: Goal, depth: number): Promise<GoalTreeNode> {
    const children = await this.store.goals.getChildren(goal.id);

    return {
      goal,
      children: await Promise.all(children.map((child) => this.buildTreeNode(child, depth + 1))),
      depth,
    };
  }

  /**
   * Find potential parent goals for a claim
   */
  async findRelatedGoals(claim: Claim): Promise<Goal[]> {
    const activeGoals = await this.store.goals.getActive();

    // Simple keyword matching - could be enhanced with embeddings
    const claimWords = claim.statement.toLowerCase().split(/\s+/);

    return activeGoals
      .filter((goal) => {
        const goalWords = goal.statement.toLowerCase().split(/\s+/);
        const overlap = claimWords.filter((w) => goalWords.some((gw) => gw.includes(w) || w.includes(gw)));
        return overlap.length >= 2;
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Infer goal hierarchy from claim relationships
   */
  async inferHierarchy(goalId: string): Promise<{ potentialParents: Goal[]; potentialChildren: Goal[] }> {
    const goal = await this.store.goals.getById(goalId);
    if (!goal) {
      return { potentialParents: [], potentialChildren: [] };
    }

    const allGoalsTemp = await this.store.goals.getAll();
    const allGoals = allGoalsTemp.filter((g) => g.id !== goalId);

    // Goals that could be parents (higher-level, longer timeframe)
    const timeframeRank: Record<GoalTimeframe, number> = {
      immediate: 1,
      shortTerm: 2,
      mediumTerm: 3,
      longTerm: 4,
      life: 5,
    };

    const goalRank = timeframeRank[goal.timeframe];

    const potentialParents = allGoals.filter((g) => {
      // Parent should be longer-term
      if (timeframeRank[g.timeframe] <= goalRank) return false;
      // Parent should not already be our child
      if (g.parentGoalId === goal.id) return false;
      // Basic topic overlap
      return this.hasTopicOverlap(goal.statement, g.statement);
    });

    const potentialChildren = allGoals.filter((g) => {
      // Child should be shorter-term
      if (timeframeRank[g.timeframe] >= goalRank) return false;
      // Should not already have a parent
      if (g.parentGoalId) return false;
      // Basic topic overlap
      return this.hasTopicOverlap(goal.statement, g.statement);
    });

    return { potentialParents, potentialChildren };
  }

  /**
   * Check if two statements have topic overlap
   */
  private hasTopicOverlap(s1: string, s2: string): boolean {
    const words1 = new Set(s1.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const words2 = new Set(s2.toLowerCase().split(/\s+/).filter((w) => w.length > 3));

    let overlap = 0;
    for (const w of words1) {
      if (words2.has(w)) overlap++;
    }

    return overlap >= 2;
  }

  /**
   * Set parent-child relationship
   */
  async setParent(childGoalId: string, parentGoalId: string | null): Promise<void> {
    if (parentGoalId) {
      // Validate parent exists
      const parent = await this.store.goals.getById(parentGoalId);
      if (!parent) {
        throw new Error(`Parent goal not found: ${parentGoalId}`);
      }

      // Check for cycles
      if (await this.wouldCreateCycle(childGoalId, parentGoalId)) {
        throw new Error('Setting this parent would create a cycle');
      }
    }

    await this.store.goals.update(childGoalId, {
      parentGoalId: parentGoalId,
    });

    logger.debug('Set goal parent', { childGoalId, parentGoalId });
  }

  /**
   * Check if setting a parent would create a cycle
   */
  private async wouldCreateCycle(childId: string, proposedParentId: string): Promise<boolean> {
    let current = proposedParentId;
    const visited = new Set<string>();

    while (current) {
      if (current === childId) return true;
      if (visited.has(current)) return false;
      visited.add(current);

      const goal = await this.store.goals.getById(current);
      current = goal?.parentGoalId ?? '';
    }

    return false;
  }

  /**
   * Update goal status
   */
  async updateStatus(goalId: string, status: GoalStatus): Promise<void> {
    await this.store.goals.updateStatus(goalId, status);
    await this.store.goals.updateLastReferenced(goalId);

    logger.info('Updated goal status', { goalId, status });
  }

  /**
   * Get summary of all goals grouped by status
   */
  async getGoalsSummary(): Promise<Record<GoalStatus, Goal[]>> {
    const statuses: GoalStatus[] = ['active', 'achieved', 'abandoned', 'blocked', 'dormant', 'superseded'];

    const result: Record<GoalStatus, Goal[]> = {
      active: [],
      achieved: [],
      abandoned: [],
      blocked: [],
      dormant: [],
      superseded: [],
    };

    for (const status of statuses) {
      result[status] = await this.store.goals.getByStatus(status);
    }

    return result;
  }
}

/**
 * Create a goal manager instance
 */
export function createGoalManager(
  store: ProgramStoreInstance,
  config?: Partial<GoalManagerConfig>
): GoalManager {
  return new GoalManager(store, config);
}
