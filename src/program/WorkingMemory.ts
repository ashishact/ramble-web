/**
 * Working Memory - Unified LLM Context System
 *
 * PARADIGM: BATCH only ────────────────────────────────────────────────────────
 * Reads exclusively from WatermelonDB (committed conversations, entities,
 * topics, memories, goals). It only knows about COMPLETED, stored data.
 *
 * FOCUS CONTEXT: Both — but only reflects data that has already been committed.
 * In-app typed input and out-of-app completed utterances both end up in DB and
 * are therefore visible here.
 *
 * GAP — LIVE STREAMING DATA NOT INCLUDED:
 *   While a meeting is active, the live segments flowing through meetingStatus
 *   are NOT part of this context. WorkingMemory will not know what is being
 *   said in the current meeting until the meeting ends and its data is persisted.
 *   This means in meeting mode, Questions/Suggestions use the live transcript
 *   directly (not WorkingMemory) — but the core processor's extraction context
 *   never includes in-progress meeting content.
 *   Future: add a `liveSegments?: MeetingSegment[]` option that appends the
 *   current meeting transcript to the LLM context block.
 * ─────────────────────────────────────────────────────────────────────────────
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
  dataStore,
} from '../db/stores';
import type Conversation from '../db/models/Conversation';
import type Entity from '../db/models/Entity';
import type Topic from '../db/models/Topic';
import type Memory from '../db/models/Memory';
import type Goal from '../db/models/Goal';
import type { RetrievedContext } from './kernel/contextRetrieval';

// ============================================================================
// Types
// ============================================================================

export type ContextSize = 'small' | 'medium' | 'large';

export interface WorkingMemoryOptions {
  size?: ContextSize;        // Default: 'medium'
  asOfTime?: number;         // Unix timestamp for time travel (default: now)
  // Note: sessionId removed - we fetch all conversations chronologically
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
  shortId: string;      // 'm1', 'm2', etc. — used by LLM to reference this memory in contradicts field
  content: string;
  type: string;
  importance: number;
  confidence: number;
  lastReinforced: number;
  reinforcementCount: number;
  subject?: string;     // Who/what this memory is about
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

function toMemoryRef(m: Memory, index: number): MemoryRef {
  return {
    id: m.id,
    shortId: `m${index + 1}`,
    content: m.content,
    type: m.type,
    importance: m.importance,
    confidence: m.confidence,
    lastReinforced: m.lastReinforced,
    reinforcementCount: m.reinforcementCount,
    subject: m.subject || undefined,
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
// Memory Deduplication
// ============================================================================
//
// OPTIMIZATION: Skip memories already represented in conversation context
//
// Problem: When a user says something, we create both:
//   1. A conversation record (raw speech)
//   2. A memory record (distilled fact)
//
// If both are sent to the LLM, we're wasting tokens on redundant information.
// The conversation already contains the fact, so the memory is redundant.
//
// Solution: Filter out memories whose sourceConversationIds overlap with
// the conversations already in context. These memories are "covered" by
// the raw conversation text.
//
// Note: Memories from OTHER sessions (not in current context) are still
// included - they provide cross-session continuity.
// ============================================================================

/**
 * Filter out memories that are already covered by conversations in context.
 * A memory is "covered" if ANY of its sourceConversationIds appears in the
 * conversation context - meaning the LLM will see the original text anyway.
 */
function filterRedundantMemories(
  memories: Memory[],
  conversationIds: Set<string>
): Memory[] {
  if (conversationIds.size === 0) {
    // No conversations in context, keep all memories
    return memories;
  }

  return memories.filter(memory => {
    const sourceIds = memory.sourceConversationIdsParsed;

    // Keep memory if NONE of its sources are in the conversation context
    // (i.e., it comes from conversations we're NOT already sending)
    const isCoveredByContext = sourceIds.some(id => conversationIds.has(id));

    return !isCoveredByContext;
  });
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
    const limits = SIZE_LIMITS[size];

    // Query all data in parallel (fetch more than needed for time filtering)
    // Conversations: get recent across ALL sessions, chronologically
    const [allConvs, allEntities, allTopics, allMemories, allGoals, userProfile] = await Promise.all([
      conversationStore.getRecent(50),  // Returns newest first (DESC)
      entityStore.getRecent(50),
      topicStore.getRecent(50),
      memoryStore.getByRetrievalScore(50),
      goalStore.getActive(),
      dataStore.getUserProfile(),
    ]);

    // Build user context
    const userContext: UserContext = {
      currentTime: new Date().toString(),
    };
    if (userProfile?.name) {
      // Trim and limit name for safety (max 50 chars)
      const safeName = userProfile.name.trim().slice(0, 50);
      if (safeName) {
        userContext.userName = safeName;
      }
    }

    // Apply time filter, take most recent N, then reverse for chronological order
    // getRecent returns DESC (newest first), we want ASC (oldest first) for context
    const filteredConvs = allConvs
      .filter(c => c.timestamp <= asOfTime)
      .slice(0, limits.conversations)  // Take N most recent
      .reverse();                       // Reverse to chronological order

    const conversations = filteredConvs.map(toConversationRef);

    // Build set of conversation IDs in context (for memory deduplication)
    const conversationIdsInContext = new Set(filteredConvs.map(c => c.id));

    const entities = allEntities
      .filter(e => e.lastMentioned <= asOfTime)
      .slice(0, limits.entities)
      .map(toEntityRef);

    const topics = allTopics
      .filter(t => t.lastMentioned <= asOfTime)
      .slice(0, limits.topics)
      .map(toTopicRef);

    // Apply time filter, then deduplicate, then limit
    const timeFilteredMemories = allMemories.filter(m => m.lastReinforced <= asOfTime);
    const deduplicatedMemories = filterRedundantMemories(timeFilteredMemories, conversationIdsInContext);
    const memories = deduplicatedMemories
      .slice(0, limits.memories)
      .map((m, i) => toMemoryRef(m, i));

    // Goals: limit to budget, short IDs assigned based on position
    const filteredGoals = allGoals
      .filter(g => g.lastReferenced <= asOfTime)
      .slice(0, limits.goals);

    const goals = filteredGoals.map((g, i) => toGoalRef(g, i));

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
        estimatedTokens: 0, // Will be calculated below
      },
    };

    data.meta.estimatedTokens = this.estimateTokens(data);

    return data;
  }

  /**
   * Fetch working memory with context-aware memory retrieval.
   *
   * KEY DIFFERENCE from fetch(): Memories are selected based on relevance
   * to the CURRENT conversation context (entity/topic overlap), not just
   * global importance/recency scores. This means switching topics immediately
   * switches which memories the LLM sees.
   *
   * DIVERSITY GUARANTEE: Memory slots are allocated with minimum reservations
   * so no single category can dominate the entire list:
   *
   *   Context-relevant (~60%): entity/topic overlap with current conversation
   *   Recency (~20%):          most recently reinforced, regardless of topic
   *   Serendipity (~20%):      highest global importance/activity, any topic
   *
   * For medium (10 slots): 6 context + 2 recency + 2 serendipity
   * For small (5 slots):   3 context + 1 recency + 1 serendipity
   *
   * If any bucket can't fill its minimum (not enough candidates), overflow
   * slots redistribute to context-relevant first, then base memories.
   */
  async fetchWithHints(
    options: WorkingMemoryOptions,
    retrieved: RetrievedContext
  ): Promise<WorkingMemoryData> {
    const data = await this.fetch(options);
    const limits = SIZE_LIMITS[options.size ?? 'medium'];
    const asOfTime = options.asOfTime ?? Date.now();

    // ── Merge matched entities (deduplicate by ID) ────────────────────
    const existingEntityIds = new Set(data.entities.map(e => e.id));
    for (const match of retrieved.matchedEntities) {
      if (!existingEntityIds.has(match.id)) {
        data.entities.push({
          id: match.id,
          name: match.name,
          type: match.type,
          mentionCount: 0,
          lastMentioned: 0,
        });
        existingEntityIds.add(match.id);
      }
    }

    // ── Merge matched topics (deduplicate by ID) ──────────────────────
    const existingTopicIds = new Set(data.topics.map(t => t.id));
    for (const match of retrieved.matchedTopics) {
      if (!existingTopicIds.has(match.id)) {
        data.topics.push({
          id: match.id,
          name: match.name,
          category: match.category,
          mentionCount: 0,
          lastMentioned: 0,
        });
        existingTopicIds.add(match.id);
      }
    }

    // ── Budget allocation with minimum guarantees ─────────────────────
    const total = limits.memories;
    const minRecency = Math.min(3, Math.max(1, Math.floor(total * 0.2)));
    const minSerendipity = Math.min(3, Math.max(1, Math.floor(total * 0.2)));
    const contextBudget = total - minRecency - minSerendipity;

    // Collect ALL entity/topic IDs from the merged context
    const contextEntityIds = [...existingEntityIds];
    const contextTopicIds = [...existingTopicIds];

    // Fetch memories scored by entity/topic overlap with current context
    const contextMemories = await memoryStore.getByContextRelevance(
      contextEntityIds, contextTopicIds, contextBudget * 3
    );

    // Build conversation ID set for memory deduplication
    const conversationIdsInContext = new Set(data.conversations.map(c => c.id));

    // Helper: check if a raw Memory should be excluded
    const shouldExclude = (m: { lastReinforced: number; sourceConversationIdsParsed: string[] }) =>
      m.lastReinforced > asOfTime ||
      m.sourceConversationIdsParsed.some(id => conversationIdsInContext.has(id));

    const usedIds = new Set<string>();
    const newMemories: MemoryRef[] = [];

    // ── Bucket 1: Context-relevant (entity/topic overlap) ─────────
    for (const { memory } of contextMemories) {
      if (newMemories.length >= contextBudget) break;
      if (usedIds.has(memory.id)) continue;
      if (shouldExclude(memory)) continue;
      usedIds.add(memory.id);
      newMemories.push(toMemoryRef(memory, newMemories.length));
    }
    // Also include hint-text-matched memories (catches ones without ID links)
    for (const match of retrieved.relatedMemories) {
      if (newMemories.length >= contextBudget) break;
      if (usedIds.has(match.id)) continue;
      usedIds.add(match.id);
      newMemories.push({
        id: match.id,
        shortId: `m${newMemories.length + 1}`,
        content: match.content,
        type: match.type,
        importance: 0,
        confidence: 0,
        lastReinforced: 0,
        reinforcementCount: 0,
      });
    }

    // ── Bucket 2: Recency (most recently reinforced, any topic) ───
    // Guarantees freshness — even if talking about health, you still see
    // the most recent memory from yesterday's work conversation.
    const recencyCandidates = [...data.memories]
      .sort((a, b) => b.lastReinforced - a.lastReinforced);
    let recencyAdded = 0;
    for (const m of recencyCandidates) {
      if (recencyAdded >= minRecency) break;
      if (usedIds.has(m.id)) continue;
      usedIds.add(m.id);
      newMemories.push({ ...m, shortId: `m${newMemories.length + 1}` });
      recencyAdded++;
    }

    // ── Bucket 3: Serendipity (highest global score, any topic) ───
    // Guarantees cross-topic continuity — globally important memories
    // surface regardless of current conversation topic.
    // data.memories is sorted by retrieval score (activity + importance + confidence + recency)
    let serendipityAdded = 0;
    for (const m of data.memories) {
      if (serendipityAdded >= minSerendipity) break;
      if (usedIds.has(m.id)) continue;
      usedIds.add(m.id);
      newMemories.push({ ...m, shortId: `m${newMemories.length + 1}` });
      serendipityAdded++;
    }

    // ── Overflow: redistribute unused slots ───────────────────────
    // If any bucket couldn't fill its minimum, give overflow to context first
    if (newMemories.length < total) {
      for (const { memory } of contextMemories) {
        if (newMemories.length >= total) break;
        if (usedIds.has(memory.id)) continue;
        if (shouldExclude(memory)) continue;
        usedIds.add(memory.id);
        newMemories.push(toMemoryRef(memory, newMemories.length));
      }
    }
    // Then fill from base memories
    if (newMemories.length < total) {
      for (const m of data.memories) {
        if (newMemories.length >= total) break;
        if (usedIds.has(m.id)) continue;
        usedIds.add(m.id);
        newMemories.push({ ...m, shortId: `m${newMemories.length + 1}` });
      }
    }

    data.memories = newMemories;

    // ── Goal budget allocation with minimum guarantees ─────────────────
    const goalTotal = limits.goals;
    const goalMinRecency = Math.min(2, Math.max(1, Math.floor(goalTotal * 0.3)));
    const goalContextBudget = goalTotal - goalMinRecency;

    // Bucket 1: Context-relevant goals (entity/topic overlap)
    const contextGoals = await goalStore.getByContextRelevance(
      contextEntityIds, contextTopicIds, goalContextBudget * 3
    );

    const usedGoalIds = new Set<string>();
    const newGoals: GoalRef[] = [];

    // Fill context bucket
    for (const { goal } of contextGoals) {
      if (newGoals.length >= goalContextBudget) break;
      if (usedGoalIds.has(goal.id)) continue;
      if (goal.lastReferenced > asOfTime) continue;
      usedGoalIds.add(goal.id);
      newGoals.push(toGoalRef(goal, newGoals.length));
    }

    // Bucket 2: Recency (most recently referenced, any topic)
    const baseGoals = data.goals;
    let goalRecencyAdded = 0;
    for (const g of baseGoals) {
      if (goalRecencyAdded >= goalMinRecency) break;
      if (usedGoalIds.has(g.id)) continue;
      usedGoalIds.add(g.id);
      newGoals.push({ ...g, shortId: `g${newGoals.length + 1}` });
      goalRecencyAdded++;
    }

    // Overflow: fill remaining from context, then base
    if (newGoals.length < goalTotal) {
      for (const { goal } of contextGoals) {
        if (newGoals.length >= goalTotal) break;
        if (usedGoalIds.has(goal.id)) continue;
        if (goal.lastReferenced > asOfTime) continue;
        usedGoalIds.add(goal.id);
        newGoals.push(toGoalRef(goal, newGoals.length));
      }
    }
    if (newGoals.length < goalTotal) {
      for (const g of baseGoals) {
        if (newGoals.length >= goalTotal) break;
        if (usedGoalIds.has(g.id)) continue;
        usedGoalIds.add(g.id);
        newGoals.push({ ...g, shortId: `g${newGoals.length + 1}` });
      }
    }

    data.goals = newGoals;

    data.meta.estimatedTokens = this.estimateTokens(data);

    return data;
  }

  /**
   * Format working memory as LLM prompt string
   * Note: currentTime is NOT included here (for cache optimization)
   * Caller should add currentTime to the user prompt using data.userContext.currentTime
   */
  formatForLLM(data: WorkingMemoryData): string {
    const parts: string[] = [];

    // User info (static - cacheable)
    if (data.userContext.userName) {
      parts.push(`User: ${data.userContext.userName}`);
    }

    // Recent conversations — chronological with relative time
    if (data.conversations.length > 0) {
      const now = data.meta.asOfTime;
      parts.push('## Recent Conversation');
      for (let i = 0; i < data.conversations.length; i++) {
        const c = data.conversations[i];
        const isRecent = i >= data.conversations.length - 2; // Last 2
        const isLarge = c.wordCount > 100;

        // Use summary for older large conversations, full text otherwise
        const displayText = (isRecent || !isLarge || !c.summary) ? c.text : c.summary;
        const age = formatRelativeTime(c.timestamp, now);
        parts.push(`[${age}]: ${displayText}`);
      }
    }

    // Known entities — sorted by most recently mentioned
    if (data.entities.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.entities].sort((a, b) => b.lastMentioned - a.lastMentioned);
      parts.push('\n## Known Entities');
      for (const e of sorted) {
        const age = e.lastMentioned > 0 ? ` [${formatRelativeTime(e.lastMentioned, now)}]` : '';
        parts.push(`- ${e.name} (${e.type})${age}`);
      }
    }

    // Active topics — sorted by most recently mentioned
    if (data.topics.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.topics].sort((a, b) => b.lastMentioned - a.lastMentioned);
      parts.push('\n## Active Topics');
      for (const t of sorted) {
        const age = t.lastMentioned > 0 ? ` [${formatRelativeTime(t.lastMentioned, now)}]` : '';
        parts.push(`- ${t.name}${t.category ? ` [${t.category}]` : ''}${age}`);
      }
    }

    // Working memories — sorted by most recently reinforced
    // shortId allows LLM to reference specific memories
    // (e.g. in contradicts field when a new belief conflicts with m3)
    if (data.memories.length > 0) {
      const now = data.meta.asOfTime;
      const sorted = [...data.memories].sort((a, b) => b.lastReinforced - a.lastReinforced);
      parts.push('\n## Working Memory');
      for (const m of sorted) {
        const age = m.lastReinforced > 0 ? ` [${formatRelativeTime(m.lastReinforced, now)}]` : '';
        parts.push(`- [${m.shortId}] [${m.type}] ${m.content}${age}`);
      }
    }

    // Goals with short IDs — sorted by most recently referenced
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
   * Find a memory by its short ID (m1, m2, etc.)
   * Used in saveExtraction to resolve contradiction references from the LLM.
   */
  findMemoryByShortId(data: WorkingMemoryData, shortId: string): MemoryRef | undefined {
    return data.memories.find(m => m.shortId === shortId);
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
