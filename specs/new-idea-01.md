## The Complete System: First Principles

### Starting Point: What Is a Mind?

For your purposes, a mind is not a knowledge base. It's a **process** that:

1. **Maintains orientation** toward an uncertain future
2. **Holds things open** that aren't yet resolved
3. **Commits** to reduce future uncertainty through action
4. **Models** causal structure to predict and plan
5. **Allocates attention** based on estimated importance
6. **Operates under constraints** of time, energy, and obligation
7. **Exists in relationship** to other minds it must model

A "mental map" is a snapshot of this process at a moment in time. Your system must capture enough structure to reconstruct not just *what* someone knew, but *how their mind was organized around it.*

---

### The Ontology: What Exists

**Tier 0: The Substrate**

```
Stream
├── raw input (text/audio)
├── timestamp range
└── session metadata
```

Everything derives from streams. Streams are the ground truth. Everything else is interpretation.

**Tier 1: Discourse Structure**

```
Utterance
├── stream reference
├── boundaries (start, end)
├── speaker (if known)
└── discourse function (assert, question, command, express, commit)
```

Utterances are the atoms of meaning. Not sentences—discourse units. "I mean..." starts a new utterance. "So basically..." starts a new utterance. These are cognitive units, not grammatical ones.

**Tier 2: Propositional Content**

```
Proposition
├── id (stable, referenceable)
├── source utterance(s)
├── content (the claim, stripped of modality)
├── type:
│   ├── state ("X is Y")
│   ├── event ("X happened/will happen")
│   ├── process ("X is ongoing")
│   ├── hypothetical ("if X then Y")
│   └── generic ("Xs tend to Y")
└── entities involved (references to Entity objects)
```

Propositions are **what is being talked about**, not whether it's true or wanted or necessary. This separation is critical.

**Tier 3: Stance (The Modalities)**

Every proposition is held with a stance. Stance is multidimensional:

```
Stance
├── proposition reference
├── holder (who holds this stance—usually speaker, but could be attributed)
├── dimensions:
│   ├── epistemic: {certainty: 0-1, evidence_type: [direct, inferred, hearsay, assumption]}
│   ├── volitional: {valence: -1 to 1, strength: 0-1, type: [want, intend, hope, fear, prefer]}
│   ├── deontic: {strength: 0-1, source: [self, other, circumstance], type: [must, should, may, must_not]}
│   └── affective: {valence: -1 to 1, arousal: 0-1, specific_emotions: [...]}
├── temporal: when this stance was expressed
└── supersedes: previous stance on same proposition (if any)
```

**Why four dimensions?**

Because these are the irreducible axes of how a mind relates to a proposition:
- Epistemic: *Do I believe it?*
- Volitional: *Do I want it?*
- Deontic: *Must I (or must I not)?*
- Affective: *How does it feel?*

Any other stance decomposes into these. "I'm worried about X" = epistemic uncertainty + negative volitional + negative affect. "I have to do X" = high deontic + (volitional varies).

**Tier 4: Relations**

Propositions don't exist in isolation. They connect:

```
Relation
├── id
├── type:
│   ├── causal: (X because Y), (X causes Y), (X enables Y), (X prevents Y)
│   ├── temporal: (X before Y), (X after Y), (X during Y), (X until Y)
│   ├── logical: (X entails Y), (X contradicts Y), (X is evidence for Y)
│   ├── teleological: (X in order to Y), (X serves Y), (X is a step toward Y)
│   ├── compositional: (X is part of Y), (X contains Y), (X is type of Y)
│   ├── contrastive: (X instead of Y), (X rather than Y), (X versus Y)
│   └── conditional: (if X then Y), (X depends on Y), (X requires Y)
├── source: proposition id
├── target: proposition id
├── strength: 0-1 (how explicitly stated vs inferred)
└── evidence: utterance(s) supporting this relation
```

**This is where your gap analysis lives.** Missing relations are gaps. A decision (proposition) without causal relations to justifications is a gap. A goal without teleological relations to subgoals is incomplete.

**Tier 5: Entities**

Things that persist across propositions:

```
Entity
├── id
├── type:
│   ├── person
│   ├── organization
│   ├── project
│   ├── artifact (document, product, deliverable)
│   ├── event (meeting, deadline, milestone)
│   ├── concept (abstract idea, domain)
│   └── self (the speaker)
├── names/aliases: [...]
├── attributes: {...} (accumulated across mentions)
├── first_mention: utterance reference
└── mention_history: [...]
```

Entities are what let you query "everything about Sarah" or "everything about the product launch."

**Tier 6: Open Loops**

This is the core construct for modeling active mental state:

```
OpenLoop
├── id
├── type:
│   ├── commitment (promised to do X)
│   ├── question (need to find out X)
│   ├── decision (need to choose between X, Y, Z)
│   ├── concern (worried about X)
│   ├── dependency (waiting for X)
│   ├── goal (trying to achieve X)
│   └── tension (X and Y are in conflict)
├── core_proposition: proposition id
├── opening_utterance: when it was opened
├── closure_conditions: proposition(s) that would close it
├── current_status: {open, closed, stale, superseded}
├── closing_utterance: (if closed)
├── related_loops: [...] (dependencies, conflicts)
├── salience: 0-1 (how much attention it commands)
└── staleness: time since last referenced
```

**Open loops are the fundamental unit of mental load.** High performers are people with many open loops, trying to manage them without dropping any. Your app is an external loop-tracking system.

**Tier 7: Goal Structure**

Goals are a special case, worth modeling explicitly:

```
Goal
├── id
├── proposition: what achieving this goal looks like
├── type:
│   ├── terminal (wanted for its own sake)
│   ├── instrumental (wanted because it enables something else)
│   └── maintenance (ongoing state to preserve)
├── parent_goals: [...] (what this serves)
├── child_goals: [...] (what serves this)
├── enabling_conditions: propositions that must be true
├── blocking_conditions: propositions that would prevent
├── progress_indicators: how to measure progress
├── status: {active, dormant, achieved, abandoned}
├── priority: relative importance
└── time_horizon: when relevant
```

The goal tree isn't extracted directly—it's constructed from teleological relations between goals.

**Tier 8: Mental State Snapshot**

At any point in time, the user's mind can be characterized by:

```
MentalState
├── timestamp
├── active_loops: [...] (open loops currently salient)
├── goal_stack: [...] (goals currently being pursued, ordered by activation)
├── beliefs: [...] (propositions held with high epistemic certainty)
├── uncertainties: [...] (propositions with low epistemic certainty but high salience)
├── commitments: [...] (propositions with high deontic weight)
├── concerns: [...] (propositions with negative affect)
├── anticipations: [...] (future propositions with high salience)
├── attention_focus: what's at the center
└── emotional_tone: aggregate affective state
```

This is what you reconstruct when someone asks "what was I thinking on October 15th?"

---

### The Operations: What You Can Do

**Extraction Operations** (Stream → Structure)

```
parse_utterances(stream) → [Utterance]
extract_propositions(utterance) → [Proposition]
extract_stance(utterance, proposition) → Stance
extract_relations(utterances) → [Relation]
extract_entities(propositions) → [Entity]
detect_loops(propositions, relations) → [OpenLoop]
infer_goals(loops, relations) → [Goal]
snapshot_mental_state(time) → MentalState
```

**Analysis Operations** (Structure → Insight)

```
find_gaps(mental_state) → [Gap]
  ├── incomplete_decisions: decisions without justifications
  ├── orphan_commitments: commitments without plans
  ├── unclosed_loops: old loops never resolved
  ├── contradictions: conflicting beliefs
  ├── unsupported_goals: goals without subgoals
  └── unacknowledged_dependencies: implicit blockers

find_patterns(mental_states[]) → [Pattern]
  ├── recurring_concerns: what keeps coming up
  ├── shifting_priorities: what's moving up or down
  ├── belief_evolution: how understanding changed
  └── commitment_patterns: what they commit to vs complete

compare_states(state1, state2) → Diff
  ├── new_loops
  ├── closed_loops
  ├── changed_beliefs
  ├── shifted_priorities
  └── resolved_tensions
```

**Synthesis Operations** (Structure → Output)

```
generate_questions(gaps) → [Question]  # for gap-filling
construct_goal_tree(goals) → Tree
construct_timeline(mental_states) → Timeline
generate_summary(mental_state, focus) → Summary
predict_concerns(patterns) → [Proposition]  # what will matter next
```

---

### The Composability: How Plugins Work

Your plugin system needs clean interfaces:

**Extractor Plugin Interface**

```
interface Extractor {
  input_type: "stream" | "utterance" | "proposition" | ...
  output_type: "proposition" | "relation" | "entity" | ...
  
  extract(input) → output[]
  confidence(input) → float  # should this extractor run?
}
```

**Analyzer Plugin Interface**

```
interface Analyzer {
  required_data: ["propositions", "relations", ...]
  output_type: "gap" | "pattern" | "insight" | ...
  
  analyze(data) → output[]
}
```

**View Plugin Interface**

```
interface View {
  required_data: ["goals", "mental_state", ...]
  query_params: {...}  # time range, entity filter, etc.
  
  render(data, params) → UIComponent
  interactions: [...] # what user can do in this view
  emits_events: [...] # what it sends to other views
  receives_events: [...] # what it listens for
}
```

**Cross-View Communication**

```
Event {
  type: "selection" | "filter" | "highlight" | "navigate" | ...
  source_view: view_id
  payload: {...}
}
```

When user clicks a goal in the goal tree view, it emits a selection event. The timeline view receives it and scrolls to when that goal was articulated. The loop view receives it and highlights loops related to that goal.

---

### The Gap Analysis System: Detailed

Since you specifically want this, here's the full model:

**Gap Types (The Complete Taxonomy)**

```
GapType {
  structural_gaps: {
    missing_justification: "Decision or commitment without stated reasons"
    missing_plan: "Goal or commitment without steps toward it"
    missing_timeline: "Action without temporal anchoring"
    missing_owner: "Task without responsible party"
    missing_dependency: "Plan that ignores prerequisites"
    missing_alternative: "Decision without considered options"
    missing_criteria: "Choice without basis for selection"
  }
  
  coherence_gaps: {
    contradiction: "Beliefs that can't both be true"
    priority_conflict: "Goals that compete for same resources"
    means_end_mismatch: "Actions that don't serve stated goals"
    temporal_impossibility: "Commitments that can't all be met"
    belief_action_gap: "Stated belief not reflected in plans"
  }
  
  completeness_gaps: {
    stakeholder_blindspot: "Affected parties not considered"
    risk_blindspot: "Obvious risks not acknowledged"
    constraint_blindspot: "Real limitations not factored in"
    knowledge_gap: "Decisions made with known unknowns"
  }
  
  resolution_gaps: {
    stale_loop: "Open question never answered"
    abandoned_commitment: "Promise made, never fulfilled or explicitly dropped"
    unresolved_tension: "Conflict acknowledged but not addressed"
    deferred_decision: "Choice postponed without clear trigger"
  }
}
```

**Gap Detection Rules**

Each gap type has detection logic:

```
detect_missing_justification(decision):
  # A decision proposition exists
  # No causal relation points TO it
  # Or causal relations exist but have low strength
  
  related = relations.where(target=decision, type="causal")
  if related.empty():
    return Gap(type="missing_justification", subject=decision, 
               prompt="What led you to this decision?")
  if all(r.strength < 0.5 for r in related):
    return Gap(type="weak_justification", subject=decision,
               prompt="You mentioned some reasons, but what's the core driver?")

detect_contradiction(beliefs):
  # Two propositions held with high certainty
  # That have a logical contradiction relation
  
  for b1, b2 in pairs(beliefs):
    if has_relation(b1, b2, type="contradicts"):
      if b1.stance.epistemic.certainty > 0.7 and b2.stance.epistemic.certainty > 0.7:
        return Gap(type="contradiction", subjects=[b1, b2],
                   prompt="You seem confident about both X and Y, but they're in tension. How do you reconcile them?")
```

**Gap Priority Scoring**

Not all gaps are worth surfacing. Score them:

```
gap_priority(gap) = 
  salience(gap.subject) *           # is this about something they care about?
  recency(gap.subject) *            # is this current?
  actionability(gap.type) *         # can they actually do something about it?
  (1 - user_annoyance_model(gap))   # have we asked about this before?
```

**Gap Surfacing Strategy**

```
when_to_surface_gaps:
  during_input: never interrupt, but queue
  at_natural_pause: surface top 1-2 gaps as questions
  at_session_end: surface structural gaps as summary
  on_demand: user explicitly asks "what am I missing?"
  
how_to_surface:
  not: "You have a gap in your reasoning"
  but: "I noticed you decided X—what made you rule out Y?"
  or: "You mentioned needing to do X by Friday. What's the first step?"
```

---

### The Goal Tree System: Detailed

**Goal Extraction**

Goals come from multiple sources:

```
goal_indicators:
  explicit: "My goal is...", "I want to...", "I'm trying to..."
  implicit_from_commitment: "I need to..." → goal is state where need is met
  implicit_from_frustration: "The problem is..." → goal is problem resolved
  implicit_from_evaluation: "It would be good if..." → goal is that state
  implicit_from_effort: extensive discussion of X → X is probably a goal
```

**Goal Relationship Inference**

```
infer_goal_hierarchy:
  # Explicit subordination
  "X so that Y" → X is child of Y
  "X is part of Y" → X is child of Y
  "to do Y, first X" → X is child of Y
  
  # Implicit subordination
  X is about tactics, Y is about strategy → X probably serves Y
  X is short-term, Y is long-term → X probably serves Y
  X is specific, Y is abstract → X probably serves Y
  
  # Conflict detection
  X and Y compete for same resources → mark as conflicting
  X and Y have contradictory success conditions → mark as conflicting
```

**Goal Tree Operations**

```
GoalTree {
  roots: [Goal]  # terminal goals, wanted for own sake
  
  operations:
    get_path_to_root(goal) → [Goal]  # why does this matter?
    get_subtree(goal) → Tree  # what serves this?
    get_blocking_goals(goal) → [Goal]  # what's in the way?
    get_orphans() → [Goal]  # goals that don't connect to anything
    get_coverage(goal) → float  # how much of this goal has subgoals?
    suggest_subgoals(goal) → [GoalSuggestion]  # what's missing?
}
```

---

### Simplification: The Minimal Kernel

Per Alan Kay—complex things possible, simple things simple. What's the minimal kernel?

**The irreducible core:**

1. **Stream** (raw input)
2. **Proposition** (what is said)
3. **Stance** (how it's held)
4. **Relation** (how things connect)
5. **OpenLoop** (what's unresolved)

Everything else—goals, entities, mental states, gaps—derives from these five primitives.

**The minimal extraction:**

1. Segment stream into utterances
2. Extract propositions from utterances
3. Tag propositions with stance
4. Detect relations between propositions
5. Identify open loops

**The minimal views:**

1. **Timeline**: Mental states over time
2. **Loops**: What's open, what's closed
3. **Graph**: Propositions and relations

From this kernel, everything else is derivable. Goal trees are subgraphs of the relation graph filtered by teleological relations. Gaps are patterns in the relation graph. Entities are clusters of propositions. Mental state snapshots are time-filtered views of everything.

---

### Your Next Steps (Not "What to Ship" but "How to Validate the Theory")

1. **Formalize the ontology** in code. Define the data structures exactly.

2. **Build one end-to-end pipeline**: Stream → Propositions → Stances → Relations → One Gap Type. Make sure the abstractions actually work.

3. **Test composability**: Can you build a second gap type using the same primitives? If you need new primitives, your kernel is incomplete.

4. **Test reconstruction**: Given a past stream, can you reconstruct a mental state that *feels right* to the user? This is the real test.

5. **Build the simplest view layer**: Not Blender-style yet. Just prove that the primitives support multiple views.

What's your current data structure look like? Are you already storing things this way, or is your extraction outputting flat lists of typed objects?