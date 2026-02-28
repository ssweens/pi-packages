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
    const originalFetch = globalThis.fetch;
    try {
      // Priority: config file > env var > model region > default
      const location = resolveLocation(model.region);
      const auth = getAuthConfig(location);
      const accessToken = await getAccessToken();

      const baseUrl = buildBaseUrl(auth.projectId, auth.location);
      const endpoint = `${baseUrl}/endpoints/openapi`;
      // Create a model object compatible with pi-ai's OpenAI streaming.
      // Note: baseUrl must point to the OpenAPI root; pi-ai appends /chat/completions.
      // Use model.id (registered name like "glm-5") so pi can restore sessions correctly.
      // The actual API model name (apiId like "zai-org/glm-5-maas") is injected via fetch interceptor below.
      const modelForPi: Model<"openai-completions"> = {
        id: model.id,
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

      // Intercept fetch to replace model.id with the actual API model name (apiId)
      // pi-ai's streaming uses model.id in the request body, but Vertex MaaS needs the full publisher-prefixed name
      globalThis.fetch = async (input: any, init?: any) => {
        if (init?.body && typeof init.body === "string") {
          try {
            const body = JSON.parse(init.body);
            if (body.model === model.id) {
              body.model = model.apiId;
              init = { ...init, body: JSON.stringify(body) };
            }
          } catch {}
        }
        return originalFetch(input, init);
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
      globalThis.fetch = originalFetch;
      stream.end();

    } catch (error) {
      globalThis.fetch = originalFetch;
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
