/**
 * Context Builder
 *
 * @deprecated Use WorkingMemory class from '../WorkingMemory' instead.
 * This module is kept for backward compatibility but will be removed in a future version.
 *
 * The new WorkingMemory class provides:
 * - Size tiers (small/medium/large) for controlling token budget
 * - Time travel support (query context as of a specific timestamp)
 * - Short IDs for goals (g1, g2...) for easy LLM reference
 * - Unified interface for both UI and LLM processing
 *
 * Migration:
 *   Before: const context = await buildContext(sessionId, inputText);
 *           const prompt = formatContextForLLM(context);
 *
 *   After:  const data = await workingMemory.fetch({ size: 'medium' });
 *           const prompt = workingMemory.formatForLLM(data);
 *
 * Gathers relevant context for the LLM:
 * - Recent conversation history
 * - Relevant entities (mentioned or related)
 * - Relevant topics
 * - Active memories
 * - Active goals
 */

import {
  conversationStore,
  entityStore,
  topicStore,
  memoryStore,
  goalStore,
} from '../../db/stores';

export interface Context {
  // Recent conversation
  recentConversations: Array<{
    speaker: string;
    text: string;
    timestamp: number;
  }>;

  // Relevant entities
  entities: Array<{
    id: string;
    name: string;
    type: string;
    mentionCount: number;
    lastMentioned: number;
  }>;

  // Relevant topics
  topics: Array<{
    id: string;
    name: string;
    category?: string;
    mentionCount: number;
    lastMentioned: number;
  }>;

  // Active memories
  memories: Array<{
    id: string;
    content: string;
    type: string;
    importance: number;
    lastReinforced: number;
  }>;

  // Active goals
  goals: Array<{
    id: string;
    statement: string;
    type: string;
    status: string;
    progress: number;
  }>;
}

/**
 * Build context for LLM processing
 */
export async function buildContext(
  sessionId: string,
  _inputText: string,
  options?: {
    maxConversations?: number;
    maxEntities?: number;
    maxTopics?: number;
    maxMemories?: number;
    maxGoals?: number;
  }
): Promise<Context> {
  const {
    maxConversations = 10,
    maxEntities = 10,
    maxTopics = 5,
    maxMemories = 15,
    maxGoals = 5,
  } = options ?? {};

  // Get recent conversations from this session
  const conversations = await conversationStore.getBySession(sessionId);
  const recentConvs = conversations.slice(-maxConversations);

  // Get recently mentioned entities
  const recentEntities = await entityStore.getRecent(maxEntities);

  // Get recently mentioned topics
  const recentTopics = await topicStore.getRecent(maxTopics);

  // Get active memories (most important)
  const activeMemories = await memoryStore.getMostImportant(maxMemories);

  // Get active goals
  const activeGoals = await goalStore.getActive();

  return {
    recentConversations: recentConvs.map((c) => ({
      speaker: c.speaker,
      text: c.sanitizedText,
      timestamp: c.timestamp,
    })),
    entities: recentEntities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      mentionCount: e.mentionCount,
      lastMentioned: e.lastMentioned,
    })),
    topics: recentTopics.slice(0, maxTopics).map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      mentionCount: t.mentionCount,
      lastMentioned: t.lastMentioned,
    })),
    memories: activeMemories.map((m) => ({
      id: m.id,
      content: m.content,
      type: m.type,
      importance: m.importance,
      lastReinforced: m.lastReinforced,
    })),
    goals: activeGoals.slice(0, maxGoals).map((g) => ({
      id: g.id,
      statement: g.statement,
      type: g.type,
      status: g.status,
      progress: g.progress,
    })),
  };
}

/**
 * Format context as a prompt section for the LLM
 */
export function formatContextForLLM(context: Context): string {
  const parts: string[] = [];

  // Recent conversation
  if (context.recentConversations.length > 0) {
    parts.push('## Recent Conversation');
    for (const c of context.recentConversations) {
      parts.push(`${c.speaker}: ${c.text}`);
    }
  }

  // Known entities
  if (context.entities.length > 0) {
    parts.push('\n## Known Entities');
    for (const e of context.entities) {
      parts.push(`- ${e.name} (${e.type})`);
    }
  }

  // Active topics
  if (context.topics.length > 0) {
    parts.push('\n## Active Topics');
    for (const t of context.topics) {
      parts.push(`- ${t.name}${t.category ? ` [${t.category}]` : ''}`);
    }
  }

  // Working memory
  if (context.memories.length > 0) {
    parts.push('\n## Working Memory');
    for (const m of context.memories) {
      parts.push(`- [${m.type}] ${m.content}`);
    }
  }

  // Active goals
  if (context.goals.length > 0) {
    parts.push('\n## Active Goals');
    for (const g of context.goals) {
      parts.push(`- ${g.statement} (${g.status}, ${g.progress}%)`);
    }
  }

  return parts.join('\n');
}
