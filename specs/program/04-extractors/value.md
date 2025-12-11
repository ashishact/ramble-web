# Value & Principle Extraction

## Overview

Extracts values and principles - core beliefs about what matters.

## Configuration

```typescript
const valueExtractor: ExtractionProgram = {
  id: 'core_value',
  name: 'Value & Principle Extraction',
  type: 'value',
  version: 1,
  priority: 10,

  patterns: [
    // Explicit values
    { type: 'keyword', values: ['I value', 'I believe in', 'important to me', 'matters to me'], weight: 0.95 },
    { type: 'keyword', values: ['I care about', 'I prioritize', 'I stand for'], weight: 0.9 },

    // Principles
    { type: 'keyword', values: ['my principle', 'I always', 'I never', 'rule is'], weight: 0.85 },
    { type: 'keyword', values: ['should', 'ought to', 'must', 'right thing'], weight: 0.5 },

    // Evaluative statements
    { type: 'keyword', values: ['wrong to', 'right to', 'fair', 'unfair', 'just', 'unjust'], weight: 0.7 },
    { type: 'keyword', values: ['ethical', 'moral', 'immoral', 'good', 'bad', 'evil'], weight: 0.7 },

    // Identity values
    { type: 'keyword', values: ['who I am', 'defines me', 'core to', 'fundamental'], weight: 0.8 },

    // Trade-off language
    { type: 'keyword', values: ['more important than', 'would rather', 'never sacrifice'], weight: 0.8 },

    // Disgust/approval
    { type: 'keyword', values: ['hate when', 'love when', "can't stand", 'admire when'], weight: 0.6 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract values and principles - core beliefs about what matters.
For each value:
- statement: What was said
- value_statement: The value/principle clearly stated
- domain: "ethics"|"relationships"|"work"|"lifestyle"|"society"|"self"|"other"
- importance: 0 (minor preference) to 1 (core value)
- is_principle: Is this a guiding rule vs a preference?
- source: Where does this value come from? "personal"|"family"|"culture"|"experience"|"reasoning"
- stability: How stable is this? "evolving"|"stable"|"core"
- trade_offs: What would they sacrifice for this?
- conflicts_with: Does this conflict with other mentioned values?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        value_statement: { type: 'string' },
        domain: { type: 'string' },
        importance: { type: 'number', minimum: 0, maximum: 1 },
        is_principle: { type: 'boolean' },
        source: { type: 'string', enum: ['personal', 'family', 'culture', 'experience', 'reasoning'] },
        stability: { type: 'string', enum: ['evolving', 'stable', 'core'] },
        trade_offs: { type: ['array', 'null'], items: { type: 'string' } },
        conflicts_with: { type: ['string', 'null'] }
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
    "statement": "Honesty is fundamental to who I am, I would never sacrifice it for convenience",
    "value_statement": "Honesty is a core value",
    "domain": "ethics",
    "importance": 0.95,
    "is_principle": true,
    "source": "family",
    "stability": "core",
    "trade_offs": ["would sacrifice convenience", "would sacrifice social comfort"],
    "conflicts_with": null
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Goal](./goal.md)
- Next: [Relationship](./relationship.md)
