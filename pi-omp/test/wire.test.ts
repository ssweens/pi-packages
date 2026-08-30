import { describe, expect, test } from "bun:test";
import factory, { wire } from "../extensions/index";
import { DEFAULT_CONFIG, type PiOmpConfig } from "../src/config";

function makeStub() {
	const calls: { tools: string[]; commands: string[]; shortcuts: string[]; events: string[] } = {
		tools: [],
		commands: [],
		shortcuts: [],
		events: [],
	};
	const pi = {
		registerTool: (t: { name: string }) => void calls.tools.push(t.name),
		registerCommand: (n: string) => void calls.commands.push(n),
		registerShortcut: (_k: string, o: { description?: string }) => void calls.shortcuts.push(o.description ?? "x"),
		on: (e: string) => void calls.events.push(e),
		appendEntry: () => {},
		setModel: async () => true,
		setThinkingLevel: () => {},
		sendUserMessage: () => {},
		exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
	};
	return { calls, pi };
}

const ALL_ON: PiOmpConfig = {
	...DEFAULT_CONFIG,
	features: {
		persona: true,
		engineering: true,
		keywords: true,
		roles: true,
		todo: true,
		autoThinking: true,
		autoLearn: true,
		commit: true,
	},
};

describe("pi-omp wiring", () => {
	test("default config enables core, disables opt-in features", () => {
		const { calls, pi } = makeStub();
		wire(pi as never, DEFAULT_CONFIG);
		expect(calls.commands).toContain("personality");
		expect(calls.commands).toContain("role");
		expect(calls.commands).toContain("todo");
		expect(calls.tools).toContain("todo");
		expect(calls.commands).toContain("omp"); // settings always available
		expect(calls.events).toContain("before_agent_start");
		expect(calls.events).toContain("input");
		expect(calls.commands).not.toContain("commit");
	});

	test("all-on config enables every feature including commit, autothink, autolearn", () => {
		const { calls, pi } = makeStub();
		wire(pi as never, ALL_ON);
		for (const cmd of ["personality", "role", "todo", "commit", "omp"]) {
			expect(calls.commands).toContain(cmd);
		}
		expect(calls.events).toContain("agent_end");
	});

	test("persona off removes the /personality command", () => {
		const { calls, pi } = makeStub();
		const cfg = { ...DEFAULT_CONFIG, features: { ...DEFAULT_CONFIG.features, persona: false } };
		wire(pi as never, cfg);
		expect(calls.commands).not.toContain("personality");
		expect(calls.commands).toContain("omp"); // can be re-enabled from settings
	});

	test("default factory bootstraps and always wires the settings view", async () => {
		// Feature commands depend on the user's live config, but /omp is always wired,
		// so asserting it is deterministic (wire() gating is covered by the fixtures above).
		const { calls, pi } = makeStub();
		await factory(pi as never);
		expect(calls.commands).toContain("omp");
		expect(calls.commands.length).toBeGreaterThan(1); // other features wired too
	});
});

describe("todo reminder on agent_end", () => {
	// Session branch carrying one open todo so todoReminderText() returns text.
	const openTodoBranch = [
		{
			type: "custom",
			customType: "pi_omp.todo",
			data: { phases: [{ name: "Work", tasks: [{ content: "Finish the thing", status: "pending" }] }] },
		},
	];

	function makeReminderStub() {
		const sent: string[] = [];
		// pi allows multiple handlers per event — accumulate, don't overwrite.
		const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
		const pi = {
			registerTool: () => {},
			registerCommand: () => {},
			registerShortcut: () => {},
			on: (e: string, h: (event: unknown, ctx: unknown) => unknown) => {
				const list = handlers.get(e);
				if (list) list.push(h);
				else handlers.set(e, [h]);
			},
			appendEntry: () => {},
			setModel: async () => true,
			setThinkingLevel: () => {},
			sendUserMessage: (content: string) => void sent.push(content),
			exec: async () => ({ stdout: "", stderr: "", code: 0, killed: false }),
		};
		const ctx = { sessionManager: { getBranch: () => openTodoBranch } };
		const fire = (event: { type: string; messages: unknown[] }) => {
			for (const h of handlers.get(event.type) ?? []) h(event, ctx);
		};
		return { sent, handlers, pi, ctx, fire };
	}

	test("does NOT restart the agent when the last assistant turn was aborted (Escape)", () => {
		const { sent, handlers, pi, ctx, fire } = makeReminderStub();
		wire(pi as never, ALL_ON);
		expect(handlers.has("agent_end")).toBe(true);
		// Aborted assistant message — what pi delivers when the user hits Escape.
		fire({ type: "agent_end", messages: [{ role: "assistant", content: [], stopReason: "aborted" }] });
		expect(sent).toEqual([]);
	});

	test("sends the reminder on a natural stop with open todos", () => {
		const { sent, handlers, pi, fire } = makeReminderStub();
		wire(pi as never, ALL_ON);
		expect(handlers.has("agent_end")).toBe(true);
		fire({
			type: "agent_end",
			messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" }],
		});
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain("1 open todo item");
	});
});
