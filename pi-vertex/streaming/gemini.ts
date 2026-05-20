/**
 * Gemini streaming handler using @google/genai SDK
 *
 * Aligned with pi-mono's google-vertex.ts for consistent handling of:
 * - Thinking content (thought blocks with signatures)
 * - Tool calls with unique IDs and deduplication
 * - Thinking configuration (levels for Gemini 3, budgets for Gemini 2.5)
 * - Usage tracking including thinking tokens
 */

import { GoogleGenAI, FinishReason, ThinkingLevel } from "@google/genai";
import type { VertexModelConfig, Context, StreamOptions, AssistantMessage } from "../types.js";
import { getAuthConfig, resolveLocation } from "../auth.js";
import { sanitizeText, convertToGeminiMessages, convertToolsForGemini, retainThoughtSignature, calculateCost } from "../utils.js";
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@mariozechner/pi-ai";

// Module-level counter for generating unique tool call IDs (matches pi-mono pattern)
let toolCallCounter = 0;

const THINKING_LEVEL_MAP: Record<string, ThinkingLevel> = {
  minimal: ThinkingLevel.MINIMAL,
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

interface GeminiThinkingConfig {
  includeThoughts?: boolean;
  thinkingBudget?: number;
  thinkingLevel?: ThinkingLevel;
}

function isGemini3ProModel(modelId: string): boolean {
  return /gemini-3(?:\.\d+)?-pro/.test(modelId.toLowerCase());
}

function isGemini3FlashModel(modelId: string): boolean {
  return /gemini-3(?:\.\d+)?-flash/.test(modelId.toLowerCase());
}

function isGemini25ProModel(modelId: string): boolean {
  return /gemini-2\.5-pro/.test(modelId.toLowerCase());
}

function getGemini3ThinkingLevel(effort: string, modelId: string): ThinkingLevel {
  if (isGemini3ProModel(modelId)) {
    // Pro only supports LOW/MEDIUM/HIGH — floor minimal/low to LOW
    if (effort === "minimal" || effort === "low") return ThinkingLevel.LOW;
    if (effort === "medium") return ThinkingLevel.MEDIUM;
    return ThinkingLevel.HIGH;
  }
  return THINKING_LEVEL_MAP[effort];
}

function mapGeminiStopReason(reason: string): "stop" | "length" | "toolUse" | "error" {
  switch (reason) {
    case FinishReason.STOP:
      return "stop";
    case FinishReason.MAX_TOKENS:
      return "length";
    default:
      return "error";
  }
}

export function streamGemini(
  model: VertexModelConfig,
  context: Context,
  options?: StreamOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "google-generative-ai",
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
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      // Priority: config file > env var > model region > default
      const location = resolveLocation(model.region);
      const auth = getAuthConfig(location);

      // Create client with explicit API version (matches pi-mono)
      const client = new GoogleGenAI({
        vertexai: true,
        project: auth.projectId,
        location: auth.location,
        apiVersion: "v1",
      });

      // Convert messages with model ID for proper thinking/tool handling
      const contents = convertToGeminiMessages(context.messages, model.apiId);

      // Build config — only set temperature when explicitly provided.
      // The Vertex Gemini config shape is sprawling; use Record to avoid
      // fighting the SDK's incomplete typings.
      const config: Record<string, unknown> = {
        maxOutputTokens: options?.maxTokens || model.maxTokens,
        ...(options?.temperature !== undefined && { temperature: options.temperature }),
      };

      // Add system prompt if present
      if (context.systemPrompt) {
        config.systemInstruction = sanitizeText(context.systemPrompt);
      }

      // Add tools if present (using parametersJsonSchema for full JSON Schema support)
      if (context.tools && context.tools.length > 0) {
        config.tools = convertToolsForGemini(context.tools);
      }

      // Add thinking configuration (matches pi-mono's buildParams logic).
      if (model.reasoning) {
        if (options?.reasoning) {
          const effort = options.reasoning === "xhigh" ? "high" : options.reasoning;
          const isGemini3 = model.apiId.startsWith("gemini-3");
          const thinkingConfig: GeminiThinkingConfig = { includeThoughts: true };

          if (isGemini3) {
            // Gemini 3 Pro doesn't support MINIMAL; Flash models do.
            thinkingConfig.thinkingLevel = getGemini3ThinkingLevel(effort, model.apiId);
          } else {
            // Gemini 2.5 models use thinking budgets (token counts)
            const budgets: Record<string, number> = {
              minimal: 128,
              low: 2048,
              medium: 8192,
              high: model.apiId.includes("2.5-pro") ? 32768 : 24576,
            };
            thinkingConfig.thinkingBudget = budgets[effort] ?? 8192;
          }

          config.thinkingConfig = thinkingConfig;
        } else {
          // If no reasoning level is specified:
          // - For Gemini 3.x/3.5 models, omit thinkingConfig entirely so Vertex AI uses
          //   the model's native default level (e.g. MEDIUM for 3.5, HIGH for others).
          // - For Gemini 2.5 models, apply a healthy thinking budget floor (thinking is
          //   disabled by default on 2.5).
          const isGemini3 = model.apiId.startsWith("gemini-3");
          if (!isGemini3) {
            config.thinkingConfig = {
              includeThoughts: true,
              thinkingBudget: model.apiId.includes("2.5-pro") ? 2048 : 1024,
            };
          }
        }
      }

      // Pass abort signal to SDK for in-flight cancellation
      if (options?.signal) {
        if (options.signal.aborted) {
          throw new Error("Request aborted");
        }
        config.abortSignal = options.signal;
      }

      stream.push({ type: "start", partial: output });

      // Start streaming
      const response = await client.models.generateContentStream({
        model: model.apiId,
        contents,
        config,
      });

      // Track current content block for thinking/text transitions.
      type StreamingTextBlock = { type: "text"; text: string; textSignature?: string };
      type StreamingThinkingBlock = { type: "thinking"; thinking: string; thinkingSignature?: string };
      let currentBlock: StreamingTextBlock | StreamingThinkingBlock | null = null;
      let currentBlockType: "text" | "thinking" | null = null;

      for await (const chunk of response) {
        const candidate = chunk.candidates?.[0];

        // Process individual parts (handles thinking vs text detection)
        if (candidate?.content?.parts) {
          for (const part of candidate.content.parts) {
            if (part.text !== undefined) {
              const isThinking = part.thought === true;
              const targetType = isThinking ? "thinking" : "text";

              // Check if we need to transition to a new block
              if (currentBlockType !== targetType) {
                // End previous block (narrow on type for correct field access)
                if (currentBlock?.type === "text") {
                  stream.push({ type: "text_end", contentIndex: output.content.length - 1, content: currentBlock.text, partial: output });
                } else if (currentBlock?.type === "thinking") {
                  stream.push({ type: "thinking_end", contentIndex: output.content.length - 1, content: currentBlock.thinking, partial: output });
                }

                // Start new block
                if (isThinking) {
                  currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
                  output.content.push(currentBlock);
                  stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
                } else {
                  currentBlock = { type: "text", text: "", textSignature: undefined };
                  output.content.push(currentBlock);
                  stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
                }
                currentBlockType = targetType;
              }

              // Accumulate content (narrow on discriminant for type safety)
              if (currentBlock?.type === "thinking") {
                currentBlock.thinking += part.text;
                currentBlock.thinkingSignature = retainThoughtSignature(currentBlock.thinkingSignature, part.thoughtSignature);
                stream.push({ type: "thinking_delta", contentIndex: output.content.length - 1, delta: part.text, partial: output });
              } else if (currentBlock?.type === "text") {
                currentBlock.text += part.text;
                currentBlock.textSignature = retainThoughtSignature(currentBlock.textSignature, part.thoughtSignature);
                stream.push({ type: "text_delta", contentIndex: output.content.length - 1, delta: part.text, partial: output });
              }
            }

            if (part.functionCall) {
              // End current text/thinking block before tool call
              if (currentBlock?.type === "text") {
                stream.push({ type: "text_end", contentIndex: output.content.length - 1, content: currentBlock.text, partial: output });
              } else if (currentBlock?.type === "thinking") {
                stream.push({ type: "thinking_end", contentIndex: output.content.length - 1, content: currentBlock.thinking, partial: output });
              }
              if (currentBlock) {
                currentBlock = null;
                currentBlockType = null;
              }

              // Generate unique tool call ID with dedup (matches pi-mono pattern)
              const providedId = part.functionCall.id;
              const needsNewId =
                !providedId || output.content.some((b: any) => b.type === "toolCall" && b.id === providedId);
              const toolCallId = needsNewId
                ? `${part.functionCall.name}_${Date.now()}_${++toolCallCounter}`
                : providedId;

              const toolCall = {
                type: "toolCall" as const,
                id: toolCallId,
                name: part.functionCall.name || "",
                arguments: (part.functionCall.args as Record<string, unknown>) ?? {},
                ...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
              };

              output.content.push(toolCall);
              const idx = output.content.length - 1;
              stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
              stream.push({ type: "toolcall_delta", contentIndex: idx, delta: JSON.stringify(toolCall.arguments), partial: output });
              stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
            }
          }
        }

        // Handle finish reason
        if (candidate?.finishReason) {
          output.stopReason = mapGeminiStopReason(candidate.finishReason);
          if (candidate.finishReason === FinishReason.SAFETY) {
            output.errorMessage = "Content blocked by safety filters";
          }
          // Override to toolUse if any tool calls are present (matches pi-mono)
          if (output.content.some((b) => b.type === "toolCall")) {
            output.stopReason = "toolUse";
          }
        }

        // Update usage — include thoughtsTokenCount in output (matches pi-mono).
        // Subtract cached tokens from prompt to avoid double-counting in input cost.
        if (chunk.usageMetadata) {
          const meta = chunk.usageMetadata as {
            cachedContentTokenCount?: number;
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            thoughtsTokenCount?: number;
            totalTokenCount?: number;
          };
          const cachedTokens = meta.cachedContentTokenCount || 0;
          output.usage = {
            input: Math.max(0, (meta.promptTokenCount || 0) - cachedTokens),
            output: (meta.candidatesTokenCount || 0) + (meta.thoughtsTokenCount || 0),
            cacheRead: cachedTokens,
            cacheWrite: 0,
            totalTokens: meta.totalTokenCount || 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          };
          calculateCost(model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite, output.usage);
        }
      }

      // End final block
      if (currentBlock?.type === "text") {
        stream.push({ type: "text_end", contentIndex: output.content.length - 1, content: currentBlock.text, partial: output });
      } else if (currentBlock?.type === "thinking") {
        stream.push({ type: "thinking_end", contentIndex: output.content.length - 1, content: currentBlock.thinking, partial: output });
      }

      if (options?.signal?.aborted) {
        throw new Error("Request was aborted");
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
