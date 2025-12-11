/**
 * Relationship Observer
 *
 * Tracks interpersonal dynamics, relationship health, and changes
 * in how the person talks about important people in their life.
 */

import type { ObserverOutput, Claim } from '../types';
import type { ObserverConfig, ObserverContext, ObserverResult } from './types';
import { BaseObserver } from './baseObserver';
import { createLogger } from '../utils/logger';
import { now } from '../utils/time';

const logger = createLogger('RelationshipObserver');

// ============================================================================
// Relationship Observer Implementation
// ============================================================================

interface RelationshipData {
  entityId: string;
  name: string;
  mentionCount: number;
  avgValence: number;
  avgIntensity: number;
  recentClaims: Claim[];
}

export class RelationshipObserver extends BaseObserver {
  config: ObserverConfig = {
    type: 'relationship_observer',
    name: 'Relationship Observer',
    description: 'Tracks interpersonal dynamics',
    triggers: ['new_claim', 'schedule'],
    claimTypeFilter: ['relationship'],
    priority: 4,
    usesLLM: false,
  };

  async run(context: ObserverContext): Promise<ObserverResult> {
    const startTime = now();
    const outputs: ObserverOutput[] = [];

    try {
      // Handle new relationship claims
      const relationshipClaims = context.triggeringClaims.filter(
        (c) => c.claimType === 'relationship'
      );

      for (const claim of relationshipClaims) {
        const output = this.createOutput(
          context,
          'relationship_update',
          {
            claimId: claim.id,
            statement: claim.statement,
            subject: claim.subject,
            valence: claim.emotionalValence,
            intensity: claim.emotionalIntensity,
          },
          [claim.id]
        );
        outputs.push(output);
      }

      // For schedule triggers, generate relationship report
      if (context.triggeringClaims.length === 0) {
        const report = this.generateRelationshipReport(context);
        if (report) {
          const output = this.createOutput(
            context,
            'relationship_report',
            report,
            report.relationships.flatMap((r) => r.recentClaims.map((c) => c.id))
          );
          outputs.push(output);
        }
      }

      logger.info('Relationship observation complete', {
        updates: outputs.filter((o) => o.output_type === 'relationship_update').length,
        hasReport: outputs.some((o) => o.output_type === 'relationship_report'),
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
   * Generate a comprehensive relationship report
   */
  private generateRelationshipReport(context: ObserverContext): {
    relationships: RelationshipData[];
    dynamics: {
      positive: string[];
      concerning: string[];
      changed: string[];
    };
    timestamp: number;
  } | null {
    // Get all person entities
    const entities = context.store.entities
      .getAll()
      .filter((e) => e.entityType === 'person');

    if (entities.length === 0) {
      return null;
    }

    // Get all relationship claims
    const allClaims = context.store.claims.getAll();
    const relationshipClaims = allClaims.filter(
      (c) => c.claimType === 'relationship'
    );

    // Build relationship data for each person
    const relationships: RelationshipData[] = [];

    for (const entity of entities) {
      const relatedClaims = relationshipClaims.filter(
        (c) =>
          c.subject.toLowerCase().includes(entity.canonicalName.toLowerCase()) ||
          c.statement.toLowerCase().includes(entity.canonicalName.toLowerCase())
      );

      if (relatedClaims.length === 0) continue;

      const avgValence =
        relatedClaims.reduce((sum, c) => sum + c.emotionalValence, 0) /
        relatedClaims.length;

      const avgIntensity =
        relatedClaims.reduce((sum, c) => sum + c.emotionalIntensity, 0) /
        relatedClaims.length;

      relationships.push({
        entityId: entity.id,
        name: entity.canonicalName,
        mentionCount: entity.mentionCount,
        avgValence,
        avgIntensity,
        recentClaims: relatedClaims.slice(-5),
      });
    }

    if (relationships.length === 0) {
      return null;
    }

    // Analyze dynamics
    const dynamics = this.analyzeDynamics(relationships);

    return {
      relationships,
      dynamics,
      timestamp: now(),
    };
  }

  /**
   * Analyze relationship dynamics
   */
  private analyzeDynamics(relationships: RelationshipData[]): {
    positive: string[];
    concerning: string[];
    changed: string[];
  } {
    const positive: string[] = [];
    const concerning: string[] = [];
    const changed: string[] = [];

    for (const rel of relationships) {
      // Positive relationships
      if (rel.avgValence > 0.3 && rel.mentionCount >= 2) {
        positive.push(`${rel.name}: Generally positive (avg valence: ${rel.avgValence.toFixed(2)})`);
      }

      // Concerning relationships
      if (rel.avgValence < -0.3 && rel.avgIntensity > 0.5) {
        concerning.push(
          `${rel.name}: Negative with high emotional intensity`
        );
      }

      // Check for change over time (if we have enough claims)
      if (rel.recentClaims.length >= 3) {
        const earlyValence = rel.recentClaims
          .slice(0, Math.floor(rel.recentClaims.length / 2))
          .reduce((sum, c) => sum + c.emotionalValence, 0) /
          Math.floor(rel.recentClaims.length / 2);

        const lateValence = rel.recentClaims
          .slice(Math.floor(rel.recentClaims.length / 2))
          .reduce((sum, c) => sum + c.emotionalValence, 0) /
          (rel.recentClaims.length - Math.floor(rel.recentClaims.length / 2));

        const change = lateValence - earlyValence;
        if (Math.abs(change) > 0.3) {
          changed.push(
            `${rel.name}: Sentiment ${change > 0 ? 'improved' : 'declined'} (Δ${change.toFixed(2)})`
          );
        }
      }
    }

    return { positive, concerning, changed };
  }
}
