import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { AgentSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";

const stateArgument = process.argv[2];
if (!stateArgument) throw new Error("state path is required");
const statePath: string = stateArgument;
type FixtureState = Record<string, { nonce?: string }>;
async function load(): Promise<FixtureState> { try { return JSON.parse(await readFile(statePath, "utf8")) as FixtureState; } catch { return {}; } }
async function save(state: FixtureState): Promise<void> { await writeFile(statePath, JSON.stringify(state)); }

const waits = new Map<string, () => void>();
let connection: any;
const agent: any = {
  async initialize(params: any) {
    return { protocolVersion: params.protocolVersion === 1 ? 1 : 1, agentInfo: { name: "pi-strings-fixture", version: "1" }, authMethods: [], agentCapabilities: { loadSession: true, promptCapabilities: { image: false, audio: false, embeddedContext: false }, mcpCapabilities: { http: false, sse: false }, sessionCapabilities: { close: {} } } };
  },
  async newSession() {
    const sessionId = `fixture-${randomUUID()}`;
    const state = await load(); state[sessionId] = {}; await save(state);
    return { sessionId, configOptions: [], models: [], modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] } };
  },
  async loadSession(params: any) {
    const state = await load();
    if (!state[params.sessionId]) throw new Error(`unknown session ${params.sessionId}`);
    return { configOptions: [], models: [], modes: { currentModeId: "default", availableModes: [{ id: "default", name: "Default" }] } };
  },
  async prompt(params: any) {
    const text = params.prompt.map((block: any) => block.type === "text" ? block.text : "").join("");
    const state = await load(); const session = state[params.sessionId] ??= {};
    const set = /SET:([^\s]+)/.exec(text)?.[1]; if (set) { session.nonce = set; await save(state); }
    if (text.includes("WAIT")) await new Promise<void>(resolve => waits.set(params.sessionId, resolve));
    const output = text.includes("GET") ? `NONCE:${session.nonce ?? "missing"}` : text.includes("WAIT") ? "CANCELLED" : "READY";
    await connection.sessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: output } } });
    return { stopReason: text.includes("WAIT") ? "cancelled" : "end_turn" };
  },
  async cancel(params: any) { waits.get(params.sessionId)?.(); waits.delete(params.sessionId); },
  async closeSession() { return {}; },
  async authenticate() {},
  async setSessionMode() {},
  async setSessionConfigOption() { return {}; },
};

const input = new WritableStream<Uint8Array>({ write(chunk) { process.stdout.write(chunk); } });
const output = new ReadableStream<Uint8Array>({ start(controller) { process.stdin.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk))); process.stdin.on("end", () => controller.close()); } });
const stream = ndJsonStream(input, output);
new AgentSideConnection(conn => { connection = conn; return agent; }, stream);
process.stdin.resume();
