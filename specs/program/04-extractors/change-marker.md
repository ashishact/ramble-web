# Change Marker Extraction

## Overview

Extracts markers of change - indications something has or is changing.

## Configuration

```typescript
const changeMarkerExtractor: ExtractionProgram = {
  id: 'core_change_marker',
  name: 'Change Marker Extraction',
  type: 'change_marker',
  version: 1,
  priority: 18,

  patterns: [
    // Contrast with past
    { type: 'keyword', values: ['used to', 'no longer', 'not anymore', "don't anymore"], weight: 0.9 },
    { type: 'keyword', values: ['before I', 'now I', 'these days', 'lately'], weight: 0.7 },

    // Transition language
    { type: 'keyword', values: ['becoming', 'turning into', 'transitioning', 'shifting'], weight: 0.8 },
    { type: 'keyword', values: ['started to', 'began to', 'stopped'], weight: 0.8 },

    // Explicit change
    { type: 'keyword', values: ['things changed', 'everything changed', "I've changed", 'different now'], weight: 0.9 },
    { type: 'keyword', values: ['new', 'fresh start', 'turning point', 'chapter'], weight: 0.7 },

    // Growth/decline
    { type: 'keyword', values: ['getting better', 'getting worse', 'improving', 'declining'], weight: 0.7 },

    // Life events
    { type: 'keyword', values: ['moved', 'married', 'divorced', 'graduated', 'retired', 'hired', 'fired'], weight: 0.8 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract markers of change - indications something has or is changing.
For each change:
- statement: What was said
- change_description: What changed
- change_type: "behavior"|"belief"|"circumstance"|"relationship"|"identity"|"status"
- before_state: What was it before?
- after_state: What is it now?
- timing: When did this happen?
- cause: What caused the change? (if mentioned)
- valence: Is this change positive, negative, or neutral?
- completeness: "complete"|"in_progress"|"beginning"`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        change_description: { type: 'string' },
        change_type: { type: 'string', enum: ['behavior', 'belief', 'circumstance', 'relationship', 'identity', 'status'] },
        before_state: { type: ['string', 'null'] },
        after_state: { type: ['string', 'null'] },
        timing: { type: ['string', 'null'] },
        cause: { type: ['string', 'null'] },
        valence: { type: 'string', enum: ['positive', 'negative', 'neutral', 'mixed'] },
        completeness: { type: 'string', enum: ['complete', 'in_progress', 'beginning'] }
      }
    }
  },

  tokenBudget: 1000,
  active: true,
  isCore: true,
  successRate: 0,
  runCount: 0
};
```

## Output Example

```json
[
  {
    "statement": "I used to be a night owl but now I'm much more of a morning person",
    "change_description": "sleep schedule shifted from night owl to morning person",
    "change_type": "behavior",
    "before_state": "night owl",
    "after_state": "morning person",
    "timing": "gradual",
    "cause": "new job with early start time",
    "valence": "positive",
    "completeness": "complete"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Learning](./learning.md)
- Next: [Hypothetical](./hypothetical.md)
