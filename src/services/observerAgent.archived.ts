/**
 * Observer Agent Service (System II - Critical Thinker)
 *
 * Processes conversation transcripts asynchronously and creates/organizes
 * knowledge nodes in the graph. Uses Gemini REST API with function calling.
 */

import { settingsHelpers } from '../stores/settingsStore';
import { conversationHelpers, type ConversationMessage } from '../stores/conversationStore';
import { knowledgeHelpers } from '../stores/knowledgeStore';

// Types
interface QueuedMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
}

interface TaskStatus {
  status: 'idle' | 'processing' | 'completed' | 'failed';
  description: string;
  startedAt?: Date;
  completedAt?: Date;
}

type ToolResult = {
  success: boolean;
  data?: unknown;
  message?: string;
  error?: string;
};

// Tool definitions for Gemini
const TOOLS = [
  {
    function_declarations: [
      {
        name: 'create_node',
        description: 'Creates a new knowledge node in the graph.',
        parameters: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING', description: 'Brief title summarizing the node content (2-6 words)' },
            content: { type: 'STRING', description: 'Full content of the knowledge node' },
            tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Relevant tags/categories' },
            icon: { type: 'STRING', description: 'Optional emoji icon representing this node' },
          },
          required: ['title', 'content'],
        },
      },
      {
        name: 'update_node',
        description: 'Updates an existing knowledge node.',
        parameters: {
          type: 'OBJECT',
          properties: {
            nodeId: { type: 'NUMBER', description: 'ID of the node to update' },
            title: { type: 'STRING', description: 'New title for the node' },
            content: { type: 'STRING', description: 'New content for the node' },
            tags: { type: 'ARRAY', items: { type: 'STRING' }, description: 'New tags array' },
            icon: { type: 'STRING', description: 'New icon' },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'delete_node',
        description: 'Deletes a knowledge node from the graph.',
        parameters: {
          type: 'OBJECT',
          properties: {
            nodeId: { type: 'NUMBER', description: 'ID of the node to delete' },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'create_relationship',
        description: 'Creates a relationship (edge) between two nodes.',
        parameters: {
          type: 'OBJECT',
          properties: {
            sourceNodeId: { type: 'NUMBER', description: 'ID of the source node' },
            targetNodeId: { type: 'NUMBER', description: 'ID of the target node' },
            description: { type: 'STRING', description: 'Description of the relationship' },
          },
          required: ['sourceNodeId', 'targetNodeId', 'description'],
        },
      },
      {
        name: 'search_nodes',
        description: 'Searches for nodes by content using keyword matching. Max 5 results.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Search query to match against node content' },
            limit: { type: 'NUMBER', description: 'Maximum number of results (default: 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'semantic_search_nodes',
        description: 'Searches for nodes using semantic similarity. Max 5 results.',
        parameters: {
          type: 'OBJECT',
          properties: {
            query: { type: 'STRING', description: 'Natural language search query' },
            limit: { type: 'NUMBER', description: 'Maximum number of results (default: 5)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'set_current_node',
        description: 'Sets a specific node as the current active node.',
        parameters: {
          type: 'OBJECT',
          properties: {
            nodeId: { type: 'NUMBER', description: 'ID of the node to set as current' },
          },
          required: ['nodeId'],
        },
      },
      {
        name: 'get_node_relationships',
        description: 'Retrieves all relationships for a specific node.',
        parameters: {
          type: 'OBJECT',
          properties: {
            nodeId: { type: 'NUMBER', description: 'ID of the node to get relationships for' },
          },
          required: ['nodeId'],
        },
      },
    ],
  },
];

// System prompt for the observer agent
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

5. TOOL CALLING STRATEGY:
   - You have access to ALL knowledge graph tools
   - Call tools thoughtfully and deliberately
   - Batch related operations when possible
   - Prioritize data persistence over speed (accuracy matters)

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

class ObserverAgentService {
  private messageQueue: QueuedMessage[] = [];
  private isProcessing = false;
  private currentTask: TaskStatus = { status: 'idle', description: 'Ready' };
  private batchTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly BATCH_DELAY_MS = 500;
  private readonly MAX_HISTORY_TURNS = 16;
  private conversationHistory: Array<{ role: string; parts: Array<{ text?: string; functionCall?: unknown; functionResponse?: unknown }> }> = [];
  private onStatusChange?: (status: TaskStatus) => void;

  constructor() {
    // Start polling for unprocessed messages
    this.startPolling();
  }

  setStatusCallback(callback: (status: TaskStatus) => void) {
    this.onStatusChange = callback;
  }

  getStatus(): TaskStatus {
    return this.currentTask;
  }

  // Enqueue a transcript for processing
  enqueueTranscript(message: ConversationMessage) {
    if (!message.content?.trim() || message.processedByObserver) {
      return;
    }

    this.messageQueue.push({
      id: message.id,
      role: message.role,
      content: message.content.trim(),
      timestamp: new Date(message.timestamp),
    });

    // Reset batch timeout
    if (this.batchTimeout) {
      clearTimeout(this.batchTimeout);
    }

    // Start processing after batch delay
    this.batchTimeout = setTimeout(() => {
      this.processQueue();
    }, this.BATCH_DELAY_MS);
  }

  // Poll for unprocessed messages
  private startPolling() {
    console.log('[ObserverAgent] Starting polling for unprocessed messages');
    setInterval(() => {
      const messages = conversationHelpers.getAllMessages();
      const unprocessed = messages.filter(m => !m.processedByObserver && m.isComplete);

      if (unprocessed.length > 0) {
        console.log(`[ObserverAgent] Found ${unprocessed.length} unprocessed messages`);
      }

      unprocessed.forEach(m => this.enqueueTranscript(m));
    }, 2000); // Check every 2 seconds
  }

  // Process the message queue
  private async processQueue() {
    if (this.isProcessing || this.messageQueue.length === 0) {
      return;
    }

    const apiKey = settingsHelpers.getApiKey('gemini');
    if (!apiKey) {
      console.warn('[ObserverAgent] No API key configured');
      return;
    }

    console.log(`[ObserverAgent] Processing queue with ${this.messageQueue.length} messages`);

    this.isProcessing = true;
    this.updateStatus({
      status: 'processing',
      description: 'Processing conversation transcripts',
      startedAt: new Date(),
    });

    try {
      const messagesToProcess = [...this.messageQueue];
      this.messageQueue = [];

      // Format messages for the agent
      const formattedMessages = messagesToProcess.map(msg => ({
        role: 'user' as const,
        parts: [{ text: `[${msg.role === 'user' ? 'user' : 'ai'}:[${msg.content}]]` }],
      }));

      // Add to conversation history
      this.conversationHistory.push(...formattedMessages);

      // Trim history if needed
      if (this.conversationHistory.length > this.MAX_HISTORY_TURNS) {
        this.conversationHistory = this.conversationHistory.slice(-this.MAX_HISTORY_TURNS);
      }

      // Call Gemini API with tools
      await this.generateWithTools(apiKey);

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
      console.error('[ObserverAgent] Error processing queue:', error);
      this.updateStatus({
        status: 'failed',
        description: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        completedAt: new Date(),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  // Call Gemini API with tools
  private async generateWithTools(apiKey: string, maxIterations = 5): Promise<void> {
    const model = 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      const requestBody = {
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: this.conversationHistory,
        tools: TOOLS,
        generationConfig: {
          temperature: 1.0,
          topP: 0.95,
          maxOutputTokens: 8192,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Add AI response to history
      if (data.candidates?.[0]?.content) {
        this.conversationHistory.push({
          role: 'model',
          parts: data.candidates[0].content.parts,
        });
      }

      // Check for function calls
      const functionCalls = data.candidates?.[0]?.content?.parts?.filter(
        (part: { functionCall?: unknown }) => part.functionCall
      );

      if (!functionCalls || functionCalls.length === 0) {
        // No function calls, agent is done thinking
        console.log('[ObserverAgent] Processing complete');
        return;
      }

      // Execute function calls
      const functionResponses: Array<{ functionResponse: { name: string; response: ToolResult } }> = [];

      for (const part of functionCalls) {
        const { name, args } = part.functionCall as { name: string; args: Record<string, unknown> };
        console.log(`[ObserverAgent] Executing: ${name}`, args);

        const result = await this.executeTool(name, args);
        functionResponses.push({
          functionResponse: {
            name,
            response: result,
          },
        });
      }

      // Add function responses to history
      this.conversationHistory.push({
        role: 'user',
        parts: functionResponses,
      });
    }

    console.warn('[ObserverAgent] Max iterations reached');
  }

  // Execute a tool call
  private async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      switch (name) {
        case 'create_node': {
          const node = knowledgeHelpers.createNode({
            title: args.title as string,
            content: args.content as string,
            tags: (args.tags as string[]) ?? [],
            icon: args.icon as string | undefined,
            createdBy: 'observer',
          });
          return {
            success: true,
            data: { id: node.id, title: node.title },
            message: `Created node "${node.title}" (ID: ${node.id})`,
          };
        }

        case 'update_node': {
          const nodeId = args.nodeId as number;
          const updates: Record<string, unknown> = {};
          if (args.title !== undefined) updates.title = args.title;
          if (args.content !== undefined) updates.content = args.content;
          if (args.tags !== undefined) updates.tags = args.tags;
          if (args.icon !== undefined) updates.icon = args.icon;

          knowledgeHelpers.updateNode(nodeId, updates);
          return {
            success: true,
            message: `Updated node ${nodeId}`,
          };
        }

        case 'delete_node': {
          const nodeId = args.nodeId as number;
          knowledgeHelpers.deleteNode(nodeId);
          return {
            success: true,
            message: `Deleted node ${nodeId}`,
          };
        }

        case 'create_relationship': {
          const rel = knowledgeHelpers.createRelationship({
            sourceNodeId: args.sourceNodeId as number,
            targetNodeId: args.targetNodeId as number,
            description: args.description as string,
            createdBy: 'observer',
          });
          return {
            success: true,
            data: { id: rel.id },
            message: `Created relationship ${rel.sourceNodeId} -> ${rel.targetNodeId}: "${rel.description}"`,
          };
        }

        case 'search_nodes': {
          const results = knowledgeHelpers.searchNodes(
            args.query as string,
            Math.min((args.limit as number) ?? 5, 5)
          );
          return {
            success: true,
            data: results.map(n => ({ id: n.id, title: n.title, content: n.content.slice(0, 200) })),
          };
        }

        case 'semantic_search_nodes': {
          const results = knowledgeHelpers.semanticSearch(
            args.query as string,
            Math.min((args.limit as number) ?? 5, 5)
          );
          return {
            success: true,
            data: results.map(n => ({
              id: n.id,
              title: n.title,
              content: n.content.slice(0, 200),
              similarity: n.similarity,
            })),
          };
        }

        case 'set_current_node': {
          const nodeId = args.nodeId as number;
          settingsHelpers.setCurrentNodeId(nodeId);
          const node = knowledgeHelpers.getNode(nodeId);
          return {
            success: true,
            data: node ? { id: node.id, title: node.title } : null,
            message: node ? `Set current node to "${node.title}"` : 'Node not found',
          };
        }

        case 'get_node_relationships': {
          const nodeId = args.nodeId as number;
          const relationships = knowledgeHelpers.getNodeRelationships(nodeId);
          return {
            success: true,
            data: relationships.map(r => ({
              id: r.id,
              sourceNodeId: r.sourceNodeId,
              targetNodeId: r.targetNodeId,
              description: r.description,
            })),
          };
        }

        default:
          return {
            success: false,
            error: `Unknown tool: ${name}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private updateStatus(status: TaskStatus) {
    this.currentTask = status;
    this.onStatusChange?.(status);
  }
}

// Singleton instance
let observerInstance: ObserverAgentService | null = null;

export const getObserverAgent = (): ObserverAgentService => {
  if (!observerInstance) {
    observerInstance = new ObserverAgentService();
  }
  return observerInstance;
};

export const resetObserverAgent = (): void => {
  observerInstance = null;
};

export type { TaskStatus };
