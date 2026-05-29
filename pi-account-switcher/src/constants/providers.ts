export const PROVIDER_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "azure-openai-responses",
  "openai-codex-responses",
  "mistral-conversations",
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
] as const;

export const OAUTH_PROVIDER_IDS = [
  "anthropic",
  "openai-codex",
  "github-copilot",
  "google-antigravity",
  "custom",
] as const;

export const BUILT_IN_PROVIDER_IDS = ["anthropic", "openai", "openai-codex", "google", "xai", "openrouter"] as const;

export const PROVIDER_ALIASES: Record<string, string> = {
  claude: "anthropic",
  codex: "openai-codex",
  gemini: "google",
};

export const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  "openai-codex": ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  xai: ["XAI_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
};
