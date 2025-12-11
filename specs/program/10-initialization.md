# Layer 10: System Initialization & Summary

## System Initialization

```typescript
async function initializeRAMBLE(): Promise<RambleSystem> {
  // 1. Initialize TinyBase store
  const store = createStore();
  const persister = createIndexedDbPersister(store, 'ramble-store');
  await persister.load();

  // 2. Initialize durable queue
  const queue = new IndexedDBDurableQueue(store);
  const queueRunner = new QueueRunner(queue);

  // 3. Initialize core systems
  const extractionPipeline = new ExtractionPipeline(store, queue);
  const chainManager = new ChainManager(store);
  const memorySystem = new MemorySystem(store);
  const goalSystem = new GoalSystem(store);
  const observerDispatcher = new ObserverDispatcher(queue);
  const extensionRegistry = new ExtensionRegistry(store);
  const synthesizer = new Synthesizer(store, extensionRegistry);

  // 4. Load core extraction programs
  await loadCoreExtractionPrograms(store);

  // 5. Start queue processing
  queueRunner.start();

  // 6. Schedule periodic tasks
  schedulePeriodicTasks(queue);

  return {
    store,
    queue,
    queueRunner,
    extractionPipeline,
    chainManager,
    memorySystem,
    goalSystem,
    observerDispatcher,
    extensionRegistry,
    synthesizer,

    // Main API
    async ingest(text: string, source: 'speech' | 'text'): Promise<string> {
      const unitId = await createConversationUnit(store, text, source);
      await queue.enqueue({
        type: 'extract_from_unit',
        payload: { unitId },
        priority: 10,
        maxAttempts: 3,
        executeAt: Date.now()
      });
      return unitId;
    },

    async query(question: string): Promise<QueryResult> {
      return await agenticSearch(question, store, synthesizer);
    },

    async getTopOfMind(): Promise<TopOfMind> {
      return await attentionSystem.getTopOfMind();
    },

    async getGoalTree(): Promise<GoalTree> {
      return await goalSystem.buildTree();
    },

    async runSynthesis(type: string, params: any): Promise<any> {
      return await synthesizer.generate(type, params);
    }
  };
}
```

## Periodic Tasks

```typescript
function schedulePeriodicTasks(queue: DurableQueue): void {
  // Daily: Decay claims
  setInterval(async () => {
    await queue.enqueue({
      type: 'decay_claims',
      payload: {},
      priority: 1,
      maxAttempts: 3,
      executeAt: Date.now()
    });
  }, 24 * 60 * 60 * 1000);

  // Weekly: Narrative analysis
  setInterval(async () => {
    await queue.enqueue({
      type: 'run_observer',
      payload: {
        observerId: 'observer_narrative',
        context: { trigger: { type: 'schedule', pattern: 'weekly' } }
      },
      priority: 2,
      maxAttempts: 3,
      executeAt: Date.now()
    });
  }, 7 * 24 * 60 * 60 * 1000);

  // Weekly: Mind model synthesis
  setInterval(async () => {
    await queue.enqueue({
      type: 'run_observer',
      payload: {
        observerId: 'observer_mind_model',
        context: { trigger: { type: 'schedule', pattern: 'weekly' } }
      },
      priority: 2,
      maxAttempts: 3,
      executeAt: Date.now()
    });
  }, 7 * 24 * 60 * 60 * 1000);
}
```

## Key Design Decisions Summary

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

---

## Navigation

- Previous: [09-mind-modeling.md](./09-mind-modeling.md)
- Back to: [README.md](./README.md)
