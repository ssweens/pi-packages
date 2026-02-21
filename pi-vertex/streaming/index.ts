/**
 * Streaming handler dispatcher
 */

import type { VertexModelConfig, Context, StreamOptions } from "../types.js";
import type { AssistantMessageEventStream } from "@mariozechner/pi-ai";
import { streamGemini } from "./gemini.js";
import { streamMaaS } from "./maas.js";

export function streamVertex(
  model: VertexModelConfig,
  context: Context,
  options?: StreamOptions
): AssistantMessageEventStream {
  switch (model.endpointType) {
    case "gemini":
      return streamGemini(model, context, options);
    case "maas":
      return streamMaaS(model, context, options);
    default:
      throw new Error(`Unknown endpoint type: ${(model as any).endpointType}`);
  }
}

export { streamGemini, streamMaaS };
