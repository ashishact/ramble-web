# Goal Extraction

## Overview

Extracts goals - what the person wants to achieve or become.

## Configuration

```typescript
const goalExtractor: ExtractionProgram = {
  id: 'core_goal',
  name: 'Goal Extraction',
  type: 'goal',
  version: 1,
  priority: 9,

  patterns: [
    // Explicit goals
    { type: 'keyword', values: ['my goal is', 'goal is to', 'I aim to', 'I aspire to'], weight: 0.95 },
    { type: 'keyword', values: ['objective is', 'target is', 'I want to achieve'], weight: 0.9 },

    // Desires
    { type: 'keyword', values: ['I want', 'I wish', 'I hope', "I'd love to", 'dream of'], weight: 0.7 },
    { type: 'keyword', values: ['looking forward to', 'can\'t wait to', 'excited to'], weight: 0.6 },

    // Needs
    { type: 'keyword', values: ['I need to', 'have to', 'must', 'require'], weight: 0.6 },

    // Striving
    { type: 'keyword', values: ['working towards', 'striving for', 'pursuing', 'chasing'], weight: 0.85 },
    { type: 'keyword', values: ['trying to', 'attempting to', 'working on'], weight: 0.7 },

    // Outcomes
    { type: 'keyword', values: ['so that', 'in order to', 'to be able to', 'to become'], weight: 0.6 },

    // Identity goals
    { type: 'keyword', values: ['I want to be', "I'd like to become", 'kind of person who'], weight: 0.85 },

    // Avoidance goals
    { type: 'keyword', values: ["don't want to", 'avoid', 'prevent', 'stop being'], weight: 0.7 },

    // Success/failure framing
    { type: 'keyword', values: ['succeed at', 'accomplish', 'complete', 'finish'], weight: 0.6 },
    { type: 'keyword', values: ['fail at', "haven't achieved", 'struggling with'], weight: 0.5 }
  ],

  relevanceScorer: { type: 'weighted_sum' },

  extractionPrompt: `Extract goals - what the person wants to achieve or become.
For each goal:
- statement: The goal stated
- goal_statement: Clear, actionable goal statement
- goal_type: "outcome"|"process"|"identity"|"avoidance"|"maintenance"
- domain: "career"|"health"|"relationships"|"financial"|"learning"|"creative"|"personal_growth"|"other"
- timeframe: "immediate"|"short_term"|"medium_term"|"long_term"|"life"
- specificity: "vague"|"general"|"specific"|"measurable"
- motivation: Why do they want this?
- current_status: "not_started"|"in_progress"|"blocked"|"near_completion"|"achieved"|"abandoned"
- obstacles: What's in the way?
- sub_goals: Any mentioned sub-goals?
- parent_goal: Is this part of a bigger goal?`,

  outputSchema: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        statement: { type: 'string' },
        goal_statement: { type: 'string' },
        goal_type: { type: 'string', enum: ['outcome', 'process', 'identity', 'avoidance', 'maintenance'] },
        domain: { type: 'string' },
        timeframe: { type: 'string', enum: ['immediate', 'short_term', 'medium_term', 'long_term', 'life'] },
        specificity: { type: 'string', enum: ['vague', 'general', 'specific', 'measurable'] },
        motivation: { type: ['string', 'null'] },
        current_status: { type: 'string', enum: ['not_started', 'in_progress', 'blocked', 'near_completion', 'achieved', 'abandoned'] },
        obstacles: { type: ['array', 'null'], items: { type: 'string' } },
        sub_goals: { type: ['array', 'null'], items: { type: 'string' } },
        parent_goal: { type: ['string', 'null'] }
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
    "statement": "I want to become a senior engineer within the next two years",
    "goal_statement": "Achieve senior engineer role",
    "goal_type": "outcome",
    "domain": "career",
    "timeframe": "medium_term",
    "specificity": "specific",
    "motivation": "career advancement",
    "current_status": "in_progress",
    "obstacles": ["need more project leadership experience"],
    "sub_goals": ["lead a major project", "mentor junior developers"],
    "parent_goal": "career growth"
  }
]
```

---

## Navigation

- [Back to Index](./index.md)
- Previous: [Emotion](./emotion.md)
- Next: [Value](./value.md)
