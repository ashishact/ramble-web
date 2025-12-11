# Layer 1: Data Store (IndexedDB + TinyBase)

## Store Structure

TinyBase organizes data into Tables, Rows, and Cells. Here's the schema:

```typescript
// TinyBase Store Schema

interface RambleStore {
  tables: {
    // Raw conversation units - immutable
    conversation_units: {
      [id: string]: {
        session_id: string;
        timestamp: number; // Unix ms
        raw_text: string;
        sanitized_text: string;
        source: 'speech' | 'text';
        preceding_context_summary: string;
        created_at: number;
        processed: boolean; // Has extraction run?
      }
    };

    // Extracted claims
    claims: {
      [id: string]: {
        statement: string;
        subject: string;
        claim_type: string;
        temporality: string;
        abstraction: string;
        source_type: string;
        initial_confidence: number;
        current_confidence: number;
        state: 'active' | 'stale' | 'dormant' | 'superseded';
        emotional_valence: number;
        emotional_intensity: number;
        stakes: string;
        valid_from: number;
        valid_until: number | null;
        created_at: number;
        last_confirmed: number;
        confirmation_count: number;
        extraction_program_id: string;
        superseded_by: string | null;
        elaborates: string | null;
        thought_chain_id: string | null;
      }
    };

    // Claim to source unit relationships (many-to-many)
    claim_sources: {
      [id: string]: {
        claim_id: string;
        unit_id: string;
      }
    };

    // Entities
    entities: {
      [id: string]: {
        canonical_name: string;
        entity_type: string;
        aliases: string; // JSON array as string
        created_at: number;
        last_referenced: number;
        mention_count: number;
      }
    };

    // Thought chains
    thought_chains: {
      [id: string]: {
        topic: string;
        started_at: number;
        last_extended: number;
        branches_from: string | null;
        state: 'active' | 'dormant' | 'concluded';
      }
    };

    // Chain to claim relationships
    chain_claims: {
      [id: string]: {
        chain_id: string;
        claim_id: string;
        position: number;
      }
    };

    // Extraction programs
    extraction_programs: {
      [id: string]: {
        name: string;
        type: string;
        version: number;
        patterns_json: string; // JSON array
        extraction_prompt: string;
        output_schema_json: string;
        priority: number; // For ordering
        active: boolean;
        is_core: boolean; // Core vs extension
        success_rate: number;
        run_count: number;
        created_at: number;
      }
    };

    // Durable task queue
    task_queue: {
      [id: string]: {
        task_type: string;
        payload_json: string;
        status: 'pending' | 'processing' | 'completed' | 'failed';
        attempts: number;
        max_attempts: number;
        created_at: number;
        started_at: number | null;
        completed_at: number | null;
        error: string | null;
        priority: number;
      }
    };

    // Observer outputs
    observer_outputs: {
      [id: string]: {
        observer_type: string;
        output_type: string;
        content_json: string;
        source_claims_json: string; // Array of claim IDs
        created_at: number;
        stale: boolean;
      }
    };

    // Goals (first-class entity)
    goals: {
      [id: string]: {
        statement: string;
        type: 'outcome' | 'process' | 'identity' | 'avoidance';
        timeframe: 'immediate' | 'short_term' | 'medium_term' | 'long_term' | 'life';
        status: 'active' | 'achieved' | 'abandoned' | 'blocked' | 'dormant';
        parent_goal_id: string | null;
        created_at: number;
        last_referenced: number;
        priority: number;
        progress_indicators_json: string;
        blockers_json: string;
        source_claim_id: string;
      }
    };

    // Contradictions
    contradictions: {
      [id: string]: {
        claim_a_id: string;
        claim_b_id: string;
        detected_at: number;
        contradiction_type: 'direct' | 'temporal' | 'implication';
        resolved: boolean;
        resolution_type: string | null;
        resolution_notes: string | null;
        resolved_at: number | null;
      }
    };

    // Extension registry
    extensions: {
      [id: string]: {
        extension_type: 'view_synthesizer' | 'extractor' | 'observer';
        name: string;
        description: string;
        config_json: string;
        system_prompt: string;
        user_prompt_template: string; // Contains {VARIABLE} placeholders
        variables_schema_json: string;
        status: 'draft' | 'verified' | 'production';
        version: number;
        created_at: number;
        verified_at: number | null;
      }
    };

    // Synthesis cache
    synthesis_cache: {
      [id: string]: {
        synthesis_type: string;
        cache_key: string;
        content_json: string;
        source_claims_json: string;
        generated_at: number;
        stale: boolean;
        ttl_seconds: number;
      }
    };

    // Sessions
    sessions: {
      [id: string]: {
        started_at: number;
        ended_at: number | null;
        unit_count: number;
        summary: string | null;
        mood_trajectory_json: string | null;
      }
    };

    // Values and Principles (core identity)
    values: {
      [id: string]: {
        statement: string;
        domain: string; // work, relationships, health, etc.
        importance: number; // 0-1
        source_claim_id: string;
        first_expressed: number;
        last_confirmed: number;
        confirmation_count: number;
      }
    };

    // Recurring patterns
    patterns: {
      [id: string]: {
        pattern_type: string;
        description: string;
        evidence_claims_json: string;
        first_detected: number;
        last_detected: number;
        occurrence_count: number;
        confidence: number;
      }
    };
  };

  // TinyBase indexes for fast lookups
  indexes: {
    claims_by_state: { state: string };
    claims_by_chain: { thought_chain_id: string };
    claims_by_subject: { subject: string };
    units_by_session: { session_id: string };
    tasks_by_status: { status: string };
    goals_by_status: { status: string };
    goals_by_parent: { parent_goal_id: string };
  };
}
```

## TinyBase Relationships

```typescript
// Define relationships for easy traversal
const relationships = createRelationships(store);

relationships.setRelationshipDefinition(
  'claimToChain',
  'claims',
  'thought_chains',
  'thought_chain_id'
);

relationships.setRelationshipDefinition(
  'goalToParent',
  'goals',
  'goals',
  'parent_goal_id'
);

relationships.setRelationshipDefinition(
  'claimSources',
  'claim_sources',
  'conversation_units',
  'unit_id'
);
```

---

## Navigation

- Previous: [00-philosophy.md](./00-philosophy.md)
- Next: [02-kernel.md](./02-kernel.md)
