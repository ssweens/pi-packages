/**
 * Fetch wrapper that strips SSE comment lines (e.g. ": keepalive") from
 * Vertex AI streaming responses.
 *
 * Vertex AI injects `: keepalive` comment lines into streamGenerateContent
 * SSE streams on slow responses (long thinking, large context). The
 * @google/genai SDK's stream parser does not handle SSE comments and fails
 * with errors like:
 *
 *   Error: Unexpected token ':', ": keepalive" is not valid JSON
 *   Error: Incomplete JSON segment at the end
 *
 * SSE comment lines are ignorable per spec, so dropping them is always safe.
 * Scoped strictly to Vertex streamGenerateContent URLs.
 */

let installed = false;

/** Returns true for lines that are SSE comments (start with ':'). */
function isSseComment(line: string): boolean {
  return line.startsWith(":");
}

/**
 * TransformStream that removes SSE comment lines from a byte stream while
 * preserving all other bytes (including event-delimiting blank lines).
 */
function createSseCommentStripper(): TransformStream<Uint8Array, Uint8Array> {
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
      // Strip \r\n / \n terminated comment lines; keep everything else.
      const content = line.endsWith("\r\n") ? line.slice(0, -2) : line.slice(0, -1);
      if (!isSseComment(content)) output += line;
      start = nl + 1;
    }
    pending = pending.substring(start);
    if (isFlush && pending.length > 0) {
      // Trailing data without a newline: drop only if it's a comment.
      if (!isSseComment(pending)) output += pending;
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

/**
 * Install a global fetch wrapper (once) that pipes Vertex streamGenerateContent
 * response bodies through the SSE comment stripper. All other requests pass
 * through untouched.
 */
export function installSseCommentFilter(): void {
  if (installed) return;
  installed = true;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    const url = requestUrl(input);
    if (!url.includes("streamGenerateContent") || !response.body) {
      return response;
    }
    return new Response(response.body.pipeThrough(createSseCommentStripper()), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}
