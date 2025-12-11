# Learning & Insight Extraction

## Overview

Extracts learnings and insights - moments of understanding or change.

## Configuration

```typescript
const learningExtractor: ExtractionProgram = {
  id: 'core_learning',
  name: 'Learning & Insight Extraction',
  type: 'learning',
  version: 1,
  priority: 17,

  patterns: [
    // Realizations
    { type: 'keyword', values: ['I realized', 'I learned', "I've come to understand", 'it dawned on me'], weight: 0.95 },
    { type: 'keyword', values: ['now I see', 'now I understand', 'finally get'], weight: 0.9 },

    // Insight language
    { type: 'keyword', values: ['insight', 'epiphany', 'breakthrough', 'aha moment'], weight: 0.95 },
    { type: 'keyword', values: ['clicked', 'makes sense now', 'connected the dots'], weight: 0.85 },

    // Change in understanding
    { type: 'keyword', values: ['I used to think', 'I now think', 'changed my mind', 'perspective changed'], weight: 0.9 },
    { type: 'keyword', values: ['was wrong about', 'misconception', 'turns out'], weight: 0.85 },

    // Lessons
    { type: 'keyword', values: ['lesson learned', 'taught me', 'takeaway is', 'moral of'], weight: 0.9 },

    // Growth
    { type: 'keyword', values: ['grown to', 'evolved', "I've changed", "I've developed"], weight: 0.7 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract learnings and insights - moments of understanding or change.
For each learning:
- statement: What was said
- insight: The learning or realization
- type: "realization"|"lesson_learned"|"perspective_shift"|"skill_acquired"|"self_discovery"
- domain: What area?
- source: Where did this learning come from? "experience"|"reflection"|"feedback"|"observation"|"reading"
- impact: How significant? "minor"|"moderate"|"significant"|"transformative"
- previous_belief: What did they think before? (if mentioned)
- application: How will they apply this?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        insight: { type: 'string' },
        type: { type: 'string', enum: ['realization', 'lesson_learned', 'perspective_shift', 'skill_acquired', 'self_discovery'] },
        domain: { type: 'string' },
        source: { type: 'string', enum: ['experience', 'reflection', 'feedback', 'observation', 'reading'] },
        impact: { type: 'string', enum: ['minor', 'moderate', 'significant', 'transformative'] },
        previous_belief: { type: ['string', 'null'] },
        application: { type: ['string', 'null'] }
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
    "statement": "I realized that I was taking on too much because I was afraid to say no",
    "insight": "over-commitment stems from fear of saying no",
    "type": "self_discovery",
    "domain": "self",
    "source": "reflection",
    "impact": "significant",
    "previous_belief": "thought I was just being helpful",
    "application": "practice setting boundaries"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Concern](./concern.md)
- Next: [Change Marker](./change-marker.md)
