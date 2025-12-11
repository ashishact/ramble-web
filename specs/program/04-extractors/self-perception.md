# Self-Perception Extraction

## Overview

Extracts self-perceptions - how the person sees themselves.

## Configuration

```typescript
const selfPerceptionExtractor: ExtractionProgram = {
  id: 'core_self_perception',
  name: 'Self-Perception Extraction',
  type: 'self_perception',
  version: 1,
  priority: 12,

  patterns: [
    // Identity statements
    { type: 'keyword', values: ['I am', "I'm", 'I am a', 'I am the type of'], weight: 0.8 },
    { type: 'keyword', values: ['kind of person', 'type of person', 'sort of person'], weight: 0.9 },

    // Abilities
    { type: 'keyword', values: ['I can', "I can't", 'I am able to', 'I am good at', 'I am bad at'], weight: 0.8 },
    { type: 'keyword', values: ['my strength', 'my weakness', 'I excel at', 'I struggle with'], weight: 0.9 },

    // Self-evaluation
    { type: 'keyword', values: ["I'm not", "I'm too", "I'm very", 'I tend to'], weight: 0.6 },
    { type: 'keyword', values: ['my problem is', 'my issue is', 'my flaw'], weight: 0.8 },

    // Comparison
    { type: 'keyword', values: ['unlike others', 'compared to', 'better than', 'worse than'], weight: 0.6 },

    // Identity changes
    { type: 'keyword', values: ['I used to be', 'I became', "I'm becoming", 'I was'], weight: 0.7 },

    // Roles
    { type: 'keyword', values: ['as a', 'in my role as', 'being a'], weight: 0.5 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract self-perceptions - how the person sees themselves.
For each self-perception:
- statement: What was said
- self_description: The self-description
- dimension: "ability"|"personality"|"identity"|"role"|"limitation"|"aspiration"
- valence: -1 (negative self-view) to 1 (positive)
- confidence: How certain about this self-view? 0-1
- stability: "fixed"|"changeable"|"in_flux"
- comparison_to_others: Any comparison to others?
- source: Where does this self-view come from? "direct_experience"|"feedback"|"comparison"|"introspection"
- affects_behavior: How does this affect behavior?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        self_description: { type: 'string' },
        dimension: { type: 'string', enum: ['ability', 'personality', 'identity', 'role', 'limitation', 'aspiration'] },
        valence: { type: 'number', minimum: -1, maximum: 1 },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        stability: { type: 'string', enum: ['fixed', 'changeable', 'in_flux'] },
        comparison_to_others: { type: ['string', 'null'] },
        source: { type: 'string', enum: ['direct_experience', 'feedback', 'comparison', 'introspection'] },
        affects_behavior: { type: ['string', 'null'] }
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
    "statement": "I'm the kind of person who needs alone time to recharge",
    "self_description": "introvert who needs alone time",
    "dimension": "personality",
    "valence": 0.5,
    "confidence": 0.9,
    "stability": "fixed",
    "comparison_to_others": "unlike extroverts",
    "source": "direct_experience",
    "affects_behavior": "seeks solitude after social events"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Relationship](./relationship.md)
- Next: [Preference](./preference.md)
