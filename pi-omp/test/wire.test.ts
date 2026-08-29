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
