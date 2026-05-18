/**
 * Utility functions for pi-vertex extension
 *
 * Message conversion aligns with pi-mono's google-shared.ts to ensure consistent
 * handling of thinking blocks, tool calls, tool results, and thought signatures.
 */

import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolResultMessage,
} from "./types.js";

/**
 * Sanitize text by removing unpaired surrogate code units.
 * Valid surrogate pairs (emoji) are preserved.
 */
export function sanitizeText(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
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

type GeminiContent = {
  role: "user" | "model";
  parts: Array<Record<string, unknown>>;
};

function getGeminiMajorVersion(modelId: string): number | undefined {
  const match = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

function supportsMultimodalFunctionResponse(modelId: string): boolean {
  const majorVersion = getGeminiMajorVersion(modelId);
  if (majorVersion !== undefined) return majorVersion >= 3;
  return true;
}

/**
 * Convert messages to Gemini format.
 *
 * Handles the full pi-ai Message union: UserMessage, AssistantMessage (with
 * TextContent, ThinkingContent, ToolCall blocks), and ToolResultMessage.
 */
export function convertToGeminiMessages(messages: Message[], modelId: string): GeminiContent[] {
  const result: GeminiContent[] = [];
  const isGemini3 = modelId.startsWith("gemini-3");
  let pendingToolCalls: ToolCall[] = [];
  let existingToolResultIds = new Set<string>();

  const pushToolResult = (
    toolCallId: string,
    toolName: string,
    content: ToolResultMessage["content"],
    isError: boolean,
  ) => {
    const textContent = content.filter((c): c is TextContent => c.type === "text");
    const textResult = textContent.map((c) => c.text).join("\n");
    const imageContent = content.filter((c): c is ImageContent => c.type === "image");
    const hasText = textResult.length > 0;
    const hasImages = imageContent.length > 0;
    const responseValue = hasText
      ? sanitizeText(textResult)
      : hasImages
        ? "(see attached image)"
        : "";

    const imageParts = imageContent.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.data },
    }));

    const functionResponsePart: Record<string, unknown> = {
      functionResponse: {
        name: toolName,
        response: isError ? { error: responseValue } : { output: responseValue },
        ...(hasImages && supportsMultimodalFunctionResponse(modelId) ? { parts: imageParts } : {}),
      },
    };

    // Merge consecutive tool results into a single user turn (required by Gemini API)
    const lastContent = result[result.length - 1];
    if (lastContent?.role === "user" && lastContent.parts?.some((p) => "functionResponse" in p)) {
      lastContent.parts.push(functionResponsePart);
    } else {
      result.push({ role: "user", parts: [functionResponsePart] });
    }

    // Gemini < 3: carry image tool results as a separate user image turn
    if (hasImages && !supportsMultimodalFunctionResponse(modelId)) {
      result.push({
        role: "user",
        parts: [{ text: "Tool result image:" }, ...imageParts],
      });
    }
  };

  const flushMissingToolResults = () => {
    if (pendingToolCalls.length === 0) return;
    for (const toolCall of pendingToolCalls) {
      if (!existingToolResultIds.has(toolCall.id)) {
        pushToolResult(
          toolCall.id,
          toolCall.name,
          [{ type: "text", text: "No result provided" }],
          true,
        );
      }
    }
    pendingToolCalls = [];
    existingToolResultIds = new Set<string>();
  };

  for (const msg of messages) {
    if (msg.role === "user") {
      flushMissingToolResults();
      if (typeof msg.content === "string") {
        if (msg.content.trim()) {
          result.push({
            role: "user",
            parts: [{ text: sanitizeText(msg.content) }],
          });
        }
      } else {
        const parts: Array<Record<string, unknown>> = msg.content.map(
          (item: TextContent | ImageContent) => {
            if (item.type === "text") {
              return { text: sanitizeText(item.text) };
            }
            return { inlineData: { mimeType: item.mimeType, data: item.data } };
          },
        );
        if (parts.length > 0) {
          result.push({ role: "user", parts });
        }
      }
    } else if (msg.role === "assistant") {
      const assistantMsg = msg as AssistantMessage;
      flushMissingToolResults();

      // Skip errored/aborted messages — they're incomplete turns
      if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
        continue;
      }

      // Also require api match so cross-provider thought signatures aren't replayed
      const isSameProviderAndModel =
        assistantMsg.provider === "vertex" &&
        assistantMsg.api === "google-generative-ai" &&
        assistantMsg.model === modelId;
      const parts: Array<Record<string, unknown>> = [];
      const toolCalls: ToolCall[] = [];

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
          toolCalls.push(toolCallBlock);
          const thoughtSig = resolveThoughtSignature(isSameProviderAndModel, toolCallBlock.thoughtSignature);

          const part: Record<string, unknown> = {
            functionCall: {
              name: toolCallBlock.name,
              args: toolCallBlock.arguments ?? {},
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
      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = new Set<string>();
      }
    } else if (msg.role === "toolResult") {
      const toolResultMsg = msg as ToolResultMessage;
      existingToolResultIds.add(toolResultMsg.toolCallId);
      pushToolResult(
        toolResultMsg.toolCallId,
        toolResultMsg.toolName,
        toolResultMsg.content,
        toolResultMsg.isError,
      );
    }
  }

  flushMissingToolResults();

  return result;
}

/**
 * Convert tools to Gemini format using parametersJsonSchema (full JSON Schema support).
 * This differs from OpenAI format — Gemini uses functionDeclarations wrapped in an array.
 */
export function convertToolsForGemini(
  tools: Tool[],
): Array<{ functionDeclarations: Array<Record<string, unknown>> }> | undefined {
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
export function convertTools(tools: Tool[]): Array<Record<string, unknown>> {
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
