# Layer 6: Goal System

## Goal Structure

```typescript
interface Goal {
  id: string;
  statement: string;

  // Type classification
  goal_type: 'outcome' | 'process' | 'identity' | 'avoidance' | 'maintenance';

  // Temporal
  timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'life';
  deadline: number | null;

  // Hierarchy
  parent_goal_id: string | null;
  child_goal_ids: string[];

  // Status
  status: 'active' | 'achieved' | 'abandoned' | 'blocked' | 'dormant' | 'superseded';

  // Progress
  progress_type: 'binary' | 'percentage' | 'milestone' | 'continuous';
  progress_value: number; // 0-100 for percentage, milestone count, etc.
  milestones: Milestone[];

  // Blockers
  blockers: Blocker[];

  // Motivation
  motivation: string;
  underlying_value_ids: string[];

  // Evidence
  source_claim_ids: string[];
  evidence_claim_ids: string[];

  // Metadata
  created_at: number;
  last_referenced: number;
  priority: number;
}

interface Milestone {
  id: string;
  description: string;
  status: 'pending' | 'achieved' | 'skipped';
  achieved_at: number | null;
  evidence_claim_id: string | null;
}

interface Blocker {
  id: string;
  description: string;
  type: 'resource' | 'knowledge' | 'skill' | 'external' | 'internal' | 'dependency';
  severity: 'minor' | 'significant' | 'blocking';
  status: 'active' | 'resolved' | 'accepted';
  resolution_path: string | null;
}
```

## Goal Tree Visualization

```typescript
interface GoalTree {
  // Life-level goals at root
  roots: GoalNode[];
}

interface GoalNode {
  goal: Goal;
  children: GoalNode[];

  // Computed metrics
  overall_progress: number;
  health_status: 'healthy' | 'at_risk' | 'stalled' | 'blocked';
  attention_needed: boolean;
}

function buildGoalTree(goals: Goal[]): GoalTree {
  // Find roots (goals with no parent)
  const roots = goals.filter(g => !g.parent_goal_id);

  // Recursively build tree
  return {
    roots: roots.map(root => buildGoalNode(root, goals))
  };
}

function buildGoalNode(goal: Goal, allGoals: Goal[]): GoalNode {
  const children = allGoals.filter(g => g.parent_goal_id === goal.id);

  const childNodes = children.map(c => buildGoalNode(c, allGoals));

  // Calculate overall progress (weighted average of children if has children)
  const overall_progress = childNodes.length > 0
    ? childNodes.reduce((sum, n) => sum + n.overall_progress, 0) / childNodes.length
    : goal.progress_value;

  // Determine health status
  const health_status = calculateHealthStatus(goal, childNodes);

  return {
    goal,
    children: childNodes,
    overall_progress,
    health_status,
    attention_needed: health_status === 'blocked' || health_status === 'stalled'
  };
}
```

## Goal Observer

```typescript
const goalObserver: Observer = {
  id: 'observer_goals',
  type: 'goal_observer',

  triggers: [
    { type: 'new_claim', claimType: 'goal' },
    { type: 'new_claim', claimType: 'intention' },
    { type: 'schedule', pattern: 'daily' }
  ],

  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];

    // 1. Check for new goals from claims
    const goalClaims = context.newClaims.filter(c => c.claim_type === 'goal');
    for (const claim of goalClaims) {
      const existingGoal = await findSimilarGoal(claim);
      if (existingGoal) {
        outputs.push({
          type: 'goal_update',
          goalId: existingGoal.id,
          update: { last_referenced: Date.now() }
        });
      } else {
        outputs.push({
          type: 'goal_create',
          goal: await constructGoalFromClaim(claim)
        });
      }
    }

    // 2. Check for progress indicators
    const progressClaims = context.newClaims.filter(c =>
      c.statement.toLowerCase().includes('progress') ||
      c.statement.toLowerCase().includes('done') ||
      c.statement.toLowerCase().includes('finished') ||
      c.statement.toLowerCase().includes('completed')
    );

    for (const claim of progressClaims) {
      const relatedGoal = await findRelatedGoal(claim);
      if (relatedGoal) {
        outputs.push({
          type: 'goal_progress',
          goalId: relatedGoal.id,
          claim: claim,
          suggestedProgress: await estimateProgress(claim, relatedGoal)
        });
      }
    }

    // 3. Check for blockers
    const blockerClaims = context.newClaims.filter(c =>
      c.claim_type === 'concern' ||
      c.statement.toLowerCase().includes('stuck') ||
      c.statement.toLowerCase().includes("can't") ||
      c.statement.toLowerCase().includes('blocked')
    );

    for (const claim of blockerClaims) {
      const relatedGoal = await findRelatedGoal(claim);
      if (relatedGoal) {
        outputs.push({
          type: 'blocker_detected',
          goalId: relatedGoal.id,
          blocker: await constructBlockerFromClaim(claim)
        });
      }
    }

    // 4. Daily: Check for stale goals
    if (context.trigger.type === 'schedule') {
      const staleGoals = await findStaleGoals();
      for (const goal of staleGoals) {
        outputs.push({
          type: 'goal_stale',
          goalId: goal.id,
          daysSinceReference: daysSince(goal.last_referenced)
        });
      }
    }

    return outputs;
  }
};
```

## Goal Hierarchy Inference

```typescript
async function inferGoalHierarchy(newGoal: Goal, existingGoals: Goal[]): Promise<string | null> {
  // Use LLM to determine if this goal is a sub-goal of an existing goal

  const prompt = `Given these existing goals:
${existingGoals.map((g, i) => `${i + 1}. ${g.statement} (${g.timeframe})`).join('\n')}

And this new goal:
"${newGoal.statement}" (${newGoal.timeframe})

Is the new goal a sub-goal or component of any existing goal? If yes, which one?
Respond with the number of the parent goal, or "none" if it's independent.`;

  const response = await llm.complete({ prompt });

  if (response === 'none') return null;

  const parentIndex = parseInt(response) - 1;
  return existingGoals[parentIndex]?.id || null;
}
```

---

## Navigation

- Previous: [05-thought-chains.md](./05-thought-chains.md)
- Next: [07-queue.md](./07-queue.md)
