/**
 * Utility functions for pi-vertex extension
 */

import type { Message, MessageContent, TextContent, ToolCall, AssistantMessage } from "./types.js";

/**
 * Sanitize text by removing invalid surrogate pairs
 */
export function sanitizeText(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

/**
 * Convert messages to Gemini format
 */
export function convertToGeminiMessages(messages: Message[]): any[] {
  const result: any[] = [];
  
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
        result.push({ role: "user", parts });
      }
    } else if (msg.role === "assistant") {
      // Gemini doesn't have a separate assistant role in the same way
      // We'll handle this in the conversation history
      if (typeof msg.content === "string") {
        if (msg.content.trim()) {
          result.push({
            role: "model",
            parts: [{ text: sanitizeText(msg.content) }],
          });
        }
      }
    }
  }
  
  return result;
}

/**
 * Convert messages to OpenAI-compatible format (for Claude and MaaS)
 */
export function convertToOpenAIMessages(messages: Message[]): any[] {
  const result: any[] = [];
  
  for (const msg of messages) {
    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content.trim()) {
          result.push({
            role: "user",
            content: sanitizeText(msg.content),
          });
        }
      } else {
        const content = msg.content.map((item) => {
          if (item.type === "text") {
            return { type: "text", text: sanitizeText(item.text) };
          } else {
            return {
              type: "image_url",
              image_url: {
                url: `data:${item.mimeType};base64,${item.data}`,
              },
            };
          }
        });
        result.push({ role: "user", content });
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content.trim()) {
          result.push({
            role: "assistant",
            content: sanitizeText(msg.content),
          });
        }
      }
    } else if (msg.role === "system") {
      // System messages handled separately
    }
  }
  
  return result;
}

/**
 * Convert tools to OpenAI format
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
export function calculateCost(inputCost: number, outputCost: number, cacheReadCost: number, cacheWriteCost: number, usage: AssistantMessage["usage"]): void {
  usage.cost.input = (inputCost / 1000000) * usage.input;
  usage.cost.output = (outputCost / 1000000) * usage.output;
  usage.cost.cacheRead = (cacheReadCost / 1000000) * usage.cacheRead;
  usage.cost.cacheWrite = (cacheWriteCost / 1000000) * usage.cacheWrite;
  usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
