# RAMBLE: Core Philosophy & Architecture

## Core Philosophy

**No embeddings. No vector databases. Just text, time, and programs.**

The system is built on three principles:
1. Raw data is sacred and immutable
2. Structure emerges through deterministic programs, not statistical similarity
3. LLMs extract and synthesize, they don't search

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│    SPEECH ──► SANITIZER ──► RAW STORE ──► EXTRACTION PIPELINE ──►           │
│                                │                    │                        │
│                                │                    ▼                        │
│                                │         ┌─────────────────────┐            │
│                                │         │   PROGRAM RUNNER    │            │
│                                │         │   (Pattern Match +   │            │
│                                │         │    Relevance Score)  │            │
│                                │         └─────────┬───────────┘            │
│                                │                   │                        │
│                                │                   ▼                        │
│                                │         ┌─────────────────────┐            │
│                                │         │   TOKEN BUDGET      │            │
│                                │         │   MANAGER           │            │
│                                │         └─────────┬───────────┘            │
│                                │                   │                        │
│                                │                   ▼                        │
│                                │         ┌─────────────────────┐            │
│                                │         │   LLM EXTRACTOR     │            │
│                                │         │   (JSON Output)     │            │
│                                │         └─────────┬───────────┘            │
│                                │                   │                        │
│                                │                   ▼                        │
│                                │            CLAIM STORE ◄───────────        │
│                                │                   │            │           │
│                                │                   ▼            │           │
│                                │         ┌─────────────────┐    │           │
│                                │         │ MEMORY SYSTEM   │    │           │
│                                │         │ ├─ Episodic     │    │           │
│                                │         │ ├─ Working      │    │           │
│                                │         │ └─ Long-term    │    │           │
│                                │         └─────────────────┘    │           │
│                                │                   │            │           │
│                                │                   ▼            │           │
│                                │      ┌────────────────────┐    │           │
│                                │      │  DURABLE QUEUE     │    │           │
│                                │      │  (IndexedDB-backed)│    │           │
│                                │      └─────────┬──────────┘    │           │
│                                │                │               │           │
│                                │                ▼               │           │
│                                │           OBSERVERS ───────────┘           │
│                                │                │                           │
│                                ▼                ▼                           │
│                         AGENTIC SEARCH ◄──── READ QUERIES                   │
│                                │                                            │
│                                ▼                                            │
│                    ┌─────────────────────────┐                              │
│                    │  EXTENSION REGISTRY     │                              │
│                    │  (View Synthesizers,    │                              │
│                    │   Custom Extractors)    │                              │
│                    └─────────────────────────┘                              │
│                                │                                            │
│                                ▼                                            │
│                        NOVEL SYNTHESIS                                      │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Summary

1. **Input**: Speech or text enters the system
2. **Sanitization**: Text is cleaned and normalized
3. **Storage**: Raw conversation units are stored immutably
4. **Extraction**: Programs run pattern matching, LLM extracts structured data
5. **Claims**: Extracted claims are stored with metadata
6. **Memory**: Claims flow through episodic → working → long-term memory
7. **Observers**: Background processes detect patterns, contradictions, etc.
8. **Synthesis**: On-demand queries generate novel insights

## Next Steps

- [01-data-store.md](./01-data-store.md) - Data storage schema
- [02-kernel.md](./02-kernel.md) - Kernel architecture
- [03-extraction-pipeline.md](./03-extraction-pipeline.md) - Extraction pipeline
