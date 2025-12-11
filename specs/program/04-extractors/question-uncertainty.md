# Question & Uncertainty Extraction

## Overview

Extracts questions, uncertainties, and knowledge gaps.

## Configuration

```typescript
const uncertaintyExtractor: ExtractionProgram = {
  id: 'core_uncertainty',
  name: 'Question & Uncertainty Extraction',
  type: 'question',
  version: 1,
  priority: 6,

  patterns: [
    // Direct questions
    { type: 'regex', value: '.*\\?$', weight: 0.9 },
    { type: 'keyword', values: ['who', 'what', 'where', 'when', 'why', 'how', 'which'], weight: 0.5 },

    // Uncertainty markers
    { type: 'keyword', values: ["I don't know", "I'm not sure", 'uncertain', "I wonder"], weight: 0.9 },
    { type: 'keyword', values: ['maybe', 'perhaps', 'possibly', 'might', 'could be'], weight: 0.6 },
    { type: 'keyword', values: ['unclear', 'confusing', 'puzzling', "don't understand"], weight: 0.8 },

    // Seeking input
    { type: 'keyword', values: ['should I', 'what if', 'would it be', 'is it better'], weight: 0.7 },
    { type: 'keyword', values: ['any ideas', 'any thoughts', 'suggestions', 'advice'], weight: 0.7 },

    // Open considerations
    { type: 'keyword', values: ['considering', 'thinking about', 'weighing', 'debating'], weight: 0.6 },
    { type: 'keyword', values: ['on one hand', 'on the other hand', 'alternatively'], weight: 0.7 },

    // Knowledge gaps
    { type: 'keyword', values: ['need to find out', 'need to learn', 'need to figure out'], weight: 0.8 },
    { type: 'keyword', values: ["haven't decided", "haven't figured out", "can't tell"], weight: 0.7 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract questions, uncertainties, and knowledge gaps.
For each uncertainty:
- statement: The question or uncertainty
- uncertainty_type: "factual_question"|"decision_question"|"existential_question"|"knowledge_gap"|"ambivalence"
- subject: What is the uncertainty about
- importance: How important is resolving this? "low"|"medium"|"high"|"critical"
- blockers: What's preventing resolution?
- options_considered: If a decision, what options are being weighed?
- time_sensitivity: Is there urgency? "none"|"low"|"moderate"|"urgent"`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        uncertainty_type: { type: 'string', enum: ['factual_question', 'decision_question', 'existential_question', 'knowledge_gap', 'ambivalence'] },
        subject: { type: 'string' },
        importance: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        blockers: { type: ['array', 'null'], items: { type: 'string' } },
        options_considered: { type: ['array', 'null'], items: { type: 'string' } },
        time_sensitivity: { type: 'string', enum: ['none', 'low', 'moderate', 'urgent'] }
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
    "statement": "Should I take the new job offer or stay at my current company?",
    "uncertainty_type": "decision_question",
    "subject": "career decision",
    "importance": "high",
    "blockers": ["uncertainty about company culture", "salary negotiation pending"],
    "options_considered": ["accept new job", "stay at current company"],
    "time_sensitivity": "moderate"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Causal](./causal.md)
- Next: [Decision](./decision.md)
