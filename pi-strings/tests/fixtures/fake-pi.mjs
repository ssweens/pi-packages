#!/usr/bin/env node
import { createInterface } from "node:readline";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const stateFile = process.env.FAKE_PI_STATE_FILE;
function storedNonce() { try { return stateFile ? readFileSync(stateFile, "utf8") : ""; } catch { return ""; } }
process.stderr.write(`ARGS:${JSON.stringify(args)}\n`);
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let stateCalls = 0;
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.type === "get_state") {
    stateCalls += 1;
    if (process.env.FAKE_PI_OVERSIZED === "1") {
      process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: { payload: "x".repeat(16 * 1024 * 1024) } })}\n`);
      continue;
    }
    if (stateCalls === 2) {
      process.stdout.write(`${JSON.stringify({ type: "message_update", text: "line separator preserved" })}\n`);
    }
    const sessionFile = process.env.FAKE_PI_SESSION_FILE ?? "/tmp/pi-strings-fake-session.jsonl";
    try { writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "fake-session", cwd: process.cwd() })}\n`, { flag: "a" }); } catch {}
    process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: { sessionId: "fake-session", sessionFile, stateCalls, model: { provider: "fixture", id: "model" }, thinkingLevel: "off" } })}\n`);
  }
  if (request.type === "prompt") {
    process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "agent_start" })}\n`);
    const shouldWait = process.env.FAKE_PI_WAIT_FOR_STEER === "1" && (request.message.includes("phase one") || request.message.includes("WAIT"));
    if (request.message.startsWith("ASK_SELECT")) {
      process.stdout.write(`${JSON.stringify({ type: "extension_ui_request", id: "question-1", method: "select", title: "Choose a product", options: ["A", "B"] })}\n`);
      continue;
    }
    if (request.message.startsWith("SET:" ) && stateFile) writeFileSync(stateFile, request.message.slice(4));
    if (!shouldWait) {
      const responseText = request.message === "GET" ? `NONCE:${storedNonce()}` : "READY";
      process.stdout.write(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: responseText } })}\n`);
      process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
    }
  }
  if (request.type === "abort") {
    process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  }
  if (request.type === "steer") {
    process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: { accepted: true, message: request.message } })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `STEERED:${request.message}` } })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  }
  if (request.type === "extension_ui_response") {
    const answer = request.value ?? (request.confirmed ? "yes" : "no");
    process.stdout.write(`${JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: `ANSWER:${answer}` } })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "agent_settled" })}\n`);
  }
  if (request.type === "get_messages") {
    process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: { messages: [] } })}\n`);
  }
  if (request.type === "get_available_models" && process.env.FAKE_PI_IGNORE_MODELS !== "1") {
    process.stdout.write(`${JSON.stringify({ type: "response", id: request.id, command: request.type, success: true, data: { models: [{ provider: "fixture", id: "model", name: "Fixture" }] } })}\n`);
  }
  // The deadline test opts into ignoring get_available_models.
}
