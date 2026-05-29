export type ProviderId = string;

export type ProviderApi =
  | "anthropic-messages"
  | "openai-completions"
  | "openai-responses"
  | "azure-openai-responses"
  | "openai-codex-responses"
  | "mistral-conversations"
  | "google-generative-ai"
  | "google-vertex"
  | "bedrock-converse-stream"
  | string;

export interface ProviderModelConfig {
  id: string;
  name?: string;
  api?: ProviderApi;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  compat?: Record<string, unknown>;
  thinkingLevelMap?: Record<string, string | null>;
  headers?: Record<string, string>;
}

export interface ProviderConfig {
  id: ProviderId;
  label?: string;
  /** Alias for Pi provider display name when exported/registered. */
  name?: string;
  envKeys?: string[];
  aliases?: string[];
  /** Raw Pi auth provider id, when different from this provider's account id. */
  piAuthProvider?: ProviderId;
  /** Pi custom model provider config fields. */
  baseUrl?: string;
  api?: ProviderApi;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  compat?: Record<string, unknown>;
  models?: ProviderModelConfig[];
  modelOverrides?: Record<string, Partial<ProviderModelConfig>>;
}
