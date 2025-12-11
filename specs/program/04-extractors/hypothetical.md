# Hypothetical & Counterfactual Extraction

## Overview

Extracts hypothetical and counterfactual thinking - imagined scenarios and what-ifs.

## Configuration

```typescript
const hypotheticalExtractor: ExtractionProgram = {
  id: 'core_hypothetical',
  name: 'Hypothetical & Counterfactual Extraction',
  type: 'hypothetical',
  version: 1,
  priority: 19,

  patterns: [
    // Conditionals
    { type: 'keyword', values: ['if I', 'if only', 'what if', 'suppose'], weight: 0.9 },
    { type: 'keyword', values: ['would have', 'could have', 'should have', 'might have'], weight: 0.9 },

    // Counterfactuals
    { type: 'keyword', values: ['wish I had', 'wish I could', "if I hadn't", "if I'd"], weight: 0.9 },
    { type: 'keyword', values: ['different if', 'otherwise', 'instead'], weight: 0.7 },

    // Imagination
    { type: 'keyword', values: ['imagine', 'picture', 'envision', 'dream about'], weight: 0.7 },

    // Alternate scenarios
    { type: 'keyword', values: ['in another life', 'alternate universe', 'parallel'], weight: 0.8 },

    // Speculation
    { type: 'keyword', values: ['probably would', 'likely would', 'might be'], weight: 0.5 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract hypothetical and counterfactual thinking.
For each hypothetical:
- statement: What was said
- hypothetical_scenario: The imagined scenario
- type: "counterfactual_past"|"future_conditional"|"imagination"|"speculation"
- condition: What is the "if" part?
- consequence: What is the "then" part?
- emotional_charge: What emotion accompanies this?
- regret_level: If counterfactual, how much regret? 0-1
- probability_assessed: How likely do they think this is?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        hypothetical_scenario: { type: 'string' },
        type: { type: 'string', enum: ['counterfactual_past', 'future_conditional', 'imagination', 'speculation'] },
        condition: { type: ['string', 'null'] },
        consequence: { type: ['string', 'null'] },
        emotional_charge: { type: ['string', 'null'] },
        regret_level: { type: ['number', 'null'], minimum: 0, maximum: 1 },
        probability_assessed: { type: ['number', 'null'], minimum: 0, maximum: 1 }
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
    "statement": "If I had taken that job offer five years ago, my life would be completely different",
    "hypothetical_scenario": "alternate life path from accepting past job offer",
    "type": "counterfactual_past",
    "condition": "had taken the job offer five years ago",
    "consequence": "life would be completely different",
    "emotional_charge": "regret mixed with curiosity",
    "regret_level": 0.6,
    "probability_assessed": null
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Change Marker](./change-marker.md)
- Next: [Commitment](./commitment.md)
