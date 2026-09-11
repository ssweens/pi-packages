/**
 * Fetch wrapper that strips keepalive noise from Vertex AI streaming responses.
 *
 * On slow streams (long prefill, hidden reasoning, large context) Vertex AI
 * injects keepalive lines that downstream SDK parsers choke on:
 *
 *   1. `: keepalive`         — SSE comment (Gemini streamGenerateContent).
 *      Spec-ignorable, but @google/genai's hand-rolled parser doesn't skip
 *      comments: "Unexpected token ':'..." / "Incomplete JSON segment at the
 *      end" / silently dropped data events.
 *
 *   2. `data: : keepalive`   — a *data* event whose payload is a pseudo-comment
 *      (MaaS /endpoints/openapi chat completions, observed with e.g. Grok).
 *      Not a comment at all, so even spec-correct SSE parsers (openai SDK)
 *      hand `: keepalive` to JSON.parse:
 *      "Unexpected token ':', \": keepalive\" is not valid JSON"
 *
 * Both are safe to drop: a valid JSON payload can never start with ':'.
 * Scoped to Vertex AI (aiplatform.googleapis.com) streaming URLs only.
 */

let installed = false;

/** True for SSE comments and for data events carrying a pseudo-comment payload. */
function isKeepaliveLine(line: string): boolean {
  if (line.startsWith(":")) return true; // SSE comment
  if (line.startsWith("data:")) {
    const payload = line.substring(5).trimStart();
    return payload.startsWith(":"); // e.g. "data: : keepalive"
  }
  return false;
}

/**
 * TransformStream that removes keepalive lines from a byte stream while
 * preserving all other bytes (including event-delimiting blank lines).
 */
function createKeepaliveStripper(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder("utf-8");
  const encoder = new TextEncoder();
  let pending = "";

  const filter = (text: string, isFlush: boolean): string => {
    pending += text;
    let output = "";
    let start = 0;
    while (true) {
      const nl = pending.indexOf("\n", start);
      if (nl === -1) break;
      const line = pending.substring(start, nl + 1);
      // Strip \r\n / \n terminated keepalive lines; keep everything else.
      const content = line.endsWith("\r\n") ? line.slice(0, -2) : line.slice(0, -1);
      if (!isKeepaliveLine(content)) output += line;
      start = nl + 1;
    }
    pending = pending.substring(start);
    if (isFlush && pending.length > 0) {
      // Trailing data without a newline: drop only if it's a keepalive.
      if (!isKeepaliveLine(pending)) output += pending;
      pending = "";
    }
    return output;
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const out = filter(decoder.decode(chunk, { stream: true }), false);
      if (out.length > 0) controller.enqueue(encoder.encode(out));
    },
    flush(controller) {
      const out = filter(decoder.decode(), true);
      if (out.length > 0) controller.enqueue(encoder.encode(out));
    },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Vertex AI streaming endpoints: Gemini SSE, MaaS chat completions, Anthropic raw predict. */
function isVertexStreamingUrl(url: string): boolean {
  if (!url.includes("aiplatform.googleapis.com")) return false;
  return (
    url.includes("streamGenerateContent") ||
    url.includes("/endpoints/openapi/") ||
    url.includes("streamRawPredict")
  );
}

/**
 * Install a global fetch wrapper (once) that pipes Vertex AI streaming
 * response bodies through the keepalive stripper. All other requests pass
 * through untouched.
 */
export function installSseCommentFilter(): void {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    if (!isVertexStreamingUrl(requestUrl(input)) || !response.body) {
      return response;
    }
    return new Response(response.body.pipeThrough(createKeepaliveStripper()), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
