# Layer 5: Thought Chain System

## Overview

The user just talks. The system automatically organizes into chains that track the flow of conversation.

## Automatic Chain Management

```typescript
interface ChainManager {
  // Called after each extraction
  processNewClaims(
    unitId: string,
    claims: ExtractedClaim[],
    sessionContext: SessionContext
  ): Promise<ChainUpdate[]>;
}

interface SessionContext {
  sessionId: string;
  activeChains: ThoughtChain[]; // Chains active in this session
  recentClaims: Claim[]; // Last N claims for context
}

interface ChainUpdate {
  type: 'extend' | 'create' | 'branch' | 'merge' | 'conclude';
  chainId: string;
  claimIds: string[];
  reasoning?: string;
}
```

## Chain Detection Logic

```typescript
async function processNewClaims(
  unitId: string,
  claims: ExtractedClaim[],
  context: SessionContext
): Promise<ChainUpdate[]> {
  const updates: ChainUpdate[] = [];

  for (const claim of claims) {
    // 1. Check for topic continuity with active chains
    const relatedChain = await findRelatedChain(claim, context.activeChains);

    if (relatedChain) {
      // Calculate semantic distance (simple heuristics, no embeddings)
      const distance = calculateTopicDistance(claim, relatedChain);

      if (distance < CONTINUE_THRESHOLD) {
        // Continue existing chain
        updates.push({
          type: 'extend',
          chainId: relatedChain.id,
          claimIds: [claim.id]
        });
      } else if (distance < BRANCH_THRESHOLD) {
        // Branch from existing chain
        const newChainId = generateId();
        updates.push({
          type: 'branch',
          chainId: newChainId,
          claimIds: [claim.id],
          reasoning: `Branched from "${relatedChain.topic}" due to topic shift`
        });
      }
    } else {
      // Check for dormant chains that might be revived
      const dormantChain = await findRelatedDormantChain(claim);

      if (dormantChain) {
        // Revive dormant chain
        updates.push({
          type: 'extend',
          chainId: dormantChain.id,
          claimIds: [claim.id],
          reasoning: `Revived chain about "${dormantChain.topic}"`
        });
      } else {
        // Start new chain
        const topic = await extractTopic(claim);
        const newChainId = generateId();
        updates.push({
          type: 'create',
          chainId: newChainId,
          claimIds: [claim.id],
          reasoning: `New topic: "${topic}"`
        });
      }
    }
  }

  return updates;
}
```

## Topic Distance Calculation (No Embeddings)

```typescript
function calculateTopicDistance(claim: Claim, chain: ThoughtChain): number {
  let score = 0;

  // 1. Entity overlap
  const chainEntities = getChainEntities(chain);
  const claimEntities = extractEntitiesFromClaim(claim);
  const entityOverlap = intersection(chainEntities, claimEntities).size;
  score += entityOverlap * 0.3;

  // 2. Subject similarity (fuzzy string matching)
  const subjectSimilarity = fuzzyMatch(claim.subject, chain.topic);
  score += subjectSimilarity * 0.3;

  // 3. Keyword overlap
  const chainKeywords = extractKeywords(chain);
  const claimKeywords = extractKeywords(claim.statement);
  const keywordOverlap = jaccardSimilarity(chainKeywords, claimKeywords);
  score += keywordOverlap * 0.2;

  // 4. Temporal proximity
  const timeSinceChainActive = Date.now() - chain.last_extended;
  const timeDecay = Math.exp(-timeSinceChainActive / (24 * 60 * 60 * 1000)); // Decay over 24h
  score += timeDecay * 0.2;

  // Convert to distance (lower = more related)
  return 1 - Math.min(score, 1);
}
```

## Chain Lifecycle

```
                  ┌──────────────┐
   New Topic ────►│   ACTIVE     │◄──── Revival
                  │              │
                  └──────┬───────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
    (continues)    (time passes)   (explicit end)
          │              │              │
          ▼              ▼              ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │   ACTIVE     │ │   DORMANT    │ │  CONCLUDED   │
   │  (extended)  │ │              │ │              │
   └──────────────┘ └──────────────┘ └──────────────┘
```

## Session Boundary Handling

When a session ends:

```typescript
async function handleSessionEnd(sessionId: string): Promise<void> {
  // 1. Mark all active chains as potentially dormant
  const activeChains = await getActiveChains(sessionId);

  for (const chain of activeChains) {
    // Don't immediately mark dormant - give 24h window
    await scheduleTask({
      type: 'check_chain_dormancy',
      chainId: chain.id,
      executeAt: Date.now() + 24 * 60 * 60 * 1000
    });
  }

  // 2. Generate session summary
  await scheduleTask({
    type: 'generate_session_summary',
    sessionId: sessionId,
    executeAt: Date.now()
  });
}
```

---

## Navigation

- Previous: [04-extractors/index.md](./04-extractors/index.md)
- Next: [06-goal-system.md](./06-goal-system.md)
