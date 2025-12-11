# Concern & Worry Extraction

## Overview

Extracts concerns and worries from conversational text.

## Configuration

```typescript
const concernExtractor: ExtractionProgram = {
  id: 'core_concern',
  name: 'Concern & Worry Extraction',
  type: 'concern',
  version: 1,
  priority: 16,

  patterns: [
    // Explicit worry
    { type: 'keyword', values: ['I worry', "I'm worried", 'concerned about', 'I fear'], weight: 0.95 },
    { type: 'keyword', values: ['anxious about', 'nervous about', 'stressed about'], weight: 0.9 },

    // What-if thinking
    { type: 'keyword', values: ['what if', 'what happens if', 'imagine if'], weight: 0.8 },
    { type: 'keyword', values: ["I hope it doesn't", 'afraid that', 'scared that'], weight: 0.85 },

    // Risk awareness
    { type: 'keyword', values: ['risk', 'danger', 'threat', 'problem could be'], weight: 0.7 },

    // Rumination
    { type: 'keyword', values: ["can't stop thinking about", 'keeps me up', 'on my mind'], weight: 0.85 },

    // Anticipated regret
    { type: 'keyword', values: ['might regret', 'might be a mistake', "shouldn't have"], weight: 0.7 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract concerns and worries.
For each concern:
- statement: What was said
- concern: The worry clearly stated
- domain: What area? "health"|"financial"|"relationship"|"career"|"world"|"self"|"other"
- severity: "minor"|"moderate"|"significant"|"severe"
- likelihood_perceived: How likely do they think it is? 0-1
- controllability: Can they do something? "controllable"|"partially"|"uncontrollable"
- time_orientation: "past"|"present"|"future"
- coping_response: Any coping mentioned?
- recurring: Is this an ongoing worry?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        concern: { type: 'string' },
        domain: { type: 'string' },
        severity: { type: 'string', enum: ['minor', 'moderate', 'significant', 'severe'] },
        likelihood_perceived: { type: 'number', minimum: 0, maximum: 1 },
        controllability: { type: 'string', enum: ['controllable', 'partially', 'uncontrollable'] },
        time_orientation: { type: 'string', enum: ['past', 'present', 'future'] },
        coping_response: { type: ['string', 'null'] },
        recurring: { type: 'boolean' }
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
    "statement": "I'm worried about the company layoffs that might happen next quarter",
    "concern": "potential job loss from company layoffs",
    "domain": "career",
    "severity": "significant",
    "likelihood_perceived": 0.6,
    "controllability": "partially",
    "time_orientation": "future",
    "coping_response": "updating resume",
    "recurring": true
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Memory Reference](./memory-reference.md)
- Next: [Learning](./learning.md)
