/**
 * pi-dynamic-models — Dynamic model discovery for Pi coding agent
 *
 * Reads ~/.pi/agent/settings/pi-dynamic-models.json and registers each configured
 * server as a named provider by fetching a configurable model source at startup.
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
 *   1. Fetch all model IDs from the configured source (default: GET {baseUrl}/models)
 *   2. Union with model IDs listed in config "models"
 *   3. For each: use configured fields if present, otherwise use defaults
 *
 * Servers that are unreachable at startup fall back to only the explicitly
 * configured models (if any). Servers with no configured models and an
 * unreachable /models endpoint are skipped entirely.
 */

import { getAgentDir } from "@mariozechner/pi-coding-agent";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function truncatePlain(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}

function resolveConfiguredApiKey(apiKey?: string): string | undefined {
  if (!apiKey || apiKey === "none") return undefined;

  if (apiKey.startsWith("!")) {
    try {
      const resolved = execSync(apiKey.slice(1), {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return resolved || undefined;
    } catch {
      return undefined;
    }
  }

  const templateMatch = apiKey.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/);
  if (templateMatch) {
    const envName = templateMatch[1] ?? templateMatch[2];
    return process.env[envName] || undefined;
  }

  return process.env[apiKey] ?? apiKey;
}

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

interface ModelSourceConfig {
  url: string;
  itemsPath?: string;
  idPath?: string;
  namePath?: string;
}

interface ServerConfig {
  provider: string;
  baseUrl: string;
  apiKey?: string;
  api?: string;
  compat?: OpenAICompat;
  modelsSource?: ModelSourceConfig;
  models?: Record<string, ModelOverride>;
}

interface DiscoveredModel {
  id: string;
  name?: string;
}

interface ModelsResponse {
  object?: string;
  data: DiscoveredModel[];
}

/** Shape returned by GET {baseUrl}/corral/models */
interface CorralModelDetail {
  id: string;
  context_size: number | null;
  hf_base?: string | null;
  aliases?: string[];
  unlisted?: boolean;
  ttl?: number | null;
  pool_size?: number;
}

interface CorralModelsResponse {
  object: string;
  data: CorralModelDetail[];
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
function loadConfig(): ServerConfig[] {
  const configPath = join(getAgentDir(), "settings", "pi-dynamic-models.json");
  return parseConfigFile(configPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getValueAtPath(value: unknown, path?: string): unknown {
  const normalizedPath = path?.trim();
  if (!normalizedPath || normalizedPath === ".") return value;

  let current: unknown = value;
  for (const part of normalizedPath.split(".").filter(Boolean)) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readItemsAtPath(value: unknown, path?: string): unknown[] {
  const scoped = getValueAtPath(value, path);
  if (Array.isArray(scoped)) return scoped;
  if (!path && isRecord(value) && Array.isArray(value.data)) return value.data;
  return [];
}

async function fetchCorralModelDetails(
  baseUrl: string,
  apiKey?: string,
): Promise<Map<string, CorralModelDetail>> {
  const normalized = baseUrl.replace(/\/+$/, "");
  const rootCandidate = normalized.replace(/\/v\d+(?:\.\d+)?$/, "");
  const candidateUrls = Array.from(new Set([
    `${rootCandidate}/corral/models`,
    `${normalized}/corral/models`,
  ]));

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey && apiKey !== "none") headers["Authorization"] = `Bearer ${apiKey}`;

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
      if (!response.ok) continue;
      const body = (await response.json()) as CorralModelsResponse;
      const map = new Map<string, CorralModelDetail>();
      for (const m of body.data ?? []) map.set(m.id, m);
      return map;
    } catch {
      // try next candidate URL
    }
  }

  return new Map();
}

async function fetchModelsFromSource(
  source: ModelSourceConfig,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  const url = source.url.trim();
  if (!url) {
    throw new Error("model source url is required");
  }

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
  const items = readItemsAtPath(body, source.itemsPath);
  const idPath = source.idPath?.trim() || "id";
  const namePath = source.namePath?.trim() || "name";

  return items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = toOptionalString(getValueAtPath(item, idPath))?.trim();
    if (!id) return [];
    return [{
      id,
      name: toOptionalString(getValueAtPath(item, namePath))?.trim() || id,
    }];
  });
}

export default async function (pi: ExtensionAPI): Promise<void> {
  const servers = loadConfig();
  if (servers.length === 0) return;

  const startupLines: string[] = [];

  await Promise.all(
    servers.map(async ({ provider, baseUrl, apiKey, api, compat, modelsSource, models: modelOverrides }) => {
      const resolvedApiKey = resolveConfiguredApiKey(apiKey);
      const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
      const source = modelsSource?.url
        ? modelsSource
        : { url: `${normalizedBaseUrl}/models` };

      // Fetch source model IDs first; corral metadata is additive only.
      // If the source fetch fails but explicit models exist, keep those.
      let fetchedModels: DiscoveredModel[] = [];
      try {
        fetchedModels = await fetchModelsFromSource(source, resolvedApiKey);
      } catch (err) {
        if (modelOverrides && Object.keys(modelOverrides).length > 0) {
          startupLines.push(`   [pi-dynamic-models] Could not reach ${source.url} (${err}), using configured models only`);
        } else {
          startupLines.push(`   [pi-dynamic-models] Could not reach ${source.url}: ${err}`);
          return;
        }
      }

      let corralDetails = new Map<string, CorralModelDetail>();
      try {
        corralDetails = await fetchCorralModelDetails(baseUrl, resolvedApiKey);
      } catch {
        // Optional metadata only.
      }

      // Union of fetched IDs and explicitly configured IDs
      const allIds = new Set<string>([...fetchedModels.map((m) => m.id), ...Object.keys(modelOverrides ?? {})]);

      if (allIds.size === 0) {
        startupLines.push(`   [pi-dynamic-models] No models for provider "${provider}"`);
        return;
      }

      const discoveredById = new Map(fetchedModels.map((model) => [model.id, model]));

      pi.registerProvider(provider, {
        baseUrl: normalizedBaseUrl,
        // Supports literal keys, env var names, $ENV_VAR references, and !shell-commands.
        apiKey: resolvedApiKey,
        authHeader: !!resolvedApiKey,
        api: api ?? "openai-completions",
        models: Array.from(allIds).sort((a, b) => a.localeCompare(b)).map((id) => {
          const override = modelOverrides?.[id];
          const corral = corralDetails.get(id);
          const discovered = discoveredById.get(id);
          return {
            id,
            name: override?.name ?? discovered?.name ?? id,
            reasoning: override?.reasoning ?? false,
            input: override?.input ?? (["text"] as ("text" | "image")[]),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            // Priority: manual config override > corral's live context_size > default
            contextWindow: override?.contextWindow ?? corral?.context_size ?? 128_000,
            maxTokens: override?.maxTokens ?? 16_384,
            // compat is only meaningful for openai-completions but harmless elsewhere
            ...(compat ? { compat } : {}),
          };
        }),
      });

      const fetchedNote = fetchedModels.length > 0 ? `${fetchedModels.length} discovered` : "0 discovered";
      const overrideNote = Object.keys(modelOverrides ?? {}).length > 0
        ? `, ${Object.keys(modelOverrides!).length} configured`
        : "";
      const sourceNote = modelsSource?.url ? ` via ${source.url}` : " via /models";
      startupLines.push(
        `   [pi-dynamic-models] Provider "${provider}": ${fetchedNote}${overrideNote}, ${allIds.size} total (${api ?? "openai-completions"})${sourceNote}`
      );
    })
  );

  // Show startup info as a widget that clears on first user input
  if (startupLines.length > 0) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.setWidget("pi-dynamic-models-startup", (_tui, theme) => ({
        render: (width: number) => [
          ...startupLines.map((line) => theme.fg("muted", truncatePlain(line, width))),
          "",
        ],
        invalidate: () => {},
      }));
    });
    pi.on("input", async (_event, ctx) => {
      ctx.ui.setWidget("pi-dynamic-models-startup", undefined);
    });
  }
}
