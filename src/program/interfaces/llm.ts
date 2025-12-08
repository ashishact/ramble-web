/**
 * LLM Service Interface
 *
 * Abstract interface for LLM interactions.
 * Wraps the cfGateway service with program-specific functionality.
 */

/**
 * Chat message structure
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * LLM model type
 */
export type LLMModel = 'fast' | 'intelligent';

/**
 * LLM call options
 */
export interface LLMCallOptions {
  model?: LLMModel;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

/**
 * Streaming callbacks
 */
export interface LLMStreamCallbacks {
  onToken: (token: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: Error) => void;
}

/**
 * LLM response with metadata
 */
export interface LLMResponse {
  content: string;
  model: string;
  tokensUsed?: number;
  cached?: boolean;
}

/**
 * JSON extraction result
 */
export interface LLMJsonResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}

/**
 * LLM Service interface
 */
export interface ILLMService {
  /**
   * Simple chat completion
   */
  chat(messages: LLMMessage[], options?: LLMCallOptions): Promise<string>;

  /**
   * Chat with full response metadata
   */
  chatWithMetadata(messages: LLMMessage[], options?: LLMCallOptions): Promise<LLMResponse>;

  /**
   * Streaming chat completion
   */
  streamChat(
    messages: LLMMessage[],
    callbacks: LLMStreamCallbacks,
    options?: LLMCallOptions
  ): Promise<void>;

  /**
   * Extract JSON from LLM response with validation
   */
  extractJson<T>(
    prompt: string,
    schema: { parse: (data: unknown) => T },
    options?: LLMCallOptions
  ): Promise<LLMJsonResult<T>>;

  /**
   * Check if API key is configured
   */
  isConfigured(model?: LLMModel): boolean;

  /**
   * Get the underlying provider for a model type
   */
  getProvider(model: LLMModel): string;
}

/**
 * Create prompt utilities
 */
export interface IPromptBuilder {
  /**
   * Build a prompt with variable substitution
   * Variables are marked as {VARIABLE_NAME}
   */
  build(template: string, variables: Record<string, string>): string;

  /**
   * Format a list for inclusion in prompts
   */
  formatList(items: string[], style?: 'numbered' | 'bulleted' | 'plain'): string;

  /**
   * Format claims for LLM context
   */
  formatClaims(claims: Array<{ statement: string; subject: string }>): string;

  /**
   * Truncate text to fit token budget
   */
  truncate(text: string, maxTokens: number): string;
}
