/**
 * Gemini streaming handler using @google/genai SDK
 */

import { GoogleGenAI } from "@google/genai";
import type { VertexModelConfig, Context, StreamOptions } from "../types.js";
import { getAuthConfig, resolveLocation } from "../auth.js";
import { sanitizeText, convertToGeminiMessages, calculateCost } from "../utils.js";
import { createAssistantMessageEventStream, type AssistantMessageEventStream, type AssistantMessage } from "@mariozechner/pi-ai";

export function streamGemini(
  model: VertexModelConfig,
  context: Context,
  options?: StreamOptions
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

      // Create client
      const client = new GoogleGenAI({
        vertexai: true,
        project: auth.projectId,
        location: auth.location,
      });
      
      // Convert messages
      const contents = convertToGeminiMessages(context.messages);
      
      // Build config
      const config: any = {
        maxOutputTokens: options?.maxTokens || Math.floor(model.maxTokens / 2),
        temperature: options?.temperature ?? 0.7,
      };
      
      // Add system prompt if present
      if (context.systemPrompt) {
        config.systemInstruction = sanitizeText(context.systemPrompt);
      }
      
      // Add tools if present
      if (context.tools && context.tools.length > 0) {
        config.tools = [
          {
            functionDeclarations: context.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            })),
          },
        ];
      }
      
      stream.push({ type: "start", partial: output });
      
      // Start streaming
      const response = await client.models.generateContentStream({
        model: model.apiId,
        contents,
        config,
      });
      
      let textContent = "";
      let textIndex = 0;
      
      for await (const chunk of response) {
        if (options?.signal?.aborted) {
          throw new Error("Request was aborted");
        }
        
        // Update usage
        if (chunk.usageMetadata) {
          output.usage.input = chunk.usageMetadata.promptTokenCount || output.usage.input;
          output.usage.output = chunk.usageMetadata.candidatesTokenCount || output.usage.output;
          output.usage.totalTokens = chunk.usageMetadata.totalTokenCount || 
            (output.usage.input + output.usage.output);
          calculateCost(model.cost.input, model.cost.output, model.cost.cacheRead, model.cost.cacheWrite, output.usage);
        }
        
        // Handle text
        const text = chunk.text;
        if (text) {
          if (!textContent) {
            // First text chunk
            output.content.push({ type: "text", text: "" });
            textIndex = output.content.length - 1;
            stream.push({ type: "text_start", contentIndex: textIndex, partial: output });
          }
          textContent += text;
          (output.content[textIndex] as any).text = textContent;
          stream.push({ type: "text_delta", contentIndex: textIndex, delta: text, partial: output });
        }
        
        // Handle function calls (tools)
        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          for (const call of chunk.functionCalls) {
            output.content.push({
              type: "toolCall",
              id: call.id || `call_${Date.now()}`,
              name: call.name,
              arguments: call.args || {},
            });
            stream.push({
              type: "toolcall_end",
              contentIndex: output.content.length - 1,
              toolCall: output.content[output.content.length - 1] as any,
              partial: output,
            });
          }
        }
        
        // Handle finish reason
        if (chunk.candidates && chunk.candidates[0]?.finishReason) {
          const reason = chunk.candidates[0].finishReason;
          if (reason === "STOP") {
            output.stopReason = "stop";
          } else if (reason === "MAX_TOKENS") {
            output.stopReason = "length";
          } else if (reason === "SAFETY") {
            output.stopReason = "error";
            output.errorMessage = "Content blocked by safety filters";
          }
        }
      }
      
      // End text if we had any
      if (textContent) {
        stream.push({ type: "text_end", contentIndex: textIndex, content: textContent, partial: output });
      }
      
      stream.push({ type: "done", reason: output.stopReason as any, message: output });
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
