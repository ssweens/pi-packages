/**
 * pi-vertex - Google Vertex AI provider for Pi coding agent
 *
 * Supports:
 * - Gemini models (via @google/genai)
 * - Claude models (via OpenAI-compatible endpoint)
 * - All MaaS models (Llama, Mistral, DeepSeek, etc. via OpenAI-compatible endpoint)
 *
 * Configuration (resolution order: config file → env var):
 *
 *   Config file: ~/.pi/agent/config/pi-vertex.json
 *     {
 *       "project": "my-gcp-project",
 *       "location": "us-central1",
 *       "credentialsFile": "/path/to/service-account.json"
 *     }
 *
 *   Env vars (fallback):
 *     GOOGLE_CLOUD_PROJECT or GCLOUD_PROJECT  (required)
 *     GOOGLE_CLOUD_LOCATION                   (optional, default: model region or us-central1)
 *     GOOGLE_APPLICATION_CREDENTIALS          (optional, for service account auth)
 *
 * Usage:
 *   pi --provider vertex --model claude-opus-4-6
 *   pi --provider vertex --model gemini-2.5-pro
 *   pi --provider vertex --model llama-4-maverick
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { Model, Api } from "@mariozechner/pi-ai";
import { ALL_MODELS, getModelById } from "./models/index.js";
import { hasAdcCredentials, resolveProjectId } from "./auth.js";
import { loadConfig, CONFIG_PATH } from "./config.js";
import { streamVertex } from "./streaming/index.js";
import type { VertexModelConfig } from "./types.js";

/**
 * Convert Vertex model config to Pi model format
 */
function toPiModel(config: VertexModelConfig): Model<Api> {
  return {
    id: config.id,
    name: config.name,
    api: "vertex-unified",
    provider: "vertex",
    baseUrl: "", // Will be set dynamically
    reasoning: config.reasoning,
    input: config.input,
    cost: config.cost,
    contextWindow: config.contextWindow,
    maxTokens: config.maxTokens,
    headers: {},
  };
}

/**
 * Extension entry point
 */
export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // Apply credentialsFile to environment so all Google SDKs pick it up.
  // Only set if not already overridden by env var.
  if (config.googleApplicationCredentials && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = config.googleApplicationCredentials;
  }

  const projectId = resolveProjectId();

  if (!projectId) {
    console.log(
      `[pi-vertex] Skipping: no project ID found.\n` +
      `  Config file: set "project" in ${CONFIG_PATH}\n` +
      `  Env var: export GOOGLE_CLOUD_PROJECT=your-project-id`
    );
    return;
  }

  if (!hasAdcCredentials()) {
    console.log(
      `[pi-vertex] Skipping: ADC credentials not found.\n` +
      `  Run: gcloud auth application-default login\n` +
      `  Or set "credentialsFile" in ${CONFIG_PATH}`
    );
    return;
  }

  console.log(`[pi-vertex] Initializing with project: ${projectId}`);

  // Register the provider
  pi.registerProvider("vertex", {
    // Use a placeholder baseUrl (actual URLs built per-request based on model region)
    baseUrl: "https://aiplatform.googleapis.com",

    // Use env var name for detection
    apiKey: "GOOGLE_CLOUD_PROJECT",

    // API type varies by model
    api: "vertex-unified",

    // Register all models
    models: ALL_MODELS.map(toPiModel),

    // Custom streaming implementation
    streamSimple: (model: Model<Api>, context: any, options?: any) => {
      const vertexModel = getModelById(model.id);
      if (!vertexModel) {
        throw new Error(`Unknown Vertex model: ${model.id}`);
      }

      return streamVertex(vertexModel, context, options);
    },
  });

  console.log(`[pi-vertex] Registered ${ALL_MODELS.length} models`);
}

// Export types and utilities for advanced usage
export * from "./types.js";
export * from "./models/index.js";
export * from "./auth.js";
export * from "./config.js";
export * from "./streaming/index.js";
