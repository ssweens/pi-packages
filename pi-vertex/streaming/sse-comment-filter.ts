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

/**
 * Some Vertex deployments accept a streaming request, answer 200, and then send nothing at
 * all \u2014 observed on `zai-org/glm-5.2-maas` (global) for roughly half of all requests, while
 * glm-4.7 and deepseek on the same endpoint and credentials never did it. undici only gives up
 * after its 300 s body timeout, so every dead request costs five minutes before a retry starts.
 *
 * Bound the wait for the *first* byte only. A stream that has begun is left alone: a genuinely
 * slow one keeps the socket alive with keepalive lines (stripped further down, but counted here
 * because this sits upstream of the stripper), and mid-stream gaps stay undici's business.
 */
const FIRST_BYTE_TIMEOUT_MS = Number(process.env.PI_VERTEX_FIRST_BYTE_TIMEOUT_MS ?? 90_000);

function withFirstByteTimeout(body: ReadableStream<Uint8Array>, url: string, timeoutMs: number): ReadableStream<Uint8Array> {
  if (!(timeoutMs > 0)) return body;
  const reader = body.getReader();
  let started = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (started) {
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
        return;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const first = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`Vertex sent no data for ${Math.round(timeoutMs / 1000)}s after accepting this streaming request (${url}). The endpoint is not producing output; retry or use another offering. Raise PI_VERTEX_FIRST_BYTE_TIMEOUT_MS to wait longer, 0 to disable.`)),
              timeoutMs,
            );
          }),
        ]);
        started = true;
        if (first.done) controller.close();
        else controller.enqueue(first.value);
      } catch (error) {
        await reader.cancel(error).catch(() => {});
        controller.error(error);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
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
    const url = requestUrl(input);
    if (!isVertexStreamingUrl(url) || !response.body) {
      return response;
    }
    const live = withFirstByteTimeout(response.body, url, FIRST_BYTE_TIMEOUT_MS);
    return new Response(live.pipeThrough(createKeepaliveStripper()), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
