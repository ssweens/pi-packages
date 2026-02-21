/**
 * MaaS streaming handler for Claude and all other models
 * Uses OpenAI-compatible Chat Completions endpoint
 * 
 * Delegates to pi-ai's built-in OpenAI streaming implementation
 */

import type { VertexModelConfig, Context, StreamOptions } from "../types.js";
import { getAuthConfig, buildBaseUrl, getAccessToken, resolveLocation } from "../auth.js";
import { createAssistantMessageEventStream, type AssistantMessageEventStream, type Model, streamSimpleOpenAICompletions } from "@mariozechner/pi-ai";

export function streamMaaS(
  model: VertexModelConfig,
  context: Context,
  options?: StreamOptions
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    try {
      // Priority: config file > env var > model region > default
      const location = resolveLocation(model.region);
      const auth = getAuthConfig(location);
      const accessToken = await getAccessToken();

      const baseUrl = buildBaseUrl(auth.projectId, auth.location);
      const endpoint = `${baseUrl}/endpoints/openapi`;
      // Create a model object compatible with pi-ai's OpenAI streaming.
      // Note: baseUrl must point to the OpenAPI root; pi-ai appends /chat/completions.
      const modelForPi: Model<"openai-completions"> = {
        id: model.apiId, // Use the full API ID with publisher prefix
        name: model.name,
        api: "openai-completions",
        provider: "vertex",
        baseUrl: endpoint,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        headers: {},
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens",
          thinkingFormat: model.publisher === "qwen" ? "qwen" : "openai",
        },
      };

      // Delegate to pi-ai's built-in OpenAI streaming
      const innerStream = streamSimpleOpenAICompletions(
        modelForPi,
        context as any,
        {
          ...options,
          apiKey: accessToken,
          maxTokens: options?.maxTokens || Math.floor(model.maxTokens / 2),
          temperature: options?.temperature ?? 0.7,
        }
      );

      // Forward all events from inner stream to outer stream
      for await (const event of innerStream) {
        stream.push(event);
      }
      stream.end();

    } catch (error) {
      stream.push({
        type: "error",
        reason: options?.signal?.aborted ? "aborted" : "error",
        error: {
          role: "assistant",
          content: [],
          api: "openai-completions",
          provider: "vertex",
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: options?.signal?.aborted ? "aborted" : "error",
          errorMessage: error instanceof Error ? error.message : String(error),
          timestamp: Date.now(),
        },
      });
      stream.end();
    }
  })();

  return stream;
}
