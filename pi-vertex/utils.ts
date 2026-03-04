/**
 * Utility functions for pi-vertex extension
 *
 * Message conversion aligns with pi-mono's google-shared.ts to ensure consistent
 * handling of thinking blocks, tool calls, tool results, and thought signatures.
 */

import type {
  AssistantMessage,
  Message,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from "./types.js";

/**
 * Sanitize text by removing invalid surrogate pairs
 */
export function sanitizeText(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

// --- Thought signature helpers (matching pi-mono google-shared.ts) ---

const base64SignaturePattern = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidThoughtSignature(signature: string | undefined): boolean {
  if (!signature) return false;
  if (signature.length % 4 !== 0) return false;
  return base64SignaturePattern.test(signature);
}

function resolveThoughtSignature(
  isSameProviderAndModel: boolean,
  signature: string | undefined,
): string | undefined {
  return isSameProviderAndModel && isValidThoughtSignature(signature) ? signature : undefined;
}

/**
 * Preserve the last non-empty thought signature during streaming.
 * Some backends only send the signature on the first delta.
 */
export function retainThoughtSignature(
  existing: string | undefined,
  incoming: string | undefined,
): string | undefined {
  if (typeof incoming === "string" && incoming.length > 0) return incoming;
  return existing;
}

/**
 * Whether a model requires explicit tool call IDs in functionCall parts.
 * Claude and GPT-OSS models on Vertex require them; native Gemini models don't.
 */
function requiresToolCallId(modelId: string): boolean {
  return modelId.startsWith("claude-") || modelId.startsWith("gpt-oss-");
}

/**
 * Convert messages to Gemini format.
 *
 * Handles the full pi-ai Message union: UserMessage, AssistantMessage (with
 * TextContent, ThinkingContent, ToolCall blocks), and ToolResultMessage.
 */
export function convertToGeminiMessages(messages: Message[], modelId: string): any[] {
  const result: any[] = [];
  const isGemini3 = modelId.startsWith("gemini-3");

  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content.trim()) {
          result.push({
            role: "user",
            parts: [{ text: sanitizeText(msg.content) }],
          });
        }
      } else {
        const parts = msg.content.map((item) => {
          if (item.type === "text") {
            return { text: sanitizeText(item.text) };
          } else {
            return {
              inlineData: {
                mimeType: item.mimeType,
                data: item.data,
              },
            };
          }
        });
        if (parts.length > 0) {
          result.push({ role: "user", parts });
        }
      }
    } else if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;

      // Skip errored/aborted messages — they're incomplete turns
      if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
        continue;
      }

      const isSameProviderAndModel =
        assistantMsg.provider === "vertex" && assistantMsg.model === modelId;
      const parts: any[] = [];

      for (const block of assistantMsg.content) {
        if (block.type === "text") {
          const textBlock = block as TextContent;
          if (!textBlock.text || textBlock.text.trim() === "") continue;
          const thoughtSig = resolveThoughtSignature(isSameProviderAndModel, textBlock.textSignature);
          parts.push({
            text: sanitizeText(textBlock.text),
            ...(thoughtSig && { thoughtSignature: thoughtSig }),
          });
        } else if (block.type === "thinking") {
          const thinkingBlock = block as ThinkingContent;
          // Skip redacted thinking — only the signature matters, handled by other blocks
          if (thinkingBlock.redacted) continue;
          if (!thinkingBlock.thinking || thinkingBlock.thinking.trim() === "") continue;

          if (isSameProviderAndModel) {
            const thoughtSig = resolveThoughtSignature(true, thinkingBlock.thinkingSignature);
            parts.push({
              thought: true,
              text: sanitizeText(thinkingBlock.thinking),
              ...(thoughtSig && { thoughtSignature: thoughtSig }),
            });
          } else {
            // Cross-provider: convert thinking to plain text (no tags to avoid model mimicry)
            parts.push({ text: sanitizeText(thinkingBlock.thinking) });
          }
        } else if (block.type === "toolCall") {
          const toolCallBlock = block as ToolCall;
          const thoughtSig = resolveThoughtSignature(isSameProviderAndModel, toolCallBlock.thoughtSignature);

          const part: any = {
            functionCall: {
              name: toolCallBlock.name,
              args: toolCallBlock.arguments ?? {},
              ...(requiresToolCallId(modelId) ? { id: toolCallBlock.id } : {}),
            },
          };
          if (thoughtSig) {
            part.thoughtSignature = thoughtSig;
          } else if (isGemini3) {
            // Gemini 3 requires thoughtSignature on all functionCall parts.
            // For cross-provider tool calls (or rare same-provider calls without signatures),
            // use the documented escape hatch to bypass validation.
            // See: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/thought-signatures
            part.thoughtSignature = "skip_thought_signature_validator";
          }
          parts.push(part);
        }
      }

      if (parts.length > 0) {
        result.push({ role: "model", parts });
      }
    } else if (msg.role === "toolResult") {
      const toolResultMsg = msg as ToolResultMessage;
      const textContent = toolResultMsg.content.filter((c) => c.type === "text") as TextContent[];
      const textResult = textContent.map((c) => c.text).join("\n");
      const responseValue = textResult || "";

      const includeId = requiresToolCallId(modelId);
      const functionResponsePart: any = {
        functionResponse: {
          name: toolResultMsg.toolName,
          response: toolResultMsg.isError ? { error: responseValue } : { output: responseValue },
          ...(includeId ? { id: toolResultMsg.toolCallId } : {}),
        },
      };

      // Merge consecutive tool results into a single user turn (required by Gemini API)
      const lastContent = result[result.length - 1];
      if (lastContent?.role === "user" && lastContent.parts?.some((p: any) => p.functionResponse)) {
        lastContent.parts.push(functionResponsePart);
      } else {
        result.push({ role: "user", parts: [functionResponsePart] });
      }
    }
  }

  return result;
}

/**
 * Convert tools to Gemini format using parametersJsonSchema (full JSON Schema support).
 * This differs from OpenAI format — Gemini uses functionDeclarations wrapped in an array.
 */
export function convertToolsForGemini(tools: any[]): any[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.parameters,
      })),
    },
  ];
}

/**
 * Convert tools to OpenAI format (for Claude and MaaS models)
 */
export function convertTools(tools: any[]): any[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Parse SSE (Server-Sent Events) stream
 */
export async function* parseSSEStream(response: Response): AsyncGenerator<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const data = trimmed.slice(6);
          if (data === "[DONE]") return;
          yield data;
        }
      }
    }

    // Process remaining buffer
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data: ")) {
      const data = trimmed.slice(6);
      if (data !== "[DONE]") {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Map stop reason to standard format
 */
export function mapStopReason(reason: string): "stop" | "length" | "toolUse" | "error" {
  switch (reason) {
    case "stop":
    case "end_turn":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "tool_calls":
    case "tool_use":
      return "toolUse";
    default:
      return "error";
  }
}

/**
 * Calculate cost based on usage and model cost config
 */
export function calculateCost(
  inputCost: number,
  outputCost: number,
  cacheReadCost: number,
  cacheWriteCost: number,
  usage: AssistantMessage["usage"],
): void {
  usage.cost.input = (inputCost / 1000000) * usage.input;
  usage.cost.output = (outputCost / 1000000) * usage.output;
  usage.cost.cacheRead = (cacheReadCost / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (cacheWriteCost / 1000000) * usage.cacheWrite;
  usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
