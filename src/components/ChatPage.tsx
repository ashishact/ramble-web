/**
 * Chat Page - Agentic chat interface for querying TinyBase database
 *
 * Uses Vercel AI SDK with automatic tool execution
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { generateText, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import type { Cell } from 'tinybase';
import { observerHelpers, type DatabaseSchema, type DataSummary } from '../stores/observerStore';
import { settingsHelpers } from '../stores/settingsStore';

// ============================================================================
// Types
// ============================================================================

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; args: unknown; result: unknown }[];
  timestamp: Date;
}

// ============================================================================
// Tool Definitions using Zod schemas
// ============================================================================

function createTools() {
  const store = observerHelpers.getStore();
  if (!store) {
    throw new Error('Store not initialized');
  }

  return {
    // ---- READ OPERATIONS ----
    getTable: tool({
      description: 'Get all rows from a table. Tables: sessions, messages, knowledge, tags, categories, privacy, entities, suggestions, documents',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
      }),
      execute: async ({ tableName }: { tableName: string }) => {
        const table = store.getTable(tableName);
        if (!table) return { error: `Table '${tableName}' not found` };
        const rows = Object.entries(table).map(([id, row]) => ({ _id: id, ...row as object }));
        return { rows, count: rows.length };
      },
    }),

    getRow: tool({
      description: 'Get a specific row by ID from a table',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        rowId: z.string().describe('The row ID (or name for tags/categories/privacy)'),
      }),
      execute: async ({ tableName, rowId }: { tableName: string; rowId: string }) => {
        const row = store.getRow(tableName, rowId);
        if (!row || Object.keys(row).length === 0) {
          return { error: `Row '${rowId}' not found in table '${tableName}'` };
        }
        return { _id: rowId, ...row };
      },
    }),

    queryTable: tool({
      description: 'Query a table with a JavaScript filter. The filter code receives (id, row) and returns boolean.',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        filterCode: z.string().describe('JavaScript code: e.g., "row.role === \'user\'"'),
      }),
      execute: async ({ tableName, filterCode }: { tableName: string; filterCode: string }) => {
        const table = store.getTable(tableName);
        if (!table) return { error: `Table '${tableName}' not found` };

        try {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const filterFn = new Function('id', 'row', `return ${filterCode}`);
          const results = Object.entries(table)
            .filter(([id, row]) => {
              try { return filterFn(id, row); } catch { return false; }
            })
            .map(([id, row]) => ({ _id: id, ...row as object }));
          return { rows: results, count: results.length };
        } catch (e) {
          return { error: `Invalid filter: ${e}` };
        }
      },
    }),

    countRows: tool({
      description: 'Count rows in a table, optionally with a filter',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        filterCode: z.string().optional().describe('Optional JavaScript filter code'),
      }),
      execute: async ({ tableName, filterCode }: { tableName: string; filterCode?: string }) => {
        const table = store.getTable(tableName);
        if (!table) return { error: `Table '${tableName}' not found` };

        if (!filterCode) {
          return { count: Object.keys(table).length };
        }

        try {
          // eslint-disable-next-line @typescript-eslint/no-implied-eval
          const filterFn = new Function('id', 'row', `return ${filterCode}`);
          const count = Object.entries(table).filter(([id, row]) => {
            try { return filterFn(id, row); } catch { return false; }
          }).length;
          return { count };
        } catch (e) {
          return { error: `Invalid filter: ${e}` };
        }
      },
    }),

    getSchema: tool({
      description: 'Get the database schema including table names, columns, and row counts',
      inputSchema: z.object({}),
      execute: async (): Promise<DatabaseSchema> => {
        return observerHelpers.getSchema();
      },
    }),

    getSummary: tool({
      description: 'Get a summary of all data counts in the database',
      inputSchema: z.object({}),
      execute: async (): Promise<DataSummary> => {
        return observerHelpers.getDataSummary();
      },
    }),

    // ---- MUTATION OPERATIONS ----
    setCell: tool({
      description: 'Update a single cell/field in a row',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        rowId: z.string().describe('The row ID'),
        cellName: z.string().describe('The field/column name'),
        value: z.union([z.string(), z.number(), z.boolean()]).describe('The new value'),
      }),
      execute: async ({ tableName, rowId, cellName, value }: { tableName: string; rowId: string; cellName: string; value: Cell }) => {
        const existingRow = store.getRow(tableName, rowId);
        if (!existingRow || Object.keys(existingRow).length === 0) {
          return { error: `Row '${rowId}' not found in table '${tableName}'` };
        }
        store.setCell(tableName, rowId, cellName, value);
        return { success: true, updated: { tableName, rowId, cellName, value } };
      },
    }),

    setRow: tool({
      description: 'Set/replace an entire row with new data. Pass row as JSON object string.',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        rowId: z.string().describe('The row ID'),
        rowJson: z.string().describe('The row data as JSON object, e.g. {"name":"value","count":42}'),
      }),
      execute: async ({ tableName, rowId, rowJson }: { tableName: string; rowId: string; rowJson: string }) => {
        try {
          const row = JSON.parse(rowJson) as Record<string, Cell>;
          store.setRow(tableName, rowId, row);
          return { success: true, set: { tableName, rowId } };
        } catch (e) {
          return { error: `Invalid JSON: ${e}` };
        }
      },
    }),

    deleteRow: tool({
      description: 'Delete a row from a table',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        rowId: z.string().describe('The row ID to delete'),
      }),
      execute: async ({ tableName, rowId }: { tableName: string; rowId: string }) => {
        const existingRow = store.getRow(tableName, rowId);
        if (!existingRow || Object.keys(existingRow).length === 0) {
          return { error: `Row '${rowId}' not found in table '${tableName}'` };
        }
        store.delRow(tableName, rowId);
        return { success: true, deleted: { tableName, rowId } };
      },
    }),

    updateMultipleCells: tool({
      description: 'Update multiple cells in a single row at once. Pass updates as JSON object string.',
      inputSchema: z.object({
        tableName: z.string().describe('The table name'),
        rowId: z.string().describe('The row ID'),
        updatesJson: z.string().describe('Key-value pairs as JSON object, e.g. {"color":"#F7DAD9","name":"updated"}'),
      }),
      execute: async ({ tableName, rowId, updatesJson }: { tableName: string; rowId: string; updatesJson: string }) => {
        const existingRow = store.getRow(tableName, rowId);
        if (!existingRow || Object.keys(existingRow).length === 0) {
          return { error: `Row '${rowId}' not found in table '${tableName}'` };
        }
        try {
          const updates = JSON.parse(updatesJson) as Record<string, Cell>;
          for (const [cellName, value] of Object.entries(updates)) {
            store.setCell(tableName, rowId, cellName, value);
          }
          return { success: true, updated: { tableName, rowId, cells: Object.keys(updates) } };
        } catch (e) {
          return { error: `Invalid JSON: ${e}` };
        }
      },
    }),
  };
}

// ============================================================================
// System Prompt Builder
// ============================================================================

function buildSystemPrompt(schema: DatabaseSchema, summary: DataSummary): string {
  return `You are a helpful database assistant that can query AND MODIFY a TinyBase database.

## Database Schema
${JSON.stringify(schema, null, 2)}

## Current Data Summary
- Sessions: ${summary.sessions}
- Messages: ${summary.messages}
- Knowledge Items: ${summary.knowledge}
- Tags: ${summary.tags}
- Categories: ${summary.categories}
- Entities: ${summary.entities}
- Suggestions: ${summary.suggestions}
- Documents: ${summary.documents}

## Important Notes
- For tags/categories/privacy tables, the rowId IS the name (e.g., rowId="general" for category "general")
- JSON fields (like 'contents', 'tags', 'state') are stored as strings
- You CAN and SHOULD modify data when asked - use setCell, setRow, deleteRow, or updateMultipleCells
- Use tools to accomplish tasks - don't just describe what you would do

Be concise. Use markdown tables for data display.`;
}

// ============================================================================
// Component
// ============================================================================

export function ChatPage() {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [summary, setSummary] = useState<DataSummary | null>(null);

  // Initialize schema and summary
  useEffect(() => {
    const init = async () => {
      await observerHelpers.ensureReady();
      setSchema(observerHelpers.getSchema());
      setSummary(observerHelpers.getDataSummary());
    };
    init();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Add message helper
  const addMessage = useCallback((msg: Omit<Message, 'id' | 'timestamp'>) => {
    const newMsg: Message = {
      ...msg,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, newMsg]);
    return newMsg;
  }, []);

  // Main chat handler using AI SDK
  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading || !schema || !summary) return;

    const apiKey = settingsHelpers.getApiKey('gemini');
    if (!apiKey) {
      alert('Please configure Gemini API key in settings');
      navigate('/settings');
      return;
    }

    const userMessage = input.trim();
    setInput('');
    addMessage({ role: 'user', content: userMessage });
    setIsLoading(true);

    try {
      // Create Google AI provider with API key
      const google = createGoogleGenerativeAI({ apiKey });

      // Build conversation history
      const conversationMessages = messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Create tools
      const tools = createTools();

      // Call AI with tools - stopWhen allows multiple tool calls
      const result = await generateText({
        model: google('gemini-2.5-flash'),
        system: buildSystemPrompt(schema, summary),
        messages: [
          ...conversationMessages,
          { role: 'user', content: userMessage },
        ],
        tools,
        stopWhen: stepCountIs(10), // Allow up to 10 tool execution steps
        onStepFinish: ({ text, toolCalls, toolResults }) => {
          console.log('[ChatPage] Step finished:', { text, toolCalls: toolCalls?.length, toolResults: toolResults?.length });
        },
      });

      // Collect tool calls from all steps
      const allToolCalls: { name: string; args: unknown; result: unknown }[] = [];
      for (const step of result.steps) {
        if (step.toolCalls) {
          for (let i = 0; i < step.toolCalls.length; i++) {
            const tc = step.toolCalls[i];
            const tr = step.toolResults?.[i];
            allToolCalls.push({
              name: tc.toolName,
              args: tc.input,
              result: tr?.output,
            });
          }
        }
      }

      console.log('[ChatPage] Result:', {
        text: result.text,
        steps: result.steps.length,
        toolCalls: allToolCalls.length,
      });

      // Add assistant message
      addMessage({
        role: 'assistant',
        content: result.text || 'Done.',
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      });

      // Refresh summary after potential mutations
      setSummary(observerHelpers.getDataSummary());
    } catch (error) {
      console.error('[ChatPage] Error:', error);
      addMessage({
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, schema, summary, messages, addMessage, navigate]);

  // Clear chat
  const handleClear = useCallback(() => {
    setMessages([]);
  }, []);

  return (
    <div className="min-h-screen bg-base-300 flex flex-col">
      {/* Header */}
      <div className="navbar bg-base-100 shadow-lg">
        <div className="flex-1">
          <span className="text-xl font-bold px-4">Database Chat</span>
          {summary && (
            <span className="text-sm opacity-50">
              ({summary.sessions} sessions, {summary.messages} messages, {summary.knowledge} knowledge items)
            </span>
          )}
        </div>
        <div className="flex-none gap-2">
          <button className="btn btn-sm btn-ghost" onClick={handleClear}>
            Clear
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/observer')}>
            Observer
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => navigate('/settings')}>
            Settings
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 opacity-50">
              <p className="text-lg mb-2">Ask questions about your data</p>
              <p className="text-sm">Examples:</p>
              <ul className="text-sm mt-2 space-y-1">
                <li>"How many messages are in each session?"</li>
                <li>"Show me all knowledge items with the 'important' tag"</li>
                <li>"Update the color of the 'general' category to #F7DAD9"</li>
                <li>"Change all category colors to pastel shades"</li>
              </ul>
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`chat ${msg.role === 'user' ? 'chat-end' : 'chat-start'}`}
            >
              <div className="chat-header opacity-50 text-xs mb-1">
                {msg.role === 'user' ? 'You' : 'Assistant'}
                <time className="ml-2">{msg.timestamp.toLocaleTimeString()}</time>
              </div>
              <div
                className={`chat-bubble ${msg.role === 'user' ? 'chat-bubble-primary' : ''}`}
              >
                {msg.role === 'assistant' ? (
                  <div className="prose prose-sm max-w-none prose-table:border-collapse prose-th:border prose-th:border-base-300 prose-th:bg-base-200 prose-th:p-2 prose-td:border prose-td:border-base-300 prose-td:p-2">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  <span>{msg.content}</span>
                )}

                {/* Tool calls summary */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-base-300">
                    <div className="text-xs font-bold opacity-70 mb-2">
                      Tools executed: {msg.toolCalls.length}
                    </div>
                    <div className="space-y-1">
                      {msg.toolCalls.map((tc, i) => (
                        <details key={i} className="text-xs">
                          <summary className="cursor-pointer hover:opacity-80">
                            <span className="badge badge-xs badge-ghost mr-1">{tc.name}</span>
                            {typeof tc.result === 'object' && tc.result && 'success' in tc.result
                              ? <span className="text-success">✓</span>
                              : typeof tc.result === 'object' && tc.result && 'error' in tc.result
                                ? <span className="text-error">✗</span>
                                : <span className="text-info">→</span>
                            }
                          </summary>
                          <pre className="mt-1 p-2 bg-base-200 rounded overflow-auto text-[10px]">
                            Args: {JSON.stringify(tc.args, null, 2)}
                            {'\n'}Result: {JSON.stringify(tc.result, null, 2)}
                          </pre>
                        </details>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat chat-start">
              <div className="chat-bubble">
                <span className="loading loading-dots loading-sm"></span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-base-100 border-t border-base-300 p-4">
        <div className="max-w-4xl mx-auto flex gap-2">
          <input
            type="text"
            className="input input-bordered flex-1"
            placeholder="Ask a question about your data..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? <span className="loading loading-spinner loading-sm"></span> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
