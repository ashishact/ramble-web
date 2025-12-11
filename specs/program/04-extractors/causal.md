# Causal Belief Extraction

## Overview

Extracts causal beliefs - beliefs about what causes what.

## Configuration

```typescript
const causalExtractor: ExtractionProgram = {
  id: 'core_causal',
  name: 'Causal Belief Extraction',
  type: 'causal',
  version: 1,
  priority: 5,

  patterns: [
    // Explicit causation
    { type: 'keyword', values: ['because', 'since', 'as a result', 'therefore', 'thus', 'hence'], weight: 0.9 },
    { type: 'keyword', values: ['caused', 'causes', 'led to', 'leads to', 'resulted in', 'results in'], weight: 0.9 },
    { type: 'keyword', values: ['due to', 'owing to', 'thanks to', 'on account of'], weight: 0.8 },

    // Conditional causation
    { type: 'sequence', value: ['if', 'then'], weight: 0.8 },
    { type: 'sequence', value: ['when', 'then'], weight: 0.7 },
    { type: 'keyword', values: ['whenever', 'every time'], weight: 0.7 },

    // Mechanisms
    { type: 'keyword', values: ['by', 'through', 'via', 'using'], weight: 0.4 },
    { type: 'keyword', values: ['in order to', 'so that', 'to achieve'], weight: 0.6 },

    // Preventive
    { type: 'keyword', values: ['prevents', 'stops', 'blocks', 'avoids', 'protects'], weight: 0.7 },

    // Enabling
    { type: 'keyword', values: ['enables', 'allows', 'makes possible', 'helps'], weight: 0.6 },

    // Why questions (implicit causal model)
    { type: 'regex', value: '\\bwhy\\b.*\\?', weight: 0.5 },

    // Reason-giving
    { type: 'keyword', values: ['the reason', 'the cause', 'what makes', 'what causes'], weight: 0.8 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract causal beliefs - beliefs about what causes what.
For each causal relationship:
- statement: The causal belief stated
- cause: What is the cause
- effect: What is the effect
- relationship_type: "causes"|"prevents"|"enables"|"correlates"|"contributes_to"
- confidence: How certain is the speaker about this causation? 0-1
- directionality: "unidirectional"|"bidirectional"
- mechanism: How does the cause create the effect? (if mentioned)
- domain: What domain is this about?
- is_personal: Is this about their personal experience or general world?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        cause: { type: 'string' },
        effect: { type: 'string' },
        relationship_type: { type: 'string', enum: ['causes', 'prevents', 'enables', 'correlates', 'contributes_to'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        directionality: { type: 'string', enum: ['unidirectional', 'bidirectional'] },
        mechanism: { type: ['string', 'null'] },
        domain: { type: 'string' },
        is_personal: { type: 'boolean' }
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
    "statement": "Stress causes me to overeat",
    "cause": "stress",
    "effect": "overeating",
    "relationship_type": "causes",
    "confidence": 0.9,
    "directionality": "unidirectional",
    "mechanism": "emotional response",
    "domain": "health",
    "is_personal": true
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Intention](./claim-intention.md)
- Next: [Question/Uncertainty](./question-uncertainty.md)
