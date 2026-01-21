/**
 * Working Memory - Unified LLM Context System
 *
 * Single source of truth for LLM context. Used by:
 * - UI components (WorkingMemory.tsx)
 * - Core processor (processor.ts)
 * - Suggestions widget (suggestions/process.ts)
 *
 * Features:
 * - Size tiers (small/medium/large) - control token budget
 * - Two output formats - JSON (for UI) and prompt string (for LLM)
 * - Time travel - query context as of a specific timestamp
 * - Short IDs - Goals get short IDs (g1, g2...) for easy LLM reference
 * - Always fresh - queries DB on every call, no caching
 */

import {
  conversationStore,
  entityStore,
  topicStore,
  memoryStore,
  goalStore,
} from '../db/stores';
import type Conversation from '../db/models/Conversation';
import type Entity from '../db/models/Entity';
import type Topic from '../db/models/Topic';
import type Memory from '../db/models/Memory';
import type Goal from '../db/models/Goal';

// ============================================================================
// Types
// ============================================================================

export type ContextSize = 'small' | 'medium' | 'large';

export interface WorkingMemoryOptions {
  size?: ContextSize;        // Default: 'medium'
  asOfTime?: number;         // Unix timestamp for time travel (default: now)
  sessionId?: string;        // Required for conversations
}

export interface WorkingMemoryData {
  conversations: ConversationRef[];
  entities: EntityRef[];
  topics: TopicRef[];
  memories: MemoryRef[];
  goals: GoalRef[];
  meta: {
    size: ContextSize;
    asOfTime: number;
    sessionId: string | null;
    fetchedAt: number;
    estimatedTokens: number;
  };
}

// Reference types - keep DB model references for UI binding
export interface ConversationRef {
  id: string;
  speaker: string;
  text: string;           // Full sanitized text
  summary?: string;       // LLM-generated summary (for medium/large texts)
  timestamp: number;
  wordCount: number;      // For size classification
}

export interface EntityRef {
  id: string;
  name: string;
  type: string;
  mentionCount: number;
  lastMentioned: number;
}

export interface TopicRef {
  id: string;
  name: string;
  category?: string;
  mentionCount: number;
  lastMentioned: number;
}

export interface MemoryRef {
  id: string;
  content: string;
  type: string;
  importance: number;
  lastReinforced: number;
}

export interface GoalRef {
  id: string;           // Full DB ID for UI/DB operations
  shortId: string;      // Short ID for LLM (g1, g2, g3...)
  statement: string;
  type: string;
  status: string;
  progress: number;
  lastReferenced: number;
}

// ============================================================================
// Size Configuration
// ============================================================================

const SIZE_LIMITS: Record<ContextSize, {
  conversations: number;
  entities: number;
  topics: number;
  memories: number;
  goals: number;
}> = {
  small:  { conversations: 5,  entities: 15, topics: 5,  memories: 5,  goals: 3  },
  medium: { conversations: 10, entities: 15, topics: 10, memories: 10, goals: 5  },
  large:  { conversations: 15, entities: 15, topics: 15, memories: 20, goals: 10 },
};

// ============================================================================
// Conversion Functions
// ============================================================================

function toConversationRef(c: Conversation): ConversationRef {
  const text = c.sanitizedText;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    id: c.id,
    speaker: c.speaker,
    text,
    summary: (c as Conversation & { summary?: string }).summary,
    timestamp: c.timestamp,
    wordCount,
  };
}

function toEntityRef(e: Entity): EntityRef {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    mentionCount: e.mentionCount,
    lastMentioned: e.lastMentioned,
  };
}

function toTopicRef(t: Topic): TopicRef {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    mentionCount: t.mentionCount,
    lastMentioned: t.lastMentioned,
  };
}

function toMemoryRef(m: Memory): MemoryRef {
  return {
    id: m.id,
    content: m.content,
    type: m.type,
    importance: m.importance,
    lastReinforced: m.lastReinforced,
  };
}

function toGoalRef(g: Goal, index: number): GoalRef {
  return {
    id: g.id,
    shortId: `g${index + 1}`,
    statement: g.statement,
    type: g.type,
    status: g.status,
    progress: g.progress,
    lastReferenced: g.lastReferenced,
  };
}

// ============================================================================
// Working Memory Class
// ============================================================================

class WorkingMemory {
  /**
   * Fetch working memory data from DB
   * Always queries fresh - no caching
   */
  async fetch(options: WorkingMemoryOptions = {}): Promise<WorkingMemoryData> {
    const size = options.size ?? 'medium';
    const asOfTime = options.asOfTime ?? Date.now();
    const sessionId = options.sessionId ?? null;
    const limits = SIZE_LIMITS[size];

    // Query all data in parallel (fetch more than needed for time filtering)
    const [allConvs, allEntities, allTopics, allMemories, allGoals] = await Promise.all([
      sessionId ? conversationStore.getBySession(sessionId) : Promise.resolve([]),
      entityStore.getRecent(50),
      topicStore.getRecent(50),
      memoryStore.getMostImportant(50),
      goalStore.getActive(),
    ]);

    // Apply time filter and limits
    const conversations = allConvs
      .filter(c => c.timestamp <= asOfTime)
      .slice(-limits.conversations)
      .map(toConversationRef);

    const entities = allEntities
      .filter(e => e.lastMentioned <= asOfTime)
      .slice(0, limits.entities)
      .map(toEntityRef);

    const topics = allTopics
      .filter(t => t.lastMentioned <= asOfTime)
      .slice(0, limits.topics)
      .map(toTopicRef);

    const memories = allMemories
      .filter(m => m.lastReinforced <= asOfTime)
      .slice(0, limits.memories)
      .map(toMemoryRef);

    // Goals get short IDs assigned based on position
    const filteredGoals = allGoals
      .filter(g => g.lastReferenced <= asOfTime)
      .slice(0, limits.goals);

    const goals = filteredGoals.map((g, i) => toGoalRef(g, i));

    const data: WorkingMemoryData = {
      conversations,
      entities,
      topics,
      memories,
      goals,
      meta: {
        size,
        asOfTime,
        sessionId,
        fetchedAt: Date.now(),
        estimatedTokens: 0, // Will be calculated below
      },
    };

    data.meta.estimatedTokens = this.estimateTokens(data);

    return data;
  }

  /**
   * Format working memory as LLM prompt string
   */
  formatForLLM(data: WorkingMemoryData): string {
    const parts: string[] = [];

    // Recent conversations
    if (data.conversations.length > 0) {
      parts.push('## Recent Conversation');
      for (let i = 0; i < data.conversations.length; i++) {
        const c = data.conversations[i];
        const isRecent = i >= data.conversations.length - 2; // Last 2
        const isLarge = c.wordCount > 100;

        // Use summary for older large conversations, full text otherwise
        const displayText = (isRecent || !isLarge || !c.summary) ? c.text : c.summary;
        parts.push(`${c.speaker}: ${displayText}`);
      }
    }

    // Known entities
    if (data.entities.length > 0) {
      parts.push('\n## Known Entities');
      for (const e of data.entities) {
        parts.push(`- ${e.name} (${e.type})`);
      }
    }

    // Active topics
    if (data.topics.length > 0) {
      parts.push('\n## Active Topics');
      for (const t of data.topics) {
        parts.push(`- ${t.name}${t.category ? ` [${t.category}]` : ''}`);
      }
    }

    // Working memories
    if (data.memories.length > 0) {
      parts.push('\n## Working Memory');
      for (const m of data.memories) {
        parts.push(`- [${m.type}] ${m.content}`);
      }
    }

    // Goals with short IDs
    if (data.goals.length > 0) {
      parts.push('\n## Active Goals');
      for (const g of data.goals) {
        parts.push(`- [${g.shortId}] ${g.statement} (${g.status}, ${g.progress}%)`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Estimate token count for the data
   * Rough estimate: ~4 chars per token for English text
   */
  estimateTokens(data: WorkingMemoryData): number {
    let charCount = 0;

    // Conversations
    for (const c of data.conversations) {
      // Use summary if available and text is large
      const isLarge = c.wordCount > 100;
      const text = (isLarge && c.summary) ? c.summary : c.text;
      charCount += c.speaker.length + 2 + text.length;
    }

    // Entities
    for (const e of data.entities) {
      charCount += e.name.length + e.type.length + 10;
    }

    // Topics
    for (const t of data.topics) {
      charCount += t.name.length + (t.category?.length ?? 0) + 10;
    }

    // Memories
    for (const m of data.memories) {
      charCount += m.content.length + m.type.length + 10;
    }

    // Goals
    for (const g of data.goals) {
      charCount += g.statement.length + g.shortId.length + g.status.length + 20;
    }

    // Add overhead for formatting (~20%)
    return Math.round((charCount / 4) * 1.2);
  }

  /**
   * Check if working memory is empty
   */
  isEmpty(data: WorkingMemoryData): boolean {
    return (
      data.conversations.length === 0 &&
      data.entities.length === 0 &&
      data.topics.length === 0 &&
      data.memories.length === 0 &&
      data.goals.length === 0
    );
  }

  /**
   * Find a goal by its short ID (g1, g2, etc.)
   * Returns the goal ref with full DB ID for updates
   */
  findGoalByShortId(data: WorkingMemoryData, shortId: string): GoalRef | undefined {
    return data.goals.find(g => g.shortId === shortId);
  }

  /**
   * Extract available topics from working memory
   * Useful for suggestions and filtering
   */
  extractTopics(data: WorkingMemoryData): string[] {
    const topics = new Set<string>();

    for (const t of data.topics) {
      topics.add(t.name);
    }

    for (const e of data.entities) {
      if (e.type !== 'unknown') {
        topics.add(e.type);
      }
    }

    for (const g of data.goals) {
      if (g.type) {
        topics.add(g.type);
      }
    }

    return Array.from(topics).slice(0, 10);
  }
}

// Export singleton instance
export const workingMemory = new WorkingMemory();

// Also export class for testing
export { WorkingMemory };
