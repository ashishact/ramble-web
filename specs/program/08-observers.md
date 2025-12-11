# Layer 8: Observer System

## Observer Architecture

```typescript
interface Observer {
  id: string;
  type: ObserverType;

  // When to run
  triggers: ObserverTrigger[];

  // What to do
  process: (context: ObserverContext) => Promise<ObserverOutput[]>;

  // Priority (for ordering when multiple observers triggered)
  priority: number;

  // Active state
  active: boolean;
}

type ObserverType =
  | 'pattern_observer'
  | 'concern_observer'
  | 'goal_observer'
  | 'contradiction_observer'
  | 'narrative_observer'
  | 'relationship_observer'
  | 'consolidation_observer';

interface ObserverTrigger {
  type: 'new_claim' | 'claim_update' | 'session_end' | 'schedule' | 'manual';
  claimType?: string; // For new_claim triggers
  pattern?: string; // For schedule triggers (cron-like)
}

interface ObserverContext {
  trigger: ObserverTrigger;
  newClaims: Claim[];
  sessionId: string | null;
  timestamp: number;
}

interface ObserverOutput {
  type: string;
  [key: string]: any;
}
```

## Core Observers

### Pattern Observer

Detects recurring themes:

```typescript
const patternObserver: Observer = {
  id: 'observer_patterns',
  type: 'pattern_observer',
  priority: 5,
  active: true,

  triggers: [
    { type: 'schedule', pattern: 'every_10_claims' }
  ],

  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const recentClaims = await getRecentClaims(50);
    const outputs: ObserverOutput[] = [];

    // Group claims by subject
    const subjectGroups = groupBy(recentClaims, 'subject');

    for (const [subject, claims] of Object.entries(subjectGroups)) {
      if (claims.length >= 3) {
        const existingPattern = await findPattern(subject);

        if (existingPattern) {
          outputs.push({
            type: 'pattern_reinforced',
            patternId: existingPattern.id,
            newClaimIds: claims.map(c => c.id)
          });
        } else {
          outputs.push({
            type: 'pattern_detected',
            pattern: {
              pattern_type: 'recurring_topic',
              description: `Recurring discussion of: ${subject}`,
              evidence_claims: claims.map(c => c.id)
            }
          });
        }
      }
    }

    // Also check for emotional patterns
    const emotionalClaims = recentClaims.filter(c => c.emotional_intensity > 0.5);
    const emotionGroups = groupBy(emotionalClaims, 'emotional_valence',
      v => v > 0.3 ? 'positive' : v < -0.3 ? 'negative' : 'neutral');

    if (emotionGroups['negative']?.length >= 3) {
      outputs.push({
        type: 'pattern_detected',
        pattern: {
          pattern_type: 'emotional_pattern',
          description: 'Recurring negative emotional expressions',
          evidence_claims: emotionGroups['negative'].map(c => c.id)
        }
      });
    }

    return outputs;
  }
};
```

### Contradiction Observer

Detects conflicting beliefs:

```typescript
const contradictionObserver: Observer = {
  id: 'observer_contradictions',
  type: 'contradiction_observer',
  priority: 3,
  active: true,

  triggers: [
    { type: 'new_claim', claimType: 'belief' },
    { type: 'new_claim', claimType: 'factual' }
  ],

  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const outputs: ObserverOutput[] = [];

    for (const claim of context.newClaims) {
      // Find claims about the same subject
      const relatedClaims = await getClaimsAboutSubject(claim.subject, {
        excludeId: claim.id,
        state: 'active'
      });

      // Use LLM to check for contradictions
      if (relatedClaims.length > 0) {
        const contradictions = await detectContradictions(claim, relatedClaims);

        for (const contradiction of contradictions) {
          outputs.push({
            type: 'contradiction_detected',
            newClaimId: claim.id,
            existingClaimId: contradiction.claimId,
            contradictionType: contradiction.type,
            explanation: contradiction.explanation
          });
        }
      }
    }

    return outputs;
  }
};
```

### Narrative Observer

Identifies recurring stories and self-narratives:

```typescript
const narrativeObserver: Observer = {
  id: 'observer_narrative',
  type: 'narrative_observer',
  priority: 2,
  active: true,

  triggers: [
    { type: 'schedule', pattern: 'weekly' }
  ],

  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const selfClaims = await getClaimsByType('self_perception', { limit: 50 });
    const memoryClaims = await getClaimsByType('memory_reference', { limit: 50 });

    const narrativeAnalysis = await analyzeNarratives(selfClaims, memoryClaims);

    return [{
      type: 'narrative_analysis',
      dominantSelfNarratives: narrativeAnalysis.selfNarratives,
      recurringStories: narrativeAnalysis.recurringStories,
      identityThemes: narrativeAnalysis.identityThemes
    }];
  }
};
```

### Consolidation Observer

Memory consolidation at session end:

```typescript
const consolidationObserver: Observer = {
  id: 'observer_consolidation',
  type: 'consolidation_observer',
  priority: 1,
  active: true,

  triggers: [
    { type: 'session_end' }
  ],

  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    const sessionClaims = await getSessionClaims(context.sessionId);
    const outputs: ObserverOutput[] = [];

    for (const claim of sessionClaims) {
      const score = calculateConsolidationScore(claim);

      if (score >= CONSOLIDATION_THRESHOLD) {
        outputs.push({
          type: 'consolidate_to_long_term',
          claimId: claim.id,
          score: score,
          factors: getConsolidationFactors(claim)
        });
      }
    }

    return outputs;
  }
};

function calculateConsolidationScore(claim: Claim): number {
  let score = 0;

  // Emotional intensity
  score += claim.emotional_intensity * 0.3;

  // High stakes
  if (claim.stakes === 'high' || claim.stakes === 'existential') {
    score += 0.3;
  }

  // Repeated mentions
  score += Math.min(claim.confirmation_count * 0.1, 0.2);

  // Explicit importance markers
  if (claim.statement.toLowerCase().includes('important') ||
      claim.statement.toLowerCase().includes('remember')) {
    score += 0.2;
  }

  return Math.min(score, 1);
}
```

## Observer Dispatcher

```typescript
class ObserverDispatcher {
  private observers: Map<string, Observer> = new Map();
  private queue: DurableQueue;

  constructor(queue: DurableQueue) {
    this.queue = queue;

    // Register core observers
    this.register(patternObserver);
    this.register(concernObserver);
    this.register(contradictionObserver);
    this.register(narrativeObserver);
    this.register(relationshipObserver);
    this.register(consolidationObserver);
    this.register(goalObserver);
  }

  register(observer: Observer): void {
    this.observers.set(observer.id, observer);
  }

  async dispatch(event: ObserverEvent): Promise<void> {
    // Find all observers that should trigger
    const triggeredObservers = Array.from(this.observers.values())
      .filter(obs => obs.active && this.shouldTrigger(obs, event))
      .sort((a, b) => b.priority - a.priority);

    // Queue observer tasks
    for (const observer of triggeredObservers) {
      await this.queue.enqueue({
        type: 'run_observer',
        payload: {
          observerId: observer.id,
          context: {
            trigger: event.trigger,
            newClaims: event.newClaims || [],
            sessionId: event.sessionId,
            timestamp: Date.now()
          }
        },
        priority: observer.priority,
        maxAttempts: 3,
        executeAt: Date.now()
      });
    }
  }

  private shouldTrigger(observer: Observer, event: ObserverEvent): boolean {
    return observer.triggers.some(trigger => {
      if (trigger.type !== event.trigger.type) return false;

      if (trigger.type === 'new_claim' && trigger.claimType) {
        return event.newClaims?.some(c => c.claim_type === trigger.claimType);
      }

      return true;
    });
  }
}
```

---

## Navigation

- Previous: [07-queue.md](./07-queue.md)
- Next: [09-mind-modeling.md](./09-mind-modeling.md)
