/**
 * Working Memory - Unified LLM Context System
 *
 * Reads from DuckDB graph stores (entities, topics, memories, goals)
 * and DuckDB conversation store. Single source of truth for LLM context.
 *
 * Used by:
 * - UI components (WorkingMemory.tsx)
 * - Suggestions widget
 * - Questions widget
 *
 * Features:
 * - Size tiers (small/medium/large) - control token budget
 * - Two output formats - JSON (for UI) and prompt string (for LLM)
 * - Short IDs - Goals/Memories get short IDs for easy LLM reference
 * - Always fresh - queries DB on every call, no caching
 */

import { conversationStore } from '../graph/stores/conversationStore';
import { getEntityStore, getTopicStore, getMemoryStore, getGoalStore } from '../graph/stores/singletons';
import { dataStore } from '../graph/stores/dataStore';
import type { GraphConversation, EntityProperties, TopicProperties, CognitiveProperties, GoalProperties } from '../graph/types';

// ============================================================================
// Types
// ============================================================================

export type ContextSize = 'small' | 'medium' | 'large';

export interface WorkingMemoryOptions {
  size?: ContextSize;        // Default: 'medium'
  asOfTime?: number;         // Unix timestamp for time travel (default: now)
}

export interface UserContext {
  userName?: string;       // User's name (if available)
  currentTime: string;     // Full timestamp with timezone
}

export interface WorkingMemoryData {
  userContext: UserContext;
  conversations: ConversationRef[];
  entities: EntityRef[];
  topics: TopicRef[];
  memories: MemoryRef[];
  goals: GoalRef[];
  meta: {
    size: ContextSize;
    asOfTime: number;
    fetchedAt: number;
    estimatedTokens: number;
  };
}

// Reference types - lightweight shapes for UI and LLM context
export interface ConversationRef {
  id: string;
  speaker: string;
  text: string;           // Full raw text
  summary?: string;
  timestamp: number;
  wordCount: number;
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
  shortId: string;      // 'm1', 'm2', etc.
  content: string;
  type: string;
  importance: number;
  confidence: number;
  lastReinforced: number;
  reinforcementCount: number;
  subject?: string;
}

export interface GoalRef {
  id: string;           // Full DB ID
  shortId: string;      // Short ID for LLM (g1, g2, g3...)
  statement: string;
  type: string;
  status: string;
  progress: number;
  lastReferenced: number;
}

// ============================================================================
// Temporal Formatting
// ============================================================================

function formatRelativeTime(timestamp: number, now: number): string {
  const diffMs = now - timestamp;
  if (diffMs < 0) return 'just now';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks <= 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
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
// Conversion Functions (DuckDB → Ref shapes)
// ============================================================================

function toConversationRef(c: GraphConversation): ConversationRef {
  const text = c.raw_text;
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  return {
    id: c.id,
    speaker: c.speaker,
    text,
    timestamp: c.timestamp,
    wordCount,
  };
}

function toEntityRef(e: { id: string } & EntityProperties): EntityRef {
  return {
    id: e.id,
    name: e.name,
    type: e.type,
    mentionCount: e.mentionCount,
    lastMentioned: e.lastMentioned,
  };
}

function toTopicRef(t: { id: string } & TopicProperties): TopicRef {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    mentionCount: t.mentionCount,
    lastMentioned: t.lastMentioned,
  };
}

function toMemoryRef(m: { id: string } & CognitiveProperties, index: number): MemoryRef {
  return {
    id: m.id,
    shortId: `m${index + 1}`,
    content: m.content,
    type: m.type,
    importance: m.importance,
    confidence: m.confidence,
    lastReinforced: m.lastReinforced,
    reinforcementCount: m.reinforceCount,
    subject: m.subject,
  };
}

function toGoalRef(g: { id: string } & GoalProperties, index: number): GoalRef {
  return {
    id: g.id,
    shortId: `g${index + 1}`,
    statement: g.statement,
    type: g.type,
    status: g.status,
    progress: g.progress,
    lastReferenced: 0, // GoalProperties doesn't track lastReferenced; use 0
  };
}

// ============================================================================
// Memory Deduplication
// ============================================================================

/**
 * Filter out memories that are already covered by conversations in context.
 * A memory is "covered" if ANY of its sourceConversationIds appears in the
 * conversation context — meaning the LLM will see the original text anyway.
 */
function filterRedundantMemories(
  memories: Array<{ id: string } & CognitiveProperties>,
  conversationIds: Set<string>
): Array<{ id: string } & CognitiveProperties> {
  if (conversationIds.size === 0) return memories;

  return memories.filter(memory => {
    const sourceIds = memory.sourceConversationIds ?? [];
    const isCoveredByContext = sourceIds.some(id => conversationIds.has(id));
    return !isCoveredByContext;
  });
}

// ============================================================================
// Working Memory Class
// ============================================================================

class WorkingMemory {
  /**
   * Fetch working memory data from DuckDB
   * Always queries fresh - no caching
   */
  async fetch(options: WorkingMemoryOptions = {}): Promise<WorkingMemoryData> {
    const size = options.size ?? 'medium';
    const asOfTime = options.asOfTime ?? Date.now();
    const limits = SIZE_LIMITS[size];

    // Resolve async store singletons
    const [entityStore, topicStore, memoryStore, goalStore] = await Promise.all([
      getEntityStore(),
      getTopicStore(),
      getMemoryStore(),
      getGoalStore(),
    ]);

    // Query all data in parallel
    const [allConvs, allEntities, allTopics, allMemories, allGoals] = await Promise.all([
      conversationStore.getRecent(50),
      entityStore.getAll(),
      topicStore.getAll(),
      memoryStore.getActive(50),
      goalStore.getActive(),
    ]);

    // Build user context
    const userProfile = dataStore.getUserProfile();
    const userContext: UserContext = {
      currentTime: new Date().toString(),
    };
    if (userProfile?.name) {
      const safeName = userProfile.name.trim().slice(0, 50);
      if (safeName) {
        userContext.userName = safeName;
      }
    }

    // Apply time filter, take most recent N, then reverse for chronological order
    const filteredConvs = allConvs
      .filter(c => c.timestamp <= asOfTime)
      .slice(0, limits.conversations)
      .reverse();

    const conversations = filteredConvs.map(toConversationRef);

    // Build set of conversation IDs in context (for memory deduplication)
    const conversationIdsInContext = new Set(filteredConvs.map(c => c.id));

    // Entities: sort by lastMentioned DESC, filter by time, limit
    const entities = allEntities
      .filter(e => e.lastMentioned <= asOfTime)
      .sort((a, b) => b.lastMentioned - a.lastMentioned)
      .slice(0, limits.entities)
      .map(toEntityRef);

    // Topics: sort by lastMentioned DESC, filter by time, limit
    const topics = allTopics
      .filter(t => t.lastMentioned <= asOfTime)
      .sort((a, b) => b.lastMentioned - a.lastMentioned)
      .slice(0, limits.topics)
      .map(toTopicRef);

    // Memories: filter by time, deduplicate against conversations, limit
    const timeFilteredMemories = allMemories.filter(m => m.lastReinforced <= asOfTime);
    const deduplicatedMemories = filterRedundantMemories(timeFilteredMemories, conversationIdsInContext);
    const memories = deduplicatedMemories
      .slice(0, limits.memories)
      .map((m, i) => toMemoryRef(m, i));

    // Goals: limit to budget
    const goals = allGoals
      .slice(0, limits.goals)
      .map((g, i) => toGoalRef(g, i));

    const data: WorkingMemoryData = {
      userContext,
      conversations,
      entities,
      topics,
      memories,
      goals,
      meta: {
        size,
        asOfTime,
        fetchedAt: Date.now(),
        estimatedTokens: 0,
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

    // User info
    if (data.userContext.userName) {
      parts.push(`User: ${data.userContext.userName}`);
    }

    // Recent conversations — chronological with relative time
    if (data.conversations.length > 0) {
      const now = data.meta.asOfTime;
      parts.push('## Recent Conversation');
      for (let i = 0; i < data.conversations.length; i++) {
        const c = data.conversations[i];
        const isRecent = i >= data.conversations.length - 2;
        const isLarge = c.wordCount > 100;
        const displayText = (isRecent || !isLarge || !c.summary) ? c.text : c.summary;
        const age = formatRelativeTime(c.timestamp, now);
        parts.push(`[${age}]: ${displayText}`);
      }
    }

    // Known entities
    if (data.entities.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.entities].sort((a, b) => b.lastMentioned - a.lastMentioned);
      parts.push('\n## Known Entities');
      for (const e of sorted) {
        const age = e.lastMentioned > 0 ? ` [${formatRelativeTime(e.lastMentioned, now)}]` : '';
        parts.push(`- ${e.name} (${e.type})${age}`);
      }
    }

    // Active topics
    if (data.topics.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.topics].sort((a, b) => b.lastMentioned - a.lastMentioned);
      parts.push('\n## Active Topics');
      for (const t of sorted) {
        const age = t.lastMentioned > 0 ? ` [${formatRelativeTime(t.lastMentioned, now)}]` : '';
        parts.push(`- ${t.name}${t.category ? ` [${t.category}]` : ''}${age}`);
      }
    }

    // Working memories
    if (data.memories.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.memories].sort((a, b) => b.lastReinforced - a.lastReinforced);
      parts.push('\n## Working Memory');
      for (const m of sorted) {
        const age = m.lastReinforced > 0 ? ` [${formatRelativeTime(m.lastReinforced, now)}]` : '';
        parts.push(`- [${m.shortId}] [${m.type}] ${m.content}${age}`);
      }
    }

    // Goals with short IDs
    if (data.goals.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.goals].sort((a, b) => b.lastReferenced - a.lastReferenced);
      parts.push('\n## Active Goals');
      for (const g of sorted) {
        const age = g.lastReferenced > 0 ? ` [${formatRelativeTime(g.lastReferenced, now)}]` : '';
        parts.push(`- [${g.shortId}] ${g.statement} (${g.status}, ${g.progress}%)${age}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Estimate token count for the data
   */
  estimateTokens(data: WorkingMemoryData): number {
    let charCount = 0;

    for (const c of data.conversations) {
      const isLarge = c.wordCount > 100;
      const text = (isLarge && c.summary) ? c.summary : c.text;
      charCount += c.speaker.length + 2 + text.length;
    }

    for (const e of data.entities) {
      charCount += e.name.length + e.type.length + 10;
    }

    for (const t of data.topics) {
      charCount += t.name.length + (t.category?.length ?? 0) + 10;
    }

    for (const m of data.memories) {
      charCount += m.content.length + m.type.length + 10;
    }

    for (const g of data.goals) {
      charCount += g.statement.length + g.shortId.length + g.status.length + 20;
    }

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
   */
  findGoalByShortId(data: WorkingMemoryData, shortId: string): GoalRef | undefined {
    return data.goals.find(g => g.shortId === shortId);
  }

  /**
   * Find a memory by its short ID (m1, m2, etc.)
   */
  findMemoryByShortId(data: WorkingMemoryData, shortId: string): MemoryRef | undefined {
    return data.memories.find(m => m.shortId === shortId);
  }

  /**
   * Extract available topics from working memory
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
