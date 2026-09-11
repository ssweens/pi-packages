/**
 * Streaming handler dispatcher
 */

import type { VertexModelConfig, Context, StreamOptions } from "../types.js";
import type { AssistantMessageEventStream } from "@mariozechner/pi-ai";
import { streamGemini } from "./gemini.js";
import { streamMaaS } from "./maas.js";
import { installSseCommentFilter } from "./sse-comment-filter.js";

export function streamVertex(
  model: VertexModelConfig,
  context: Context,
  options?: StreamOptions
): AssistantMessageEventStream {
  // Vertex injects keepalive lines (": keepalive" / "data: : keepalive") on slow
  // streams; SDK parsers choke on them. Strip at the fetch layer (installed once).
  installSseCommentFilter();

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
