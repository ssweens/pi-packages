/**
 * Model resolution helper for subagents.
 *
 * Resolves a model by provider + ID from the model registry.
 */

import type { Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

/** Minimal shape of Pi's ModelRuntime that Leash needs to detect and pass on. */
export interface ModelRuntimeLike {
  getAvailableSnapshot(): unknown;
}

/**
 * Get this Pi's ModelRuntime, or undefined on Pi versions that predate it.
 *
 * Pi >= 0.8x routes model/auth access through `ModelRuntime` and keeps it on the
 * `ModelRegistry` facade, where it is declared private (so it is reachable at
 * runtime but not through the registry's type). Older Pi has no runtime at all.
 * Callers use the result to choose between the two host APIs.
 */
export function getModelRuntime(
  ctx: ExtensionContext,
): ModelRuntimeLike | undefined {
  const candidate = (ctx.modelRegistry as unknown as { runtime?: unknown })
    .runtime as ModelRuntimeLike | undefined;
  return typeof candidate?.getAvailableSnapshot === "function"
    ? candidate
    : undefined;
}

/**
 * Find a model by provider and ID.
 *
 * @param provider - Provider name (e.g., "openrouter", "anthropic", "openai-codex")
 * @param modelId - Model ID (e.g., "anthropic/claude-haiku-4.5")
 * @param ctx - Extension context with modelRegistry
 * @returns The resolved model
 * @throws Error if model not found or API key not configured
 */
export function resolveModel(
  provider: string,
  modelId: string,
  ctx: ExtensionContext,
  // biome-ignore lint/suspicious/noExplicitAny: Model type requires any for generic API
): Model<any> {
  const available = ctx.modelRegistry.getAvailable();
  const model = available.find(
    (m) => m.id === modelId && m.provider === provider,
  );

  if (model) {
    return model;
  }

  // Check if the model exists but the API key is missing
  const all = ctx.modelRegistry.getAll();
  const existsWithoutKey = all.some(
    (m) => m.id === modelId && m.provider === provider,
  );

  if (existsWithoutKey) {
    throw new Error(
      `Model "${modelId}" exists on ${provider} but no valid API key is configured.`,
    );
  }

  throw new Error(`Model "${modelId}" not found on provider "${provider}".`);
}
