/** The keepalive filter must also give up on a Vertex stream that never starts. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

process.env.PI_VERTEX_FIRST_BYTE_TIMEOUT_MS = "300";
const { installSseCommentFilter } = await import("../streaming/sse-comment-filter.ts");

const open = new Set();
const server = createServer(async (req, res) => {
	open.add(res); res.on("close", () => open.delete(res));
	res.writeHead(200, { "content-type": "text/event-stream" });
	res.flushHeaders(); // 200 arrives, body may not: exactly what the failing deployment does
	if (req.url.endsWith("/dead")) return; // accepted, then nothing: the glm-5.2 failure shape
	if (req.url.endsWith("/slow-start")) { await sleep(150); }
	res.write(": keepalive\n");
	await sleep(500); // a mid-stream gap longer than the first-byte budget must survive
	res.write(`data: {"choices":[{"delta":{"content":"LATE-BUT-ALIVE"}}]}\n\n`);
	res.end("data: [DONE]\n\n");
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
const { port } = server.address();
// The wrapper matches Vertex streaming URLs by substring, so a local URL carrying those
// markers in its path exercises the real wrapper without DNS or credentials.
const base = `http://127.0.0.1:${port}/aiplatform.googleapis.com/endpoints/openapi`;
installSseCommentFilter();

async function read(path) {
	const response = await fetch(`${base}${path}`);
	let body = "";
	for await (const chunk of response.body) body += new TextDecoder().decode(chunk);
	return body;
}

const started = Date.now();
await assert.rejects(read("/dead"), /sent no data for 0s after accepting this streaming request/);
const elapsed = Date.now() - started;
assert(elapsed < 3000, `a dead stream must fail fast, took ${elapsed}ms`);
assert(elapsed >= 300, `must wait its budget first, gave up after ${elapsed}ms`);

for (const path of ["/live", "/slow-start"]) {
	const body = await read(path);
	assert.match(body, /LATE-BUT-ALIVE/, `${path} must survive a mid-stream gap longer than the first-byte budget`);
	assert.doesNotMatch(body, /keepalive/, `${path} must still have keepalive lines stripped`);
}

for (const res of open) res.destroy();
server.close(); await once(server, "close");
console.log("PASS first-byte timeout fails a dead Vertex stream fast and leaves live ones alone");
