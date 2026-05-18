/**
 * Type definitions for pi-vertex extension
 *
 * Core message/content types are re-exported from pi-ai to ensure pi-vertex
 * handles the full message structure (thinking blocks, tool calls, tool results)
 * that pi-coding-agent passes through the streamSimple callback.
 */

// Re-export core types from pi-ai
export type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  ImageContent,
  Message,
  StopReason,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@mariozechner/pi-ai";

// Vertex-specific types

export type ModelInputType = "text" | "image";
export type EndpointType = "gemini" | "maas";

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface VertexModelConfig {
  id: string;
  name: string;
  apiId: string;
  publisher: string;
  endpointType: EndpointType;
  contextWindow: number;
  maxTokens: number;
  input: ModelInputType[];
  reasoning: boolean;
  tools: boolean;
  /** Pricing for the global endpoint (default). */
  cost: ModelCost;
  /**
   * Pricing for non-global regional endpoints (us-east5, europe-west1,
   * asia-southeast1, us/eu multi-region, etc.).
   *
   * When the resolved GCP location is not "global" and this field is set,
   * the streaming layer uses these costs instead of `cost`.
   * Omit for models whose pricing is uniform across all regions.
   */
  costRegional?: ModelCost;
  region: string;
}

export interface AuthConfig {
  projectId: string;
  location: string;
  credentials?: string;
}

export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  signal?: AbortSignal;
}
