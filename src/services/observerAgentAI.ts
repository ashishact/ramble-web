/**
 * Observer Agent Service using AI SDK v5 (System II - Critical Thinker)
 *
 * Processes conversation transcripts asynchronously and creates/organizes
 * knowledge nodes in the graph. Uses AI SDK v5 for provider abstraction.
 */

import { streamText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGroq } from '@ai-sdk/groq';
import { z } from 'zod/v4';

import { settingsHelpers, type AppSettings } from '../stores/settingsStore';
import { conversationHelpers, type ConversationMessage } from '../stores/conversationStore';
import { knowledgeHelpers } from '../stores/knowledgeStore';

// Types
interface QueuedMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

export interface TaskStatus {
  status: 'idle' | 'processing' | 'completed' | 'failed';
  description: string;
  startedAt?: Date;
  completedAt?: Date;
}

export interface ObserverMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  toolName?: string;
  toolResult?: unknown;
}

// Listeners for observer conversation
type ObserverMessageListener = (messages: ObserverMessage[]) => void;
const observerMessageListeners = new Set<ObserverMessageListener>();
let observerMessages: ObserverMessage[] = [];

const notifyObserverMessageListeners = () => {
  observerMessageListeners.forEach(listener => listener([...observerMessages]));
};

const addObserverMessage = (message: Omit<ObserverMessage, 'timestamp'>) => {
  observerMessages.push({ ...message, timestamp: new Date() });
  // Keep last 100 messages
  if (observerMessages.length > 100) {
    observerMessages = observerMessages.slice(-100);
  }
  notifyObserverMessageListeners();
};

// Tool definitions for AI SDK v5
const observerTools = {
  create_node: {
    description: 'Creates a new knowledge node in the graph.',
    inputSchema: z.object({
      title: z.string().describe('Brief title summarizing the node content (2-6 words)'),
      content: z.string().describe('Full content of the knowledge node'),
      tags: z.array(z.string()).optional().describe('Relevant tags/categories'),
      icon: z.string().optional().describe('Optional emoji icon representing this node'),
    }),
    execute: async ({ title, content, tags, icon }: { title: string; content: string; tags?: string[]; icon?: string }) => {
      const node = knowledgeHelpers.createNode({
        title,
        content,
        tags: tags ?? [],
        icon,
        createdBy: 'observer',
      });
      const result = { success: true, data: { id: node.id, title: node.title }, message: `Created node "${node.title}" (ID: ${node.id})` };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'create_node', toolResult: result });
      return result;
    },
  },

  update_node: {
    description: 'Updates an existing knowledge node.',
    inputSchema: z.object({
      nodeId: z.number().describe('ID of the node to update'),
      title: z.string().optional().describe('New title for the node'),
      content: z.string().optional().describe('New content for the node'),
      tags: z.array(z.string()).optional().describe('New tags array'),
      icon: z.string().optional().describe('New icon'),
    }),
    execute: async ({ nodeId, title, content, tags, icon }: { nodeId: number; title?: string; content?: string; tags?: string[]; icon?: string }) => {
      const updates: Record<string, unknown> = {};
      if (title !== undefined) updates.title = title;
      if (content !== undefined) updates.content = content;
      if (tags !== undefined) updates.tags = tags;
      if (icon !== undefined) updates.icon = icon;

      knowledgeHelpers.updateNode(nodeId, updates);
      const result = { success: true, message: `Updated node ${nodeId}` };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'update_node', toolResult: result });
      return result;
    },
  },

  delete_node: {
    description: 'Deletes a knowledge node from the graph.',
    inputSchema: z.object({
      nodeId: z.number().describe('ID of the node to delete'),
    }),
    execute: async ({ nodeId }: { nodeId: number }) => {
      knowledgeHelpers.deleteNode(nodeId);
      const result = { success: true, message: `Deleted node ${nodeId}` };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'delete_node', toolResult: result });
      return result;
    },
  },

  create_relationship: {
    description: 'Creates a relationship (edge) between two nodes.',
    inputSchema: z.object({
      sourceNodeId: z.number().describe('ID of the source node'),
      targetNodeId: z.number().describe('ID of the target node'),
      description: z.string().describe('Description of the relationship'),
    }),
    execute: async ({ sourceNodeId, targetNodeId, description }: { sourceNodeId: number; targetNodeId: number; description: string }) => {
      const rel = knowledgeHelpers.createRelationship({
        sourceNodeId,
        targetNodeId,
        description,
        createdBy: 'observer',
      });
      const result = { success: true, data: { id: rel.id }, message: `Created relationship ${sourceNodeId} -> ${targetNodeId}: "${description}"` };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'create_relationship', toolResult: result });
      return result;
    },
  },

  search_nodes: {
    description: 'Searches for nodes by content using keyword matching. Max 5 results.',
    inputSchema: z.object({
      query: z.string().describe('Search query to match against node content'),
      limit: z.number().optional().describe('Maximum number of results (default: 5)'),
    }),
    execute: async ({ query, limit }: { query: string; limit?: number }) => {
      const results = knowledgeHelpers.searchNodes(query, Math.min(limit ?? 5, 5));
      const result = { success: true, data: results.map(n => ({ id: n.id, title: n.title, content: n.content.slice(0, 200) })) };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'search_nodes', toolResult: result });
      return result;
    },
  },

  semantic_search_nodes: {
    description: 'Searches for nodes using semantic similarity. Max 5 results.',
    inputSchema: z.object({
      query: z.string().describe('Natural language search query'),
      limit: z.number().optional().describe('Maximum number of results (default: 5)'),
    }),
    execute: async ({ query, limit }: { query: string; limit?: number }) => {
      const results = knowledgeHelpers.semanticSearch(query, Math.min(limit ?? 5, 5));
      const result = {
        success: true,
        data: results.map(n => ({ id: n.id, title: n.title, content: n.content.slice(0, 200), similarity: n.similarity })),
      };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'semantic_search_nodes', toolResult: result });
      return result;
    },
  },

  set_current_node: {
    description: 'Sets a specific node as the current active node.',
    inputSchema: z.object({
      nodeId: z.number().describe('ID of the node to set as current'),
    }),
    execute: async ({ nodeId }: { nodeId: number }) => {
      settingsHelpers.setCurrentNodeId(nodeId);
      const node = knowledgeHelpers.getNode(nodeId);
      const result = { success: true, data: node ? { id: node.id, title: node.title } : null, message: node ? `Set current node to "${node.title}"` : 'Node not found' };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'set_current_node', toolResult: result });
      return result;
    },
  },

  get_node_relationships: {
    description: 'Retrieves all relationships for a specific node.',
    inputSchema: z.object({
      nodeId: z.number().describe('ID of the node to get relationships for'),
    }),
    execute: async ({ nodeId }: { nodeId: number }) => {
      const relationships = knowledgeHelpers.getNodeRelationships(nodeId);
      const result = {
        success: true,
        data: relationships.map(r => ({ id: r.id, sourceNodeId: r.sourceNodeId, targetNodeId: r.targetNodeId, description: r.description })),
      };
      addObserverMessage({ role: 'tool', content: JSON.stringify(result), toolName: 'get_node_relationships', toolResult: result });
      return result;
    },
  },
};

// System prompt
const SYSTEM_PROMPT = `You are the Intelligence Layer (System 2) for a personal knowledge graph assistant.
You process conversation transcripts and organize information into a structured knowledge graph.

ROLE: Backend Intelligence Agent
- You operate behind the scenes, processing conversation transcripts
- You DON'T interact directly with the user
- Your job is deep thinking: analyze, categorize, connect, and persist information
- You work asynchronously while the voice agent (System 1) handles real-time conversation

YOUR RESPONSIBILITIES:

1. PROCESS CONVERSATION TRANSCRIPTS:
   - You receive messages in format: [user:[text]] or [ai:[text]]
   - User messages: What the user said (via voice or text)
   - AI messages: What the voice agent responded
   - Analyze BOTH to extract knowledge, intentions, and connections

2. EXTRACT & ORGANIZE KNOWLEDGE:
   - Identify key concepts, ideas, and information worth storing
   - Create/update knowledge nodes for important information
   - Detect relationships between concepts
   - Tag and categorize information appropriately
   - Add semantic metadata (icons, tags, descriptions)

3. MAINTAIN KNOWLEDGE GRAPH INTEGRITY:
   - ALWAYS search before creating (use both search_nodes AND semantic_search_nodes)
   - Avoid duplicate nodes on the same topic
   - Merge information into existing nodes when appropriate
   - Create relationships to connect related concepts
   - Keep content concise but comprehensive

4. HANDLE AMBIGUITY:
   - Transcripts may be imperfect (speech-to-text errors)
   - Infer meaning from context
   - Handle conversational fragments gracefully
   - Focus on substance over exact wording

DECISION FRAMEWORK:

CREATE NEW NODE when:
- User introduces a completely new topic/concept
- Information doesn't fit existing nodes
- Distinct idea that deserves separate storage

UPDATE EXISTING NODE when:
- User adds details to a known topic
- Clarifies or expands on previous discussion
- Corrects or refines existing information

CREATE RELATIONSHIP when:
- Connection between two concepts becomes clear
- User mentions how ideas relate
- You infer logical/semantic connections

DO NOTHING when:
- Conversation is purely social/greeting
- No actionable knowledge to extract
- Information is too vague or unclear`;

// Get the appropriate model based on provider settings
const getModel = (provider: AppSettings['observerProvider']) => {
  const settings = settingsHelpers.getSettings();

  switch (provider) {
    case 'gemini': {
      const google = createGoogleGenerativeAI({
        apiKey: settings.providers.gemini.apiKey,
      });
      return google(settings.providers.gemini.model);
    }
    case 'openai': {
      const openai = createOpenAI({
        apiKey: settings.providers.openai.apiKey,
      });
      return openai(settings.providers.openai.model);
    }
    case 'groq': {
      const groq = createGroq({
        apiKey: settings.providers.groq.apiKey,
      });
      return groq(settings.providers.groq.model);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({
        apiKey: settings.providers.anthropic.apiKey,
      });
      return anthropic(settings.providers.anthropic.model);
    }
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
};

class ObserverAgentAIService {
  private messageQueue: QueuedMessage[] = [];
  private queuedMessageIds = new Set<string>(); // Track queued message IDs to prevent duplicates
  private isProcessing = false;
  private currentTask: TaskStatus = { status: 'idle', description: 'Ready' };
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_DELAY_MS = 500;
  private onStatusChange?: (status: TaskStatus) => void;
  private hasConfigError = false; // Track if there's a configuration error to stop polling

  constructor() {
    this.startPolling();
  }

  setStatusCallback(callback: (status: TaskStatus) => void) {
    this.onStatusChange = callback;
  }

  getStatus(): TaskStatus {
    return this.currentTask;
  }

  // Subscribe to observer messages for UI display
  subscribeToMessages(listener: ObserverMessageListener): () => void {
    observerMessageListeners.add(listener);
    listener([...observerMessages]); // Send current messages immediately
    return () => observerMessageListeners.delete(listener);
  }

  getMessages(): ObserverMessage[] {
    return [...observerMessages];
  }

  clearMessages() {
    observerMessages = [];
    notifyObserverMessageListeners();
  }

  // Enqueue a transcript for processing
  enqueueTranscript(message: ConversationMessage) {
    if (!message.content?.trim() || message.processedByObserver) {
      return;
    }

    // Prevent duplicate messages from being queued
    if (this.queuedMessageIds.has(message.id)) {
      return;
    }

    this.queuedMessageIds.add(message.id);
    this.messageQueue.push({
      id: message.id,
      role: message.role,
      content: message.content.trim(),
      timestamp: new Date(message.timestamp),
    });

    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    this.batchTimeout = setTimeout(() => {
      this.processQueue();
    }, this.BATCH_DELAY_MS);
  }

  private startPolling() {
    console.log('[ObserverAgentAI] Starting polling for unprocessed messages');
    setInterval(() => {
      // Don't poll if there's a configuration error
      if (this.hasConfigError) {
        return;
      }

      const messages = conversationHelpers.getAllMessages();
      const unprocessed = messages.filter(m => !m.processedByObserver && m.isComplete);

      if (unprocessed.length > 0) {
        console.log(`[ObserverAgentAI] Found ${unprocessed.length} unprocessed messages`);
      }

      unprocessed.forEach(m => this.enqueueTranscript(m));
    }, 2000);
  }

  private async processQueue() {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return;
    }

    const settings = settingsHelpers.getSettings();
    const provider = settings.observerProvider;
    const apiKey = settings.providers[provider].apiKey;

    if (!apiKey) {
      console.warn(`[ObserverAgentAI] No API key configured for ${provider}`);
      return;
    }

    console.log(`[ObserverAgentAI] Processing queue with ${this.messageQueue.length} messages using ${provider}`);

    this.isProcessing = true;
    this.updateStatus({
      status: 'processing',
      description: `Processing with ${provider}`,
      startedAt: new Date(),
    });

    const messagesToProcess = [...this.messageQueue];
    this.messageQueue = [];

    try {

      // Format messages for the model
      const userContent = messagesToProcess
        .map(msg => `[${msg.role === 'user' ? 'user' : 'ai'}:[${msg.content}]]`)
        .join('\n');

      // Add to observer messages for UI
      addObserverMessage({ role: 'user', content: userContent });

      // Call AI with streaming
      const model = getModel(provider);
      let fullResponse = '';

      const result = streamText({
        model,
        system: SYSTEM_PROMPT,
        prompt: userContent,
        tools: observerTools,
      });

      // Stream the response
      for await (const chunk of result.textStream) {
        fullResponse += chunk;
      }

      // Add final assistant message if there was text
      if (fullResponse.trim()) {
        addObserverMessage({ role: 'assistant', content: fullResponse });
      }

      // Mark messages as processed
      messagesToProcess.forEach(msg => {
        conversationHelpers.markAsProcessed(msg.id);
      });

      this.updateStatus({
        status: 'completed',
        description: 'Completed processing',
        completedAt: new Date(),
      });

      setTimeout(() => {
        this.updateStatus({ status: 'idle', description: 'Ready' });
      }, 1000);
    } catch (error) {
      console.error('[ObserverAgentAI] Error processing queue:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      addObserverMessage({ role: 'assistant', content: `Error: ${errorMessage}` });

      // Check if it's a configuration/model error that won't resolve by retrying
      const isConfigError = errorMessage.includes('Unsupported model') ||
                           errorMessage.includes('not found') ||
                           errorMessage.includes('API key');

      if (isConfigError) {
        // Don't retry on config errors - mark messages as processed and stop polling
        this.hasConfigError = true;
        console.warn('[ObserverAgentAI] Configuration error detected. Stopping observer polling. Please check your provider settings.');
        messagesToProcess.forEach(msg => {
          conversationHelpers.markAsProcessed(msg.id);
        });
      } else {
        // Clear queued IDs for transient errors so they can be retried
        messagesToProcess.forEach(msg => {
          this.queuedMessageIds.delete(msg.id);
        });
      }

      this.updateStatus({
        status: 'failed',
        description: `Error: ${errorMessage}`,
        completedAt: new Date(),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private updateStatus(status: TaskStatus) {
    this.currentTask = status;
    this.onStatusChange?.(status);
  }
}

// Singleton instance
let observerAIInstance: ObserverAgentAIService | null = null;

export const getObserverAgentAI = (): ObserverAgentAIService => {
  if (!observerAIInstance) {
    observerAIInstance = new ObserverAgentAIService();
  }
  return observerAIInstance;
};

export const resetObserverAgentAI = (): void => {
  observerAIInstance = null;
};
