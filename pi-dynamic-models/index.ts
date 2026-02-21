/**
 * pi-dynamic-models — Dynamic model discovery for Pi coding agent
 *
 * Reads ~/.pi/agent/settings/pi-dynamic-models.json and registers each configured
 * server as a named provider by fetching GET {baseUrl}/models at startup.
 *
 * Config file (~/.pi/agent/settings/pi-dynamic-models.json):
 *
 *   [
 *     {
 *       "provider": "local-llm",
 *       "baseUrl": "http://192.168.1.51:9999/v1",
 *       "apiKey": "MY_API_KEY",
 *       "api": "openai-completions",
 *       "compat": {
 *         "supportsUsageInStreaming": true,
 *         "maxTokensField": "max_tokens"
 *       },
 *       "models": {
 *         "my-model-id": {
 *           "name": "My Model",
 *           "contextWindow": 200000,
 *           "maxTokens": 32000,
 *           "reasoning": true,
 *           "input": ["text", "image"]
 *         }
 *       }
 *     }
 *   ]
 *
 * Fields:
 *   provider  (required) Name shown in the model selector
 *   baseUrl   (required) Server URL including /v1 if needed
 *   apiKey    (optional) Literal key, env var name, or !shell-command
 *   api       (optional) Pi API type; defaults to "openai-completions"
 *   compat    (optional) OpenAI-completions compat overrides (see OpenAICompat)
 *   models    (optional) Per-model metadata keyed by model ID. Overrides
 *                        defaults for discovered models. Models listed here
 *                        but not returned by the server are still registered.
 *
 * Discovery + override merge logic:
 *   1. Fetch all model IDs from GET {baseUrl}/models
 *   2. Union with model IDs listed in config "models"
 *   3. For each: use configured fields if present, otherwise use defaults
 *
 * Servers that are unreachable at startup fall back to only the explicitly
 * configured models (if any). Servers with no configured models and an
 * unreachable /models endpoint are skipped entirely.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "settings", "pi-dynamic-models.json");
const PROJECT_CONFIG_FILE = join(".pi", "settings", "pi-dynamic-models.json");

// Mirrors OpenAICompletionsCompat from @mariozechner/pi-ai
interface OpenAICompat {
  supportsStore?: boolean;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  supportsUsageInStreaming?: boolean;
  maxTokensField?: "max_completion_tokens" | "max_tokens";
  requiresToolResultName?: boolean;
  requiresAssistantAfterToolResult?: boolean;
  requiresThinkingAsText?: boolean;
  requiresMistralToolIds?: boolean;
  thinkingFormat?: "openai" | "zai" | "qwen";
  supportsStrictMode?: boolean;
}

interface ModelOverride {
  name?: string;
  reasoning?: boolean;
  input?: ("text" | "image")[];
  contextWindow?: number;
  maxTokens?: number;
}

interface ServerConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  api?: string;
  compat?: OpenAICompat;
  models?: Record<string, ModelOverride>;
}

interface RemoteModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

interface ModelsResponse {
  object?: string;
  data: RemoteModel[];
}

function parseConfigFile(path: string): ServerConfig[] {
  if (!existsSync(path)) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.warn(`[pi-dynamic-models] Failed to parse ${path}: ${err}`);
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn(`[pi-dynamic-models] ${path} must be a JSON array`);
    return [];
  }

  const valid: ServerConfig[] = [];
  for (const entry of parsed) {
    if (!entry.provider || !entry.baseUrl) {
      console.warn(`[pi-dynamic-models] Skipping entry missing "provider" or "baseUrl": ${JSON.stringify(entry)}`);
      continue;
    }
    valid.push(entry as ServerConfig);
  }
  return valid;
}

/** Load and merge global + project configs.
 *  Project servers override global ones by provider name; extras are appended. */
function loadConfig(cwd: string = process.cwd()): ServerConfig[] {
  const global = parseConfigFile(CONFIG_PATH);
  const project = parseConfigFile(join(cwd, PROJECT_CONFIG_FILE));

  if (project.length === 0) return global;

  // Project entries override global entries with the same provider name
  const merged = new Map(global.map((s) => [s.provider, s]));
  for (const server of project) {
    merged.set(server.provider, server);
  }
  return [...merged.values()];
}

async function fetchRemoteModels(baseUrl: string, apiKey?: string): Promise<RemoteModel[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const body = (await response.json()) as ModelsResponse;

  // Servers may return a plain array or the standard {object:"list", data:[...]} shape
  if (Array.isArray(body)) {
    return body as RemoteModel[];
  }
  return body.data ?? [];
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const servers = loadConfig();
  if (servers.length === 0) return;

  await Promise.all(
    servers.map(async ({ provider, baseUrl, apiKey, api, compat, models: modelOverrides }) => {
      // Fetch remote model IDs — fall back gracefully if unreachable
      let fetchedIds: string[] = [];
      try {
        const fetched = await fetchRemoteModels(baseUrl, apiKey);
        fetchedIds = fetched.map((m) => m.id);
      } catch (err) {
        if (modelOverrides && Object.keys(modelOverrides).length > 0) {
          console.warn(`[pi-dynamic-models] Could not reach ${baseUrl}/models (${err}), using configured models only`);
        } else {
          console.warn(`[pi-dynamic-models] Could not reach ${baseUrl}/models: ${err}`);
          return;
        }
      }

      // Union of fetched IDs and explicitly configured IDs
      const allIds = new Set<string>([...fetchedIds, ...Object.keys(modelOverrides ?? {})]);

      if (allIds.size === 0) {
        console.warn(`[pi-dynamic-models] No models for provider "${provider}"`);
        return;
      }

      pi.registerProvider(provider, {
        baseUrl: baseUrl.replace(/\/+$/, ""),
        // Supports literal keys, env var names, and !shell-commands —
        // same resolution as models.json. Placeholder "none" for open servers.
        apiKey: apiKey ?? "none",
        authHeader: !!apiKey,
        api: api ?? "openai-completions",
        models: Array.from(allIds).map((id) => {
          const override = modelOverrides?.[id];
          return {
            id,
            name:          override?.name          ?? id,
            reasoning:     override?.reasoning     ?? false,
            input:         override?.input         ?? (["text"] as ("text" | "image")[]),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: override?.contextWindow ?? 128_000,
            maxTokens:     override?.maxTokens     ?? 16_384,
            // compat is only meaningful for openai-completions but harmless elsewhere
            ...(compat ? { compat } : {}),
          };
        }),
      });

      const fetchedNote = fetchedIds.length > 0 ? `${fetchedIds.length} discovered` : "0 discovered";
      const overrideNote = Object.keys(modelOverrides ?? {}).length > 0
        ? `, ${Object.keys(modelOverrides!).length} configured`
        : "";
      console.log(
        `[pi-dynamic-models] Provider "${provider}": ${fetchedNote}${overrideNote}, ${allIds.size} total (${api ?? "openai-completions"})`
      );
    })
  );
}
