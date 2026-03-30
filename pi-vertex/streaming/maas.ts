/**
 * MaaS streaming handler for Claude and all other models.
 *
 * - Anthropic models: native AnthropicVertex SDK streaming
 * - Other MaaS models: Vertex OpenAI-compatible Chat Completions endpoint
 */

import type { VertexModelConfig, Context, StreamOptions } from "../types.js";
import { getAuthConfig, buildBaseUrl, getAccessToken, resolveLocation } from "../auth.js";
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
  type Model,
  streamSimpleOpenAICompletions,
  calculateCost,
} from "@mariozechner/pi-ai";
import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

function mapAnthropicEffort(reasoning?: string): "low" | "medium" | "high" | "max" | undefined {
  if (!reasoning) return undefined;
  if (reasoning === "minimal" || reasoning === "low") return "low";
  if (reasoning === "medium") return "medium";
  if (reasoning === "xhigh") return "max";
  return "high";
}

/**
 * Sanitize an ID to match Anthropic's pattern: ^[a-zA-Z0-9_-]+$
 * Replaces invalid characters with underscores.
 */
function sanitizeToolId(id: string): string {
  // Replace any character that's not alphanumeric, underscore, or hyphen.
  const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  // Deterministic fallback for empty/invalid IDs.
  return sanitized || "tool_id";
}

function isValidThinkingSignature(signature?: string): boolean {
  if (!signature) return false;
  // Anthropic signatures are base64-like encrypted payloads.
  return /^[A-Za-z0-9+/]+={0,2}$/.test(signature) && signature.length % 4 === 0;
}

/**
 * Stream a Claude model via the native AnthropicVertex SDK.
 */
async function streamAnthropic(
  model: VertexModelConfig,
  context: Context,
  options: StreamOptions | undefined,
  stream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<void> {
  const location = resolveLocation(model.region);
  const auth = getAuthConfig(location);

  const client = new AnthropicVertex({
    projectId: auth.projectId,
    region: auth.location,
  });

  // Build messages with Anthropic-compatible tool-use/tool-result sequencing.
  const sourceMessages = (context.messages as any[]) ?? [];

  // Pass 1: normalize tool call IDs and propagate mapping to tool results.
  const normalized: any[] = [];
  const toolIdMap = new Map<string, string>();
  for (const msg of sourceMessages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const content = msg.content.map((block: any) => {
        if (block?.type !== "toolCall") return block;
        const normalizedId = sanitizeToolId(String(block.id ?? ""));
        if (block.id && normalizedId !== block.id) toolIdMap.set(block.id, normalizedId);
        return { ...block, id: normalizedId };
      });
      normalized.push({ ...msg, content });
    } else if (msg.role === "toolResult") {
      const mapped = toolIdMap.get(msg.toolCallId);
      normalized.push({ ...msg, toolCallId: sanitizeToolId(String(mapped ?? msg.toolCallId ?? "")) });
    } else {
      normalized.push(msg);
    }
  }

  // Pass 2: enforce Anthropic adjacency rule:
  // assistant(tool_use...) MUST be immediately followed by user(tool_result...)
  const replayable: any[] = [];
  for (let i = 0; i < normalized.length; i++) {
    const msg = normalized[i];

    if (msg.role === "assistant") {
      if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;

      const toolCalls = Array.isArray(msg.content)
        ? msg.content.filter((b: any) => b?.type === "toolCall" && b?.id && b?.name)
        : [];

      replayable.push(msg);

      if (toolCalls.length > 0) {
        const collectedToolResults: any[] = [];
        let j = i + 1;
        while (j < normalized.length && normalized[j]?.role === "toolResult") {
          collectedToolResults.push(normalized[j]);
          j++;
        }

        const existingIds = new Set(collectedToolResults.map((tr: any) => tr.toolCallId));
        for (const tc of toolCalls) {
          if (!existingIds.has(tc.id)) {
            collectedToolResults.push({
              role: "toolResult",
              toolCallId: tc.id,
              toolName: tc.name,
              content: [{ type: "text", text: "No result provided" }],
              isError: true,
              timestamp: Date.now(),
            });
          }
        }

        replayable.push(...collectedToolResults);
        i = j - 1;
      }
      continue;
    }

    // Drop orphan tool results (invalid for Anthropic if not immediately after tool_use assistant msg).
    if (msg.role === "toolResult") continue;

    replayable.push(msg);
  }

  // Final pass: convert replayable internal messages to Anthropic message blocks.
  const messages: Array<{ role: "user" | "assistant"; content: any }> = [];
  for (let i = 0; i < replayable.length; i++) {
    const msg = replayable[i];

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        messages.push({ role: "user", content: [{ type: "text", text: msg.content }] });
      } else if (Array.isArray(msg.content)) {
        const blocks = msg.content
          .map((c: any) => {
            if (c.type === "text") return { type: "text", text: c.text };
            if (c.type === "image") {
              return { type: "image", source: { type: "base64", media_type: c.mimeType, data: c.data } };
            }
            return null;
          })
          .filter(Boolean);
        if (blocks.length > 0) messages.push({ role: "user", content: blocks });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const blocks: any[] = [];
      const isSameModel = msg.provider === "vertex" && msg.api === "anthropic-messages" && msg.model === model.id;

      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text" && block.text?.trim()) {
            blocks.push({ type: "text", text: block.text });
          } else if (block.type === "toolCall") {
            blocks.push({ type: "tool_use", id: sanitizeToolId(String(block.id ?? "")), name: block.name, input: block.arguments ?? {} });
          } else if (block.type === "thinking" && block.thinking?.trim()) {
            if (isSameModel && isValidThinkingSignature(block.thinkingSignature)) {
              blocks.push({ type: "thinking", thinking: block.thinking, signature: block.thinkingSignature });
            } else {
              // Cross-model/provider replay: convert thinking to plain text to avoid signature errors.
              blocks.push({ type: "text", text: block.thinking });
            }
          }
        }
      }
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
      continue;
    }

    if (msg.role === "toolResult") {
      // Group consecutive tool results into one user message (Anthropic expects this shape).
      const toolResultBlocks: any[] = [];
      let j = i;
      while (j < replayable.length && replayable[j]?.role === "toolResult") {
        const tr = replayable[j];
        const text = typeof tr.content === "string"
          ? tr.content
          : Array.isArray(tr.content)
            ? tr.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n")
            : JSON.stringify(tr.content ?? "");

        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: sanitizeToolId(String(tr.toolCallId ?? "")),
          content: text || "",
          ...(tr.isError ? { is_error: true } : {}),
        });
        j++;
      }

      if (toolResultBlocks.length > 0) {
        messages.push({ role: "user", content: toolResultBlocks });
      }
      i = j - 1;
    }
  }

  // Build tools
  const tools = context.tools?.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: t.parameters?.properties ?? {},
      required: t.parameters?.required ?? [],
    },
  }));

  const params: any = {
    model: model.apiId,
    max_tokens: options?.maxTokens || Math.floor(model.maxTokens / 2),
    messages,
    ...(context.systemPrompt ? { system: context.systemPrompt } : {}),
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(options?.temperature !== undefined && !options?.reasoning ? { temperature: options.temperature } : {}),
  };

  // Thinking
  if (model.reasoning && options?.reasoning) {
    const effort = mapAnthropicEffort(options.reasoning);
    if (effort) {
      params.thinking = { type: "adaptive" };
      params.output_config = { effort };
    }
  }

  const output: any = {
    role: "assistant",
    content: [],
    api: "anthropic-messages",
    provider: "vertex",
    model: model.id,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  stream.push({ type: "start", partial: output });

  const anthropicStream = client.messages.stream(params, { signal: options?.signal });

  for await (const event of anthropicStream) {
    if (event.type === "message_start") {
      output.responseId = event.message.id;
      output.usage.input = event.message.usage.input_tokens || 0;
      output.usage.cacheRead = event.message.usage.cache_read_input_tokens || 0;
      output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens || 0;

    } else if (event.type === "content_block_start") {
      const cb = event.content_block;
      if (cb.type === "text") {
        output.content.push({ type: "text", text: "", index: event.index });
        stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
      } else if (cb.type === "thinking") {
        output.content.push({ type: "thinking", thinking: "", thinkingSignature: "", index: event.index });
        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
      } else if (cb.type === "tool_use") {
        output.content.push({ type: "toolCall", id: cb.id, name: cb.name, arguments: {}, partialArgs: "", index: event.index });
        stream.push({ type: "toolcall_start", contentIndex: output.content.length - 1, partial: output });
      }

    } else if (event.type === "content_block_delta") {
      const idx = output.content.findIndex((b: any) => b.index === event.index);
      const block = output.content[idx];
      if (!block) continue;

      const delta = event.delta;
      if (delta.type === "text_delta" && block.type === "text") {
        block.text += delta.text;
        stream.push({ type: "text_delta", contentIndex: idx, delta: delta.text, partial: output });
      } else if (delta.type === "thinking_delta" && block.type === "thinking") {
        block.thinking += delta.thinking;
        stream.push({ type: "thinking_delta", contentIndex: idx, delta: delta.thinking, partial: output });
      } else if (delta.type === "signature_delta" && block.type === "thinking") {
        block.thinkingSignature = (block.thinkingSignature || "") + delta.signature;
      } else if (delta.type === "input_json_delta" && block.type === "toolCall") {
        block.partialArgs += delta.partial_json;
        stream.push({ type: "toolcall_delta", contentIndex: idx, delta: delta.partial_json, partial: output });
      }

    } else if (event.type === "content_block_stop") {
      const idx = output.content.findIndex((b: any) => b.index === event.index);
      const block = output.content[idx];
      if (!block) continue;
      delete block.index;

      if (block.type === "text") {
        stream.push({ type: "text_end", contentIndex: idx, content: block.text, partial: output });
      } else if (block.type === "thinking") {
        stream.push({ type: "thinking_end", contentIndex: idx, content: block.thinking, partial: output });
      } else if (block.type === "toolCall") {
        try { block.arguments = JSON.parse(block.partialArgs); } catch { block.arguments = {}; }
        delete block.partialArgs;
        stream.push({ type: "toolcall_end", contentIndex: idx, toolCall: block, partial: output });
      }

    } else if (event.type === "message_delta") {
      if (event.delta.stop_reason) {
        const r = event.delta.stop_reason;
        output.stopReason = r === "end_turn" ? "stop" : r === "max_tokens" ? "length" : r === "tool_use" ? "toolUse" : "stop";
      }
      if (event.usage?.output_tokens != null) output.usage.output = event.usage.output_tokens;
    }
  }

  output.usage.totalTokens = output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
  calculateCost(model as any, output.usage);

  if (output.content.some((b: any) => b.type === "toolCall")) {
    output.stopReason = "toolUse";
  }

  stream.push({ type: "done", reason: output.stopReason, message: output });
}

export function streamMaaS(
  model: VertexModelConfig,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const apiModelId = model.apiId.includes("/") ? model.apiId : `${model.publisher}/${model.apiId}`;

    try {
      if (model.publisher === "anthropic") {
        await streamAnthropic(model, context, options, stream);
        stream.end();
        return;
      }

      // Non-Anthropic MaaS models: Vertex OpenAI-compatible endpoint.
      const location = resolveLocation(model.region);
      const auth = getAuthConfig(location);
      const accessToken = await getAccessToken();
      const baseUrl = buildBaseUrl(auth.projectId, auth.location);
      const endpoint = `${baseUrl}/endpoints/openapi`;

      const modelForPi: Model<"openai-completions"> = {
        id: apiModelId,
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
          thinkingFormat: model.publisher === "qwen" ? "qwen" : model.publisher === "zai-org" ? "zai" : "openai",
        },
      };

      const innerStream = streamSimpleOpenAICompletions(modelForPi, context as any, {
        ...options,
        apiKey: accessToken,
        maxTokens: options?.maxTokens || Math.floor(model.maxTokens / 2),
        temperature: options?.temperature,
      });

      for await (const event of innerStream) {
        if ("partial" in event && event.partial) event.partial.model = model.id;
        if ("message" in event && event.message) event.message.model = model.id;
        if ("error" in event && event.error && typeof event.error === "object") {
          const err = event.error as any;
          err.model = model.id;
        }
        stream.push(event);
      }
      stream.end();

    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      stream.push({
        type: "error",
        reason: options?.signal?.aborted ? "aborted" : "error",
        error: {
          role: "assistant",
          content: [],
          api: model.publisher === "anthropic" ? "anthropic-messages" : "openai-completions",
          provider: "vertex",
          model: model.id,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          stopReason: options?.signal?.aborted ? "aborted" : "error",
          errorMessage: rawMessage,
          timestamp: Date.now(),
        },
      });
      stream.end();
    }
  })();

  return stream;
}
