/**
 * Goal Observer
 *
 * Tracks goals and their progress, detecting new goals,
 * progress updates, blocked goals, and achieved goals.
 */

import type { ObserverOutput, Claim } from '../types';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { BaseObserver } from './baseObserver';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('GoalObserver');

// ============================================================================
// Goal Observer Implementation
// ============================================================================

export class GoalObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'goal_observer',
    name: 'Goal Observer',
    description: 'Tracks goals and their progress',
    triggers: ['new_claim', 'session_end'],
    claimTypeFilter: ['goal', 'intention', 'commitment'],
    priority: 5,
    usesLLM: false,
  };

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();
    const outputs: ObserverOutput[] = [];

    try {
      // Process new goal-related claims
      const goalClaims = this.findGoalClaims(context);

      for (const claim of goalClaims) {
        const existingGoal = await this.findExistingGoal(context, claim);

        if (existingGoal) {
          // Check for progress or status change
          const statusUpdate = this.detectStatusChange(context, existingGoal, claim);

          if (statusUpdate) {
            const output = await this.createOutput(
              context,
              'goal_progress',
              {
                goalId: existingGoal.id,
                goalStatement: existingGoal.statement,
                previousStatus: existingGoal.status,
                newStatus: statusUpdate.status,
                progressChange: statusUpdate.progressChange,
                evidence: claim.statement,
              },
              [claim.id]
            );
            outputs.push(output);
          }
        } else if (claim.claimType === 'goal') {
          // New goal detected - create one
          const output = await this.createOutput(
            context,
            'goal_new',
            {
              claimId: claim.id,
              statement: claim.statement,
              subject: claim.subject,
              stakes: claim.stakes,
            },
            [claim.id]
          );
          outputs.push(output);
        }
      }

      // On session end, check for stalled or blocked goals
      if (context.triggeringClaims.length === 0) {
        const stalledOutputs = await this.checkStalledGoals(context);
        outputs.push(...stalledOutputs);
      }

      logger.info('Goal observation complete', {
        newGoals: outputs.filter((o) => o.outputType === 'goal_new').length,
        progressUpdates: outputs.filter((o) => o.outputType === 'goal_progress').length,
        stalledGoals: outputs.filter((o) => o.outputType === 'goal_stalled').length,
      });

      return this.successResult(outputs, startTime);
    } catch (error) {
      return this.errorResult(
        error instanceof Error ? error.message : 'Unknown error',
        startTime
      );
    }
  }

  /**
   * Find claims related to goals
   */
  private findGoalClaims(context: ObserverContext): Claim[] {
    const allClaims =
      context.triggeringClaims.length > 0
        ? context.triggeringClaims
        : context.recentClaims;

    return allClaims.filter(
      (claim) =>
        claim.claimType === 'goal' ||
        claim.claimType === 'intention' ||
        claim.claimType === 'commitment'
    );
  }

  /**
   * Find existing goal that matches this claim
   */
  private async findExistingGoal(
    context: ObserverContext,
    claim: Claim
  ): Promise<Awaited<ReturnType<typeof context.store.goals.getAll>>[number] | null> {
    const goals = await context.store.goals.getAll();

    // Look for goal with matching subject or statement
    for (const goal of goals) {
      if (
        goal.statement.toLowerCase().includes(claim.subject.toLowerCase()) ||
        claim.statement.toLowerCase().includes(goal.statement.toLowerCase())
      ) {
        return goal;
      }
    }

    return null;
  }

  /**
   * Detect if a claim indicates a status change for a goal
   */
  private detectStatusChange(
    _context: ObserverContext,
    goal: Awaited<ReturnType<typeof _context.store.goals.getAll>>[number],
    claim: Claim
  ): { status: string; progressChange: number } | null {
    const statement = claim.statement.toLowerCase();

    // Check for achievement indicators
    if (
      statement.includes('achieved') ||
      statement.includes('accomplished') ||
      statement.includes('completed') ||
      statement.includes('did it') ||
      statement.includes('finished')
    ) {
      return { status: 'achieved', progressChange: 1.0 - goal.progressValue };
    }

    // Check for abandonment indicators
    if (
      statement.includes('gave up') ||
      statement.includes('abandoned') ||
      statement.includes('no longer') ||
      statement.includes("don't care")
    ) {
      return { status: 'abandoned', progressChange: 0 };
    }

    // Check for blocked indicators
    if (
      statement.includes('blocked') ||
      statement.includes("can't") ||
      statement.includes('stuck') ||
      statement.includes('obstacle')
    ) {
      return { status: 'blocked', progressChange: 0 };
    }

    // Check for progress indicators
    if (
      statement.includes('progress') ||
      statement.includes('step closer') ||
      statement.includes('making headway')
    ) {
      return { status: 'active', progressChange: 0.1 };
    }

    return null;
  }

  /**
   * Check for goals that haven't been mentioned recently
   */
  private async checkStalledGoals(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];
    const allGoals = await context.store.goals.getAll();
    const goals = allGoals.filter((g) => g.status === 'active');

    const oneWeekAgo = now() - 7 * 24 * 60 * 60 * 1000;

    for (const goal of goals) {
      if (goal.lastReferenced < oneWeekAgo) {
        const output = await this.createOutput(
          context,
          'goal_stalled',
          {
            goalId: goal.id,
            statement: goal.statement,
            daysSinceReference: Math.floor(
              (now() - goal.lastReferenced) / (24 * 60 * 60 * 1000)
            ),
            currentProgress: goal.progressValue,
          },
          []
        );
        outputs.push(output);
      }
    }

    return outputs;
  }
}
