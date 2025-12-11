# Decision Extraction

## Overview

Extracts decisions - choices that have been made or are being made.

## Configuration

```typescript
const decisionExtractor: ExtractionProgram = {
  id: 'core_decision',
  name: 'Decision Extraction',
  type: 'decision',
  version: 1,
  priority: 7,

  patterns: [
    // Made decisions
    { type: 'keyword', values: ['I decided', "I've decided", 'decision is', 'my decision'], weight: 0.95 },
    { type: 'keyword', values: ['chose', 'picked', 'selected', 'went with', 'opted for'], weight: 0.85 },

    // Final language
    { type: 'keyword', values: ["that's final", 'made up my mind', 'settled on', 'going with'], weight: 0.9 },

    // Comparative choices
    { type: 'keyword', values: ['instead of', 'rather than', 'over', 'versus'], weight: 0.7 },
    { type: 'keyword', values: ['better than', 'prefer', 'best option'], weight: 0.6 },

    // Resolution language
    { type: 'keyword', values: ['figured out', 'resolved', 'concluded', 'determined'], weight: 0.7 },

    // Rejection
    { type: 'keyword', values: ['not going to', "won't", 'rejected', 'ruled out', 'dismissed'], weight: 0.7 },

    // Commitment indicators
    { type: 'keyword', values: ['going forward', 'from now on', "that's the plan"], weight: 0.6 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract decisions - choices that have been made or are being made.
For each decision:
- statement: The decision stated
- decision: What was decided
- alternatives_rejected: What alternatives were not chosen
- reasoning: Why was this chosen? (if mentioned)
- confidence_level: How confident in the decision? "tentative"|"moderate"|"confident"|"certain"
- reversibility: "easily_reversible"|"reversible_with_cost"|"hard_to_reverse"|"irreversible"
- domain: What area of life?
- stakes: "low"|"medium"|"high"|"critical"
- timeline: When was/will this be enacted?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        decision: { type: 'string' },
        alternatives_rejected: { type: ['array', 'null'], items: { type: 'string' } },
        reasoning: { type: ['string', 'null'] },
        confidence_level: { type: 'string', enum: ['tentative', 'moderate', 'confident', 'certain'] },
        reversibility: { type: 'string', enum: ['easily_reversible', 'reversible_with_cost', 'hard_to_reverse', 'irreversible'] },
        domain: { type: 'string' },
        stakes: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        timeline: { type: ['string', 'null'] }
      }
    }
  },

  tokenBudget: 1500,
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
    "statement": "I've decided to move to Seattle instead of staying in Portland",
    "decision": "move to Seattle",
    "alternatives_rejected": ["stay in Portland"],
    "reasoning": "better job opportunities",
    "confidence_level": "confident",
    "reversibility": "reversible_with_cost",
    "domain": "life",
    "stakes": "high",
    "timeline": "next month"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Question/Uncertainty](./question-uncertainty.md)
- Next: [Emotion](./emotion.md)
