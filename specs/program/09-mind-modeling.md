# Layer 9: Additional Mind Modeling Components

## 1. Attention/Salience System

What's top of mind right now?

```typescript
interface AttentionSystem {
  // Get currently salient topics/entities/goals
  getTopOfMind(): Promise<TopOfMind>;

  // Update salience based on new input
  updateSalience(unitId: string): Promise<void>;
}

interface TopOfMind {
  topics: Array<{ topic: string; salience: number; lastMentioned: number }>;
  entities: Array<{ entity: string; salience: number }>;
  goals: Array<{ goalId: string; salience: number }>;
  concerns: Array<{ concern: string; salience: number }>;
  openQuestions: Array<{ question: string; salience: number }>;
}

// Salience decays over time but spikes with mentions
function calculateSalience(item: SalienceItem): number {
  const timeSinceLastMention = Date.now() - item.lastMentioned;
  const decayFactor = Math.exp(-timeSinceLastMention / SALIENCE_HALFLIFE);

  return item.baseSalience * decayFactor * item.mentionBoost;
}
```

## 2. Worldview/Mental Model System

How does this person understand the world to work?

```typescript
interface WorldModel {
  // Domain-specific beliefs about how things work
  domains: Map<string, DomainModel>;

  // Core assumptions
  assumptions: Assumption[];

  // Heuristics they use
  heuristics: Heuristic[];
}

interface DomainModel {
  domain: string; // "work", "relationships", "health", etc.

  // Causal beliefs in this domain
  causalBeliefs: CausalBelief[];

  // What they consider important
  priorities: string[];

  // Their typical approach
  defaultStrategies: string[];

  // Known exceptions
  exceptions: string[];
}

interface Assumption {
  statement: string;
  domain: string;
  implicitness: 'explicit' | 'inferred';
  sourceClaimIds: string[];
}

interface Heuristic {
  statement: string; // e.g., "Always sleep on big decisions"
  domain: string;
  reliability: number; // How often they follow it
  sourceClaimIds: string[];
}
```

## 3. Temporal Self System

Past, present, and future self-concept:

```typescript
interface TemporalSelf {
  // Who they were
  pastSelf: SelfSnapshot[];

  // Who they are now
  currentSelf: CurrentSelfModel;

  // Who they want to become
  futureSelf: FutureSelfModel;

  // Continuity - what connects these
  continuityNarrative: string;
}

interface SelfSnapshot {
  timeperiod: string;
  description: string;
  keyTraits: string[];
  keyEvents: string[];
  relationship_to_current: 'evolved_from' | 'reacted_against' | 'continuous_with';
}

interface CurrentSelfModel {
  coreIdentity: string[];
  roles: string[];
  traits: Array<{ trait: string; confidence: number }>;
  strengths: string[];
  weaknesses: string[];
  currentChallenges: string[];
}

interface FutureSelfModel {
  aspirationalTraits: string[];
  goalIdentities: string[]; // "the kind of person who..."
  fears: string[]; // What they don't want to become
  expectedChanges: string[];
}
```

## 4. Social Context System

Their social world and relationships:

```typescript
interface SocialWorld {
  // Important people
  significantOthers: Map<string, Person>;

  // Groups they belong to
  groups: Group[];

  // Social roles they play
  roles: SocialRole[];

  // Social support network
  supportNetwork: SupportNetwork;
}

interface Person {
  name: string;
  relationship: string;
  closeness: number;
  trust: number;
  frequency_of_contact: string;

  // Dynamics
  typical_interactions: string[];
  tensions: string[];
  shared_history: string[];

  // Claims about this person
  claimIds: string[];
}

interface Group {
  name: string;
  type: 'family' | 'friends' | 'work' | 'community' | 'interest';
  role_in_group: string;
  importance: number;
  dynamics: string;
}

interface SupportNetwork {
  emotional_support: string[]; // Who they turn to
  practical_support: string[];
  advice_giving: string[];
  perceived_adequacy: number;
}
```

## 5. Resource/Constraint Awareness

What resources and constraints shape their life?

```typescript
interface LifeContext {
  // Resources
  resources: {
    time: TimeResource;
    energy: EnergyResource;
    financial: FinancialResource;
    social: SocialResource;
    knowledge: KnowledgeResource;
  };

  // Constraints
  constraints: Constraint[];

  // Current life stage
  lifeStage: string;

  // Major responsibilities
  responsibilities: string[];
}

interface TimeResource {
  perceived_availability: 'abundant' | 'adequate' | 'scarce' | 'desperate';
  major_time_sinks: string[];
  protected_time: string[]; // What they prioritize
}

interface EnergyResource {
  typical_level: 'high' | 'moderate' | 'low' | 'variable';
  drains: string[];
  sources: string[];
}

interface Constraint {
  type: 'health' | 'financial' | 'geographic' | 'relational' | 'professional' | 'other';
  description: string;
  impact: 'minor' | 'significant' | 'major';
  changeable: boolean;
}
```

## 6. Decision Style System

How do they make decisions?

```typescript
interface DecisionStyle {
  // General tendencies
  tendencies: {
    speed: 'impulsive' | 'quick' | 'deliberate' | 'slow';
    information_seeking: 'minimal' | 'moderate' | 'extensive';
    risk_tolerance: 'risk_averse' | 'moderate' | 'risk_seeking';
    social_consultation: 'independent' | 'selective' | 'collaborative';
    reversibility_preference: 'prefers_reversible' | 'neutral' | 'commits_fully';
  };

  // Domain-specific approaches
  domainApproaches: Map<string, DecisionApproach>;

  // Known biases (from their own reflection)
  acknowledgedBiases: string[];

  // Decision regrets (informative of style)
  regretPatterns: string[];
}

interface DecisionApproach {
  domain: string;
  typical_process: string;
  decision_criteria: string[];
  who_they_consult: string[];
}
```

## 7. Coping & Response Patterns

How do they handle adversity?

```typescript
interface CopingPatterns {
  // Primary coping strategies
  primaryStrategies: CopingStrategy[];

  // Stress responses
  stressResponses: {
    behavioral: string[];
    emotional: string[];
    cognitive: string[];
    physical: string[];
  };

  // What they do when overwhelmed
  overloadResponse: string;

  // Recovery patterns
  recoveryStrategies: string[];

  // Support seeking patterns
  supportSeeking: {
    tendency: 'rarely' | 'sometimes' | 'often' | 'readily';
    preferred_sources: string[];
    barriers: string[];
  };
}

interface CopingStrategy {
  strategy: string;
  type: 'problem_focused' | 'emotion_focused' | 'avoidance' | 'social' | 'meaning_making';
  effectiveness: number; // Self-rated
  when_used: string;
}
```

## Mind Model Synthesis Observer

```typescript
const mindModelObserver: Observer = {
  id: 'observer_mind_model',
  type: 'narrative_observer',
  priority: 1,
  active: true,

  triggers: [
    { type: 'schedule', pattern: 'weekly' }
  ],

  async process(context: ObserverContext): Promise<ObserverOutput[]> {
    // Gather all relevant claims
    const selfClaims = await getClaimsByType('self_perception');
    const beliefClaims = await getClaimsByType('claim_belief');
    const causalClaims = await getClaimsByType('causal');
    const decisionClaims = await getClaimsByType('decision');
    const relationshipClaims = await getClaimsByType('relationship');
    const valueClaims = await getClaimsByType('value');
    const goalClaims = await getClaimsByType('goal');
    const emotionClaims = await getClaimsByType('emotion');
    const concernClaims = await getClaimsByType('concern');

    // Generate comprehensive mind model synthesis
    const mindModel = await synthesizeMindModel({
      selfClaims,
      beliefClaims,
      causalClaims,
      decisionClaims,
      relationshipClaims,
      valueClaims,
      goalClaims,
      emotionClaims,
      concernClaims
    });

    return [{
      type: 'mind_model_synthesis',
      model: mindModel
    }];
  }
};
```

---

## Navigation

- Previous: [08-observers.md](./08-observers.md)
- Next: [10-initialization.md](./10-initialization.md)
