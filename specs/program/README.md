# RAMBLE System Specification

This directory contains the complete specification for the RAMBLE (Revised Anthropic Mind-modeling through Belief Language Extraction) system.

## Overview

**No embeddings. No vector databases. Just text, time, and programs.**

The system is built on three principles:
1. Raw data is sacred and immutable
2. Structure emerges through deterministic programs, not statistical similarity
3. LLMs extract and synthesize, they don't search

## Documentation Index

### Core Architecture

| File | Description |
|------|-------------|
| [00-philosophy.md](./00-philosophy.md) | Core philosophy and system architecture overview |
| [01-data-store.md](./01-data-store.md) | TinyBase + IndexedDB schema, relationships, indexes |
| [02-kernel.md](./02-kernel.md) | Extensible kernel architecture and extension system |
| [03-extraction-pipeline.md](./03-extraction-pipeline.md) | Extraction pipeline and token budget management |

### Extraction Programs

| File | Description |
|------|-------------|
| [04-extractors/index.md](./04-extractors/index.md) | Overview of all 20 extraction programs |

Individual extractors:
- [entity.md](./04-extractors/entity.md) - Named entity extraction
- [claim-factual.md](./04-extractors/claim-factual.md) - Factual claim extraction
- [claim-belief.md](./04-extractors/claim-belief.md) - Belief extraction
- [claim-intention.md](./04-extractors/claim-intention.md) - Intention extraction
- [causal.md](./04-extractors/causal.md) - Causal belief extraction
- [question-uncertainty.md](./04-extractors/question-uncertainty.md) - Question and uncertainty extraction
- [decision.md](./04-extractors/decision.md) - Decision extraction
- [emotion.md](./04-extractors/emotion.md) - Emotional state extraction
- [goal.md](./04-extractors/goal.md) - Goal extraction
- [value.md](./04-extractors/value.md) - Value and principle extraction
- [relationship.md](./04-extractors/relationship.md) - Relationship extraction
- [self-perception.md](./04-extractors/self-perception.md) - Self-perception extraction
- [preference.md](./04-extractors/preference.md) - Preference extraction
- [habit.md](./04-extractors/habit.md) - Habit and routine extraction
- [memory-reference.md](./04-extractors/memory-reference.md) - Memory reference extraction
- [concern.md](./04-extractors/concern.md) - Concern and worry extraction
- [learning.md](./04-extractors/learning.md) - Learning and insight extraction
- [change-marker.md](./04-extractors/change-marker.md) - Change marker extraction
- [hypothetical.md](./04-extractors/hypothetical.md) - Hypothetical and counterfactual extraction
- [commitment.md](./04-extractors/commitment.md) - Commitment extraction

### Core Systems

| File | Description |
|------|-------------|
| [05-thought-chains.md](./05-thought-chains.md) | Thought chain system for conversation flow tracking |
| [06-goal-system.md](./06-goal-system.md) | Goal hierarchy and progress tracking |
| [07-queue.md](./07-queue.md) | Durable queue system for reliable task execution |
| [08-observers.md](./08-observers.md) | Observer system for pattern detection and analysis |

### Mind Modeling

| File | Description |
|------|-------------|
| [09-mind-modeling.md](./09-mind-modeling.md) | Advanced mind modeling components |

Includes: Attention/Salience, Worldview/Mental Model, Temporal Self, Social Context, Resource/Constraint Awareness, Decision Style, and Coping Patterns.

### Initialization

| File | Description |
|------|-------------|
| [10-initialization.md](./10-initialization.md) | System initialization and summary |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| IndexedDB + TinyBase | Yes | Browser-native, no server needed |
| Extension system | Yes | Composable, verifiable, evolvable |
| Token budget manager | Yes | Controls LLM costs, prioritizes important context |
| 20 core extractors | Yes | Comprehensive coverage of mental life |
| Durable queue | Yes | Reliability without external dependencies |
| Observer pattern | Yes | Decoupled, asynchronous intelligence |
| Goal tree with hierarchy | Yes | Captures motivation structure |
| Automatic chain management | Yes | No manual organization needed |
| Mind model synthesis | Yes | Holistic understanding beyond individual claims |
| Attention/salience system | Yes | Tracks what matters now |
