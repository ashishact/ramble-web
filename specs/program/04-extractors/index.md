# Layer 4: Core Extraction Programs

## Overview

The system includes 20 core extraction programs that run on every conversation unit. Each extractor:

1. Has **pattern matchers** that identify relevant text segments
2. Uses a **relevance scorer** to prioritize matches
3. Sends matched context to **LLM for structured extraction**
4. Outputs **typed JSON** conforming to a schema

## Extractor List

| Priority | Extractor | Type | Description |
|----------|-----------|------|-------------|
| 1 | [Entity](./entity.md) | `entity` | Named entities (people, places, orgs) |
| 2 | [Factual Claim](./claim-factual.md) | `claim_factual` | Statements about facts |
| 3 | [Belief](./claim-belief.md) | `claim_belief` | Subjective beliefs and opinions |
| 4 | [Intention](./claim-intention.md) | `claim_intention` | Plans and intentions |
| 5 | [Causal](./causal.md) | `causal` | Causal relationships |
| 6 | [Question/Uncertainty](./question-uncertainty.md) | `question` | Questions and knowledge gaps |
| 7 | [Decision](./decision.md) | `decision` | Decisions made or being made |
| 8 | [Emotion](./emotion.md) | `emotion` | Emotional states |
| 9 | [Goal](./goal.md) | `goal` | Goals and aspirations |
| 10 | [Value](./value.md) | `value` | Values and principles |
| 11 | [Relationship](./relationship.md) | `relationship` | Interpersonal relationships |
| 12 | [Self-Perception](./self-perception.md) | `self_perception` | Self-concept and identity |
| 13 | [Preference](./preference.md) | `preference` | Likes, dislikes, preferences |
| 14 | [Habit](./habit.md) | `habit` | Habits and routines |
| 15 | [Memory Reference](./memory-reference.md) | `memory_reference` | References to past memories |
| 16 | [Concern](./concern.md) | `concern` | Worries and concerns |
| 17 | [Learning](./learning.md) | `learning` | Insights and realizations |
| 18 | [Change Marker](./change-marker.md) | `change_marker` | Markers of change |
| 19 | [Hypothetical](./hypothetical.md) | `hypothetical` | Hypothetical scenarios |
| 20 | [Commitment](./commitment.md) | `commitment` | Promises and obligations |

## Common Structure

Each extractor follows this structure:

```typescript
interface ExtractionProgram {
  id: string;
  name: string;
  type: ProgramType;
  version: number;
  priority: number;

  patterns: Pattern[];
  relevanceScorer: RelevanceScorer;
  extractionPrompt: string;
  outputSchema: JSONSchema;

  tokenBudget: number;
  active: boolean;
  isCore: boolean;
  successRate: number;
  runCount: number;
}
```

## Pattern Types

- **regex** - Regular expression matching
- **keyword** - Simple keyword/phrase matching
- **fuzzy** - Fuzzy string matching
- **structural** - Structural patterns (subject-verb-object)
- **negation** - Negation patterns
- **sequence** - Sequential word patterns

## Token Budgets

Each extractor has a token budget that limits how much context it can send to the LLM. Typical budgets:

- Entity extraction: 1500 tokens
- Claim extraction: 2000 tokens
- Emotion/Goal: 1500 tokens
- Preference/Habit: 1000 tokens

---

## Navigation

- Previous: [03-extraction-pipeline.md](../03-extraction-pipeline.md)
- Next: [05-thought-chains.md](../05-thought-chains.md)
