/**
 * Type definitions for pi-vertex extension
 */

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
  cost: ModelCost;
  region: string;
}

export interface AuthConfig {
  projectId: string;
  location: string;
  credentials?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  mimeType: string;
  data: string;
}

export type MessageContent = TextContent | ImageContent;

export interface Message {
  role: MessageRole;
  content: string | MessageContent[];
}

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh";
  signal?: AbortSignal;
}

// Re-export types from pi-ai for convenience
export type { AssistantMessage, AssistantMessageEvent, AssistantMessageEventStream } from "@mariozechner/pi-ai";
