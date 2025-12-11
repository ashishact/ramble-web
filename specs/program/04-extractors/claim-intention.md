# Intention Extraction

## Overview

Extracts intentions and plans - what the person intends to do.

## Configuration

```typescript
const intentionExtractor: ExtractionProgram = {
  id: 'core_claim_intention',
  name: 'Intention Extraction',
  type: 'claim_intention',
  version: 1,
  priority: 4,

  patterns: [
    // Direct intentions
    { type: 'keyword', values: ['I will', "I'll", 'I am going to', 'I plan to', 'I intend to'], weight: 0.9 },
    { type: 'keyword', values: ['going to', 'gonna', 'about to', 'planning to'], weight: 0.8 },

    // Wants and desires
    { type: 'keyword', values: ['I want', 'I wish', 'I hope', "I'd like", 'I need to'], weight: 0.7 },

    // Commitments
    { type: 'keyword', values: ['I promise', 'I commit', 'I swear', "I'm committed"], weight: 0.9 },
    { type: 'keyword', values: ['have to', 'must', 'need to', 'got to'], weight: 0.6 },

    // Future orientation
    { type: 'keyword', values: ['tomorrow', 'next week', 'next month', 'soon', 'eventually'], weight: 0.5 },
    { type: 'keyword', values: ['by the end of', 'within', 'before'], weight: 0.5 },

    // Negated intentions
    { type: 'keyword', values: ["won't", "I'm not going to", 'refuse to', "don't want to"], weight: 0.7 },

    // Conditional intentions
    { type: 'sequence', value: ['if', 'then I will'], weight: 0.6 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract intentions and plans - what the person intends to do.
For each intention:
- statement: The intention clearly stated
- action: What action will be taken
- claim_type: "intention"
- commitment_level: How committed? "considering"|"intending"|"committed"|"promised"
- timeframe: When? "immediate"|"soon"|"near_future"|"far_future"|"unspecified"
- contingency: Is this conditional on something? null or the condition
- motivation: Why do they want this? (if mentioned)
- obstacles_mentioned: Any obstacles mentioned?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        action: { type: 'string' },
        claim_type: { type: 'string', const: 'intention' },
        commitment_level: { type: 'string', enum: ['considering', 'intending', 'committed', 'promised'] },
        timeframe: { type: 'string', enum: ['immediate', 'soon', 'near_future', 'far_future', 'unspecified'] },
        contingency: { type: ['string', 'null'] },
        motivation: { type: ['string', 'null'] },
        obstacles_mentioned: { type: ['array', 'null'], items: { type: 'string' } }
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
    "statement": "I'm going to start exercising every morning next week",
    "action": "start exercising every morning",
    "claim_type": "intention",
    "commitment_level": "intending",
    "timeframe": "soon",
    "contingency": null,
    "motivation": "health improvement",
    "obstacles_mentioned": null
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Belief](./claim-belief.md)
- Next: [Causal](./causal.md)
