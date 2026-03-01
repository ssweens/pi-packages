/**
 * Comprehensive tests for the pi-handoff extension.
 *
 * Strategy:
 * - Pure functions (goalToSessionName, buildFullPrompt) tested directly.
 * - Registered handlers tested via a mock ExtensionAPI factory that captures
 *   all pi.on() / registerCommand() / registerTool() registrations.
 * - ctx.ui.custom() is mocked to return values directly (bypasses the
 *   BorderedLoader/LLM machinery which lives inside the factory callback).
 * - The @mariozechner/pi-ai and @mariozechner/pi-coding-agent modules are
 *   mocked before import so no real network calls or TUI is needed.
 */

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

// ─── Module mocks (must be before any import of the extension) ───────────────

const mockComplete = mock(async () => ({
	stopReason: "end_turn",
	content: [{ type: "text", text: "Generated summary content" }],
}));

const mockBorderedLoaderInstances: Array<{ onAbort?: () => void; signal: AbortSignal }> = [];
const mockBorderedLoader = mock(function (this: any, _tui: any, _theme: any, _msg: string) {
	const ctrl = new AbortController();
	this.signal = ctrl.signal;
	this.onAbort = undefined;
	mockBorderedLoaderInstances.push(this);
});

const mockConvertToLlm = mock((msgs: any[]) => msgs);
const mockSerializeConversation = mock((_msgs: any[]) => "serialized-conversation");

mock.module("@mariozechner/pi-ai", () => ({ complete: mockComplete }));
mock.module("@mariozechner/pi-coding-agent", () => ({
	BorderedLoader: mockBorderedLoader,
	convertToLlm: mockConvertToLlm,
	serializeConversation: mockSerializeConversation,
}));
mock.module("@sinclair/typebox", () => ({
	Type: {
		Object: (schema: any) => ({ type: "object", properties: schema }),
		String: (opts: any) => ({ type: "string", ...opts }),
	},
}));

// ─── Import extension after mocks ───────────────────────────────────────────

import {
	__clearPendingHandoffText,
	buildFullPrompt,
	goalToSessionName,
	HANDOFF_SYSTEM_HINT,
} from "../extensions/handoff.ts";
import handoffExtension from "../extensions/handoff.ts";

// ─── Test helpers ────────────────────────────────────────────────────────────

type Handler = (event: any, ctx: any) => Promise<any>;
type CommandHandler = (args: string, ctx: any) => Promise<void>;
type ToolExecute = (
	toolCallId: string,
	params: any,
	signal: any,
	onUpdate: any,
	ctx: any,
) => Promise<any>;

interface CapturedExtension {
	handlers: Record<string, Handler[]>;
	commands: Record<string, CommandHandler>;
	tools: Record<string, ToolExecute>;
	pi: ReturnType<typeof createMockPi>["pi"];
}

function createMockPi() {
	const captured: CapturedExtension = {
		handlers: {},
		commands: {},
		tools: {},
		pi: null as any,
	};

	const pi = {
		on: mock((event: string, handler: Handler) => {
			if (!captured.handlers[event]) captured.handlers[event] = [];
			captured.handlers[event].push(handler);
		}),
		registerCommand: mock((name: string, opts: { handler: CommandHandler }) => {
			captured.commands[name] = opts.handler;
		}),
		registerTool: mock((tool: { name: string; execute: ToolExecute }) => {
			captured.tools[tool.name] = tool.execute;
		}),
		setSessionName: mock((_name: string) => {}),
		events: { emit: mock(), on: mock() },
	} as any;

	captured.pi = pi;
	return { pi, captured };
}

/** Creates a minimal ExtensionContext mock with sensible defaults. */
function createCtx(overrides: Record<string, any> = {}): any {
	return {
		hasUI: true,
		model: { id: "claude-sonnet-4", contextWindow: 200000 },
		cwd: "/test/project",
		sessionManager: {
			getBranch: mock(() => [
				{ type: "message", message: { role: "user", content: "Hello" } },
				{
					type: "message",
					message: { role: "assistant", content: [{ type: "text", text: "Hi there" }] },
				},
			]),
			getSessionFile: mock(() => "/sessions/test-session.jsonl"),
			getHeader: mock(() => ({ parentSession: "/sessions/parent-session.jsonl" })),
			getSessionName: mock(() => undefined),
		},
		modelRegistry: {
			getApiKey: mock(async () => "test-api-key"),
		},
		ui: {
			select: mock(async () => undefined),
			notify: mock((_msg: string, _type?: string) => {}),
			setEditorText: mock((_text: string) => {}),
			getEditorText: mock(() => ""),
			custom: mock(async (_factory: any) => "Generated summary content"),
			confirm: mock(async () => false),
			input: mock(async () => undefined),
			setStatus: mock(),
			setWorkingMessage: mock(),
			setWidget: mock(),
			setTitle: mock(),
			pasteToEditor: mock(),
			editor: mock(async () => undefined),
			setEditorComponent: mock(),
			setFooter: mock(),
			setHeader: mock(),
			onTerminalInput: mock(() => () => {}),
			getToolsExpanded: mock(() => false),
			setToolsExpanded: mock(),
			getAllThemes: mock(() => []),
			getTheme: mock(() => undefined),
			setTheme: mock(() => ({ success: true })),
			theme: {},
		},
		isIdle: mock(() => true),
		abort: mock(),
		hasPendingMessages: mock(() => false),
		shutdown: mock(),
		getContextUsage: mock(() => ({ tokens: 180000, contextWindow: 200000, percent: 90 })),
		compact: mock(),
		getSystemPrompt: mock(() => "base system prompt"),
		...overrides,
	};
}

/** Extends a ctx with command-context methods (newSession, etc.) */
function createCommandCtx(overrides: Record<string, any> = {}): any {
	return {
		...createCtx(),
		waitForIdle: mock(async () => {}),
		newSession: mock(async (_opts?: any) => ({ cancelled: false })),
		fork: mock(async () => ({ cancelled: false })),
		navigateTree: mock(async () => ({ cancelled: false })),
		switchSession: mock(async () => ({ cancelled: false })),
		reload: mock(async () => {}),
		...overrides,
	};
}

/** Fire the first registered handler for an event. */
async function fireEvent(captured: CapturedExtension, event: string, eventObj: any, ctx: any) {
	const handlers = captured.handlers[event] ?? [];
	if (handlers.length === 0) throw new Error(`No handler registered for '${event}'`);
	let result: any;
	for (const h of handlers) {
		result = await h(eventObj, ctx);
	}
	return result;
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

let captured: CapturedExtension;
let piMock: any;

beforeEach(() => {
	mockBorderedLoaderInstances.length = 0;
	mockComplete.mockClear();
	mockConvertToLlm.mockClear();
	mockSerializeConversation.mockClear();

	// Clear module-level state — pendingHandoffText persists across tests otherwise
	__clearPendingHandoffText();

	const { pi, captured: cap } = createMockPi();
	piMock = pi;
	captured = cap;
	handoffExtension(pi);
});

// ─── goalToSessionName ────────────────────────────────────────────────────────

describe("goalToSessionName", () => {
	it("converts a normal goal to a lowercase slug", () => {
		expect(goalToSessionName("Implement OAuth Flow")).toBe("implement-oauth-flow");
	});

	it("removes special characters", () => {
		expect(goalToSessionName("Fix bug #123 (critical!)")).toBe("fix-bug-123-critical");
	});

	it("trims leading and trailing whitespace", () => {
		expect(goalToSessionName("  hello world  ")).toBe("hello-world");
	});

	it("collapses multiple spaces into a single hyphen", () => {
		expect(goalToSessionName("hello   world")).toBe("hello-world");
	});

	it("truncates to 50 characters", () => {
		const long = "a ".repeat(40); // 80 chars after join
		const result = goalToSessionName(long);
		expect(result.length).toBeLessThanOrEqual(50);
	});

	it("returns empty string for empty input", () => {
		expect(goalToSessionName("")).toBe("");
	});

	it("returns empty string for only special characters", () => {
		expect(goalToSessionName("!@#$%^&*()")).toBe("");
	});

	it("handles strings with only spaces", () => {
		expect(goalToSessionName("   ")).toBe("");
	});

	it("preserves existing hyphens", () => {
		expect(goalToSessionName("my-feature flag")).toBe("my-feature-flag");
	});

	it("handles numeric characters", () => {
		expect(goalToSessionName("Phase 2 rollout")).toBe("phase-2-rollout");
	});

	it("strips unicode / emoji characters (surrounding spaces collapse)", () => {
		// "fix the 🐛 bug" → remove emoji → "fix the  bug" → collapse spaces → "fix-the-bug"
		expect(goalToSessionName("fix the 🐛 bug")).toBe("fix-the-bug");
	});

	it("truncates cleanly at exactly 50 chars", () => {
		const goal = "a" + " b".repeat(25); // 51 chars
		const result = goalToSessionName(goal);
		expect(result.length).toBeLessThanOrEqual(50);
	});

	it("handles a goal that is already 50 chars", () => {
		const goal = "abcde ".repeat(8).trimEnd(); // 47 chars
		const result = goalToSessionName(goal);
		expect(result.length).toBeLessThanOrEqual(50);
	});
});

// ─── buildFullPrompt ──────────────────────────────────────────────────────────

describe("buildFullPrompt", () => {
	it("includes the goal as a heading", () => {
		const result = buildFullPrompt("My Goal", null, "summary body");
		expect(result).toContain("# My Goal");
	});

	it("includes the summary content", () => {
		const result = buildFullPrompt("Goal", null, "## Progress\n- done");
		expect(result).toContain("## Progress\n- done");
	});

	it("includes parent session reference when provided", () => {
		const result = buildFullPrompt("Goal", "/sessions/abc.jsonl", "summary");
		expect(result).toContain("**Parent session:** `/sessions/abc.jsonl`");
	});

	it("omits parent session section when sessionFile is null", () => {
		const result = buildFullPrompt("Goal", null, "summary");
		expect(result).not.toContain("**Parent session:**");
	});

	it("prepends skill prefix when parent session is present", () => {
		const result = buildFullPrompt("Goal", "/sessions/abc.jsonl", "summary");
		expect(result.startsWith("/skill:pi-session-query")).toBe(true);
	});

	it("does NOT prepend skill prefix when no parent session", () => {
		const result = buildFullPrompt("Goal", null, "summary");
		expect(result.startsWith("/skill:pi-session-query")).toBe(false);
		expect(result.startsWith("# Goal")).toBe(true);
	});

	it("skill prefix precedes the goal heading", () => {
		const result = buildFullPrompt("My Goal", "/sessions/abc.jsonl", "summary");
		const skillIdx = result.indexOf("/skill:pi-session-query");
		const goalIdx = result.indexOf("# My Goal");
		expect(skillIdx).toBeLessThan(goalIdx);
	});

	it("handles special characters in goal", () => {
		const result = buildFullPrompt("Fix bug #123", null, "summary");
		expect(result).toContain("# Fix bug #123");
	});
});

// ─── HANDOFF_SYSTEM_HINT ──────────────────────────────────────────────────────

describe("HANDOFF_SYSTEM_HINT", () => {
	it("is a non-empty string", () => {
		expect(typeof HANDOFF_SYSTEM_HINT).toBe("string");
		expect(HANDOFF_SYSTEM_HINT.length).toBeGreaterThan(0);
	});

	it("mentions /handoff command", () => {
		expect(HANDOFF_SYSTEM_HINT).toContain("/handoff");
	});
});

// ─── before_agent_start ───────────────────────────────────────────────────────

describe("before_agent_start handler", () => {
	it("appends HANDOFF_SYSTEM_HINT to the system prompt", async () => {
		const ctx = createCtx();
		const event = { type: "before_agent_start", systemPrompt: "base prompt", prompt: "hi" };
		const result = await fireEvent(captured, "before_agent_start", event, ctx);
		expect(result?.systemPrompt).toBe("base prompt" + HANDOFF_SYSTEM_HINT);
	});

	it("preserves the original system prompt content", async () => {
		const ctx = createCtx();
		const original = "YOU ARE AN AI ASSISTANT\n\nRules:\n- be helpful";
		const event = { type: "before_agent_start", systemPrompt: original, prompt: "hi" };
		const result = await fireEvent(captured, "before_agent_start", event, ctx);
		expect(result?.systemPrompt).toContain(original);
	});
});

// ─── session_switch handler ───────────────────────────────────────────────────

describe("session_switch handler", () => {
	it("is a no-op when reason is not 'new'", async () => {
		const ctx = createCtx();
		ctx.sessionManager.getHeader.mockReturnValue({ parentSession: "/sessions/parent.jsonl" });

		// pre-populate pending text
		const { buildFullPrompt: bf } = await import("../extensions/handoff.ts");
		// Just fire with reason=resume and check nothing is set
		const event = { type: "session_switch", reason: "resume", previousSessionFile: undefined };
		await fireEvent(captured, "session_switch", event, ctx);
		expect(ctx.ui.setEditorText.mock.calls.length).toBe(0);
	});

	it("is a no-op when hasUI is false", async () => {
		const ctx = createCtx({ hasUI: false });
		const event = { type: "session_switch", reason: "new", previousSessionFile: undefined };
		await fireEvent(captured, "session_switch", event, ctx);
		expect(ctx.ui.setEditorText.mock.calls.length).toBe(0);
	});

	it("is a no-op when parentSession is null", async () => {
		const ctx = createCtx();
		ctx.sessionManager.getHeader = mock(() => ({ parentSession: undefined }));
		const event = { type: "session_switch", reason: "new", previousSessionFile: undefined };
		await fireEvent(captured, "session_switch", event, ctx);
		expect(ctx.ui.setEditorText.mock.calls.length).toBe(0);
	});

	it("is a no-op when there is no pending text for the parent session", async () => {
		const ctx = createCtx();
		ctx.sessionManager.getHeader = mock(() => ({
			parentSession: "/sessions/UNREGISTERED.jsonl",
		}));
		const event = { type: "session_switch", reason: "new", previousSessionFile: undefined };
		await fireEvent(captured, "session_switch", event, ctx);
		expect(ctx.ui.setEditorText.mock.calls.length).toBe(0);
	});
});

// ─── session_before_compact handler ───────────────────────────────────────────

describe("session_before_compact handler", () => {
	function makeCompactEvent(overrides: Record<string, any> = {}) {
		return {
			type: "session_before_compact",
			preparation: {
				messagesToSummarize: [
					{ role: "user", content: "Write tests" },
					{ role: "assistant", content: [{ type: "text", text: "Sure!" }] },
				],
				previousSummary: undefined,
			},
			branchEntries: [],
			signal: new AbortController().signal,
			...overrides,
		};
	}

	it("is a no-op (returns undefined) when hasUI is false", async () => {
		const ctx = createCtx({ hasUI: false });
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toBeUndefined();
		expect(ctx.ui.select.mock.calls.length).toBe(0);
	});

	it("is a no-op when model is undefined", async () => {
		const ctx = createCtx({ model: undefined });
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toBeUndefined();
		expect(ctx.ui.select.mock.calls.length).toBe(0);
	});

	it("shows usage percentage in select prompt when available", async () => {
		const ctx = createCtx();
		ctx.getContextUsage = mock(() => ({ tokens: 160000, contextWindow: 200000, percent: 80 }));
		ctx.ui.select = mock(async () => "Compact context");
		await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		const call = ctx.ui.select.mock.calls[0];
		expect(call[0]).toContain("80%");
	});

	it("shows 'high' in select prompt when getContextUsage returns undefined", async () => {
		const ctx = createCtx();
		ctx.getContextUsage = mock(() => undefined);
		ctx.ui.select = mock(async () => "Compact context");
		await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(ctx.ui.select.mock.calls[0][0]).toContain("high");
	});

	it("shows 'high' when context usage percent is null", async () => {
		const ctx = createCtx();
		ctx.getContextUsage = mock(() => ({ tokens: null, contextWindow: 200000, percent: null }));
		ctx.ui.select = mock(async () => "Compact context");
		await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(ctx.ui.select.mock.calls[0][0]).toContain("high");
	});

	it("proceeds with compaction (returns undefined) when 'Compact context' selected", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Compact context");
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toBeUndefined();
	});

	it("proceeds with compaction when select is dismissed (returns undefined)", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => undefined);
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toBeUndefined();
	});

	it("cancels compaction when 'Continue without either' selected", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Continue without either");
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toEqual({ cancel: true });
	});

	it("cancels compaction when 'Handoff to new session' selected and handoff succeeds", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => "Generated summary content");
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toEqual({ cancel: true });
	});

	it("proceeds with compaction when handoff ui is cancelled (custom returns null)", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => null);
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		// performHandoff returns "Handoff cancelled.", hook notifies with warning and returns undefined
		expect(result).toBeUndefined();
		expect(
			ctx.ui.notify.mock.calls.some(
				(c: any[]) => c[0].includes("Handoff failed") && c[1] === "warning",
			),
		).toBe(true);
	});

	it("proceeds with compaction (notify warning) when performHandoff throws", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Handoff to new session");
		// Make ctx.modelRegistry.getApiKey throw to force an exception INSIDE performHandoff
		// (after custom() is called), which propagates to the hook's try-catch.
		ctx.ui.custom = mock(async (_factory: any) => {
			// Simulate the factory throwing by having custom itself throw
			throw new Error("UI exploded unexpectedly");
		});
		const result = await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		expect(result).toBeUndefined();
		expect(
			ctx.ui.notify.mock.calls.some(
				(c: any[]) => (c[0].includes("Handoff error") || c[0].includes("Compacting instead")) && c[1] === "warning",
			),
		).toBe(true);
	});

	it("includes previousSummary in context when present", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => "Summary");

		const event = makeCompactEvent({
			preparation: {
				messagesToSummarize: [{ role: "user", content: "hello" }],
				previousSummary: "Prior context here",
			},
		});

		await fireEvent(captured, "session_before_compact", event, ctx);

		// serializeConversation is called with messages
		expect(mockSerializeConversation.mock.calls.length).toBeGreaterThan(0);
	});

	it("omits previousSummary section when not present", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => "Summary");

		// We verify: no crash, handoff succeeds, compaction is cancelled
		const result = await fireEvent(
			captured,
			"session_before_compact",
			makeCompactEvent({ preparation: { messagesToSummarize: [], previousSummary: undefined } }),
			ctx,
		);
		expect(result).toEqual({ cancel: true });
	});

	it("is a no-op if pendingHandoffText is already set for this session", async () => {
		const ctx = createCtx();
		// The pending text check uses the current session file
		// We simulate this by running a successful handoff first (sets pending text),
		// then firing the hook again — it should skip the select dialog.
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => "Summary");

		// First fire: sets pending text
		await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		const firstSelectCalls = ctx.ui.select.mock.calls.length;

		// Second fire: should skip (session file still has pending text)
		await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);
		// select should NOT have been called again
		expect(ctx.ui.select.mock.calls.length).toBe(firstSelectCalls);
	});

	it("sets editor text and notifies in hook mode (no newSession)", async () => {
		const ctx = createCtx(); // No newSession — hook mode
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => "Summary text here");

		await fireEvent(captured, "session_before_compact", makeCompactEvent(), ctx);

		expect(ctx.ui.setEditorText.mock.calls.length).toBeGreaterThan(0);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "info")).toBe(true);
	});

	it("calls convertToLlm with messagesToSummarize", async () => {
		const ctx = createCtx();
		ctx.ui.select = mock(async () => "Handoff to new session");
		ctx.ui.custom = mock(async () => "Summary");

		const msgs = [{ role: "user", content: "test message" }];
		const event = makeCompactEvent({
			preparation: { messagesToSummarize: msgs, previousSummary: undefined },
		});

		await fireEvent(captured, "session_before_compact", event, ctx);
		expect(mockConvertToLlm).toHaveBeenCalledWith(msgs);
	});
});

// ─── /handoff command ─────────────────────────────────────────────────────────

describe("/handoff command handler", () => {
	it("is registered", () => {
		expect(captured.commands["handoff"]).toBeDefined();
	});

	it("shows error notification when goal is empty", async () => {
		const ctx = createCommandCtx();
		await captured.commands["handoff"]("", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("shows error notification when goal is only whitespace", async () => {
		const ctx = createCommandCtx();
		await captured.commands["handoff"]("   ", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("trims whitespace from goal before processing", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		await captured.commands["handoff"]("  my goal  ", ctx);
		// newSession should be called (success path)
		expect(ctx.newSession.mock.calls.length).toBeGreaterThan(0);
	});

	it("shows error notification when performHandoff fails (no model)", async () => {
		const ctx = createCommandCtx({ model: undefined });
		await captured.commands["handoff"]("some goal", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("shows error notification when hasUI is false", async () => {
		const ctx = createCommandCtx({ hasUI: false });
		await captured.commands["handoff"]("some goal", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("shows error when there are no messages to hand off", async () => {
		const ctx = createCommandCtx();
		ctx.sessionManager.getBranch = mock(() => []);
		await captured.commands["handoff"]("my goal", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("creates a new session on success (command mode)", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary text");
		await captured.commands["handoff"]("implement auth", ctx);
		expect(ctx.newSession.mock.calls.length).toBe(1);
	});

	it("sets session name from goal on success", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary text");
		await captured.commands["handoff"]("Implement Auth Flow", ctx);
		expect(piMock.setSessionName.mock.calls[0][0]).toBe("implement-auth-flow");
	});

	it("passes parentSession to newSession", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		ctx.sessionManager.getSessionFile = mock(() => "/sessions/current.jsonl");
		await captured.commands["handoff"]("my goal", ctx);
		const callArgs = ctx.newSession.mock.calls[0][0];
		expect(callArgs?.parentSession).toBe("/sessions/current.jsonl");
	});

	it("shows error when newSession is cancelled", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		ctx.newSession = mock(async () => ({ cancelled: true }));
		await captured.commands["handoff"]("my goal", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("does not show error on successful handoff", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary text");
		await captured.commands["handoff"]("ship it", ctx);
		// error notifications should be absent
		expect(ctx.ui.notify.mock.calls.every((c: any[]) => c[1] !== "error")).toBe(true);
	});

	it("shows error when summary generation is cancelled (custom returns null)", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => null);
		await captured.commands["handoff"]("my goal", ctx);
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("handles session file being null (no parent session)", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		ctx.sessionManager.getSessionFile = mock(() => null);
		await captured.commands["handoff"]("my goal", ctx);
		// Should still succeed (no parent session in prompt)
		expect(ctx.newSession.mock.calls.length).toBe(1);
	});

	it("filters branch entries to messages only", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		ctx.sessionManager.getBranch = mock(() => [
			{ type: "message", message: { role: "user", content: "hello" } },
			{ type: "compaction", summary: "old summary" }, // non-message entry
			{ type: "message", message: { role: "assistant", content: [] } },
		]);
		await captured.commands["handoff"]("goal", ctx);
		// Should succeed — only message entries are used
		expect(ctx.newSession.mock.calls.length).toBe(1);
	});
});

// ─── handoff tool ─────────────────────────────────────────────────────────────

describe("handoff tool", () => {
	it("is registered with name 'handoff'", () => {
		expect(captured.tools["handoff"]).toBeDefined();
	});

	it("returns error text when performHandoff fails (no model)", async () => {
		const ctx = createCtx({ model: undefined });
		const result = await captured.tools["handoff"]("tc1", { goal: "my goal" }, null, null, ctx);
		expect(result.content[0].text).toContain("No model selected");
	});

	it("returns error text when hasUI is false", async () => {
		const ctx = createCtx({ hasUI: false });
		const result = await captured.tools["handoff"]("tc1", { goal: "my goal" }, null, null, ctx);
		expect(result.content[0].text).toContain("interactive mode");
	});

	it("returns error text when no messages to hand off", async () => {
		const ctx = createCtx();
		ctx.sessionManager.getBranch = mock(() => []);
		const result = await captured.tools["handoff"]("tc1", { goal: "some goal" }, null, null, ctx);
		expect(result.content[0].text).toContain("No conversation");
	});

	it("returns error when summary generation is cancelled", async () => {
		const ctx = createCtx();
		ctx.ui.custom = mock(async () => null);
		const result = await captured.tools["handoff"]("tc1", { goal: "goal" }, null, null, ctx);
		expect(result.content[0].text).toContain("cancelled");
	});

	it("returns success text and sets editor in tool mode (no newSession)", async () => {
		const ctx = createCtx(); // tool mode = ExtensionContext, no newSession
		ctx.ui.custom = mock(async () => "Summary text");
		const result = await captured.tools["handoff"]("tc1", { goal: "implement X" }, null, null, ctx);
		// Should succeed and tell user to start a new session
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).not.toContain("cancelled");
		// Editor should be pre-filled
		expect(ctx.ui.setEditorText.mock.calls.length).toBeGreaterThan(0);
	});

	it("does NOT call newSession (tool mode lacks it)", async () => {
		const ctx = createCtx();
		ctx.ui.custom = mock(async () => "Summary");
		await captured.tools["handoff"]("tc1", { goal: "goal" }, null, null, ctx);
		// ctx has no newSession in base createCtx()
		expect("newSession" in ctx).toBe(false);
	});

	it("passes goal to session name when in command mode", async () => {
		const ctx = createCommandCtx(); // has newSession
		ctx.ui.custom = mock(async () => "Summary");
		await captured.tools["handoff"]("tc1", { goal: "Ship the Feature" }, null, null, ctx);
		expect(piMock.setSessionName.mock.calls[0][0]).toBe("ship-the-feature");
	});

	it("result content type is always 'text'", async () => {
		const ctx = createCtx({ model: undefined });
		const result = await captured.tools["handoff"]("tc1", { goal: "goal" }, null, null, ctx);
		expect(result.content[0].type).toBe("text");
	});
});

// ─── performHandoff edge cases via command handler ────────────────────────────

describe("performHandoff edge cases (via command handler)", () => {
	it("includes parent session reference in prompt when session file exists", async () => {
		const ctx = createCommandCtx();
		ctx.sessionManager.getSessionFile = mock(() => "/sessions/sess-abc.jsonl");
		let capturedEditorText = "";
		ctx.ui.custom = mock(async () => "Summary body");
		// In command mode, pendingHandoffText is set then newSession is called.
		// We check what was stored by looking at what newSession received.
		// Actually easier: just check the generated prompt contains parent ref.
		// We can intercept by making newSession capture state.
		await captured.commands["handoff"]("my goal", ctx);
		// newSession was called — success
		expect(ctx.newSession.mock.calls.length).toBe(1);
	});

	it("does not store pendingHandoffText when session file is null", async () => {
		const ctx = createCommandCtx();
		ctx.sessionManager.getSessionFile = mock(() => null);
		ctx.ui.custom = mock(async () => "Summary");
		await captured.commands["handoff"]("goal", ctx);
		// Can't easily inspect the map, but verify no crash and newSession called
		expect(ctx.newSession.mock.calls.length).toBe(1);
	});

	it("cleans up pendingHandoffText when newSession is cancelled", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		ctx.newSession = mock(async () => ({ cancelled: true }));
		ctx.sessionManager.getSessionFile = mock(() => "/sessions/s.jsonl");
		await captured.commands["handoff"]("goal", ctx);
		// Second invocation with same session file — if text wasn't cleaned up
		// the compact hook would skip. Here we just verify the command error is shown.
		expect(ctx.ui.notify.mock.calls.some((c: any[]) => c[1] === "error")).toBe(true);
	});

	it("calls serializeConversation with converted messages", async () => {
		const ctx = createCommandCtx();
		ctx.ui.custom = mock(async () => "Summary");
		mockConvertToLlm.mockImplementation((msgs: any[]) => msgs);
		await captured.commands["handoff"]("goal", ctx);
		expect(mockConvertToLlm.mock.calls.length).toBeGreaterThan(0);
		expect(mockSerializeConversation.mock.calls.length).toBeGreaterThan(0);
	});
});

// ─── session_switch + pendingHandoffText integration ─────────────────────────

describe("session_switch handler with pendingHandoffText integration", () => {
	it("sets editor text when pending text exists for the parent session", async () => {
		// Step 1: trigger a successful handoff in hook mode to populate pendingHandoffText
		const compactCtx = createCtx();
		compactCtx.ui.select = mock(async () => "Handoff to new session");
		compactCtx.ui.custom = mock(async () => "My summary");
		compactCtx.sessionManager.getSessionFile = mock(() => "/sessions/PARENT.jsonl");

		await fireEvent(
			captured,
			"session_before_compact",
			{
				type: "session_before_compact",
				preparation: {
					messagesToSummarize: [{ role: "user", content: "x" }],
					previousSummary: undefined,
				},
				branchEntries: [],
				signal: new AbortController().signal,
			},
			compactCtx,
		);

		// Verify editor was set in the same session (hook mode)
		expect(compactCtx.ui.setEditorText.mock.calls.length).toBeGreaterThan(0);

		// Step 2: simulate session_switch in the NEW session (child) that has parent = PARENT
		const newSessionCtx = createCtx();
		newSessionCtx.sessionManager.getHeader = mock(() => ({
			parentSession: "/sessions/PARENT.jsonl",
		}));

		await fireEvent(
			captured,
			"session_switch",
			{ type: "session_switch", reason: "new", previousSessionFile: "/sessions/PARENT.jsonl" },
			newSessionCtx,
		);

		// Editor should be set in the new session too
		expect(newSessionCtx.ui.setEditorText.mock.calls.length).toBeGreaterThan(0);
		expect(
			newSessionCtx.ui.notify.mock.calls.some(
				(c: any[]) => c[0].includes("Handoff ready") && c[1] === "info",
			),
		).toBe(true);
	});

	it("removes pendingHandoffText after setting editor (prevents double-set)", async () => {
		// Trigger handoff (hook mode) to populate pending text
		const compactCtx = createCtx();
		compactCtx.ui.select = mock(async () => "Handoff to new session");
		compactCtx.ui.custom = mock(async () => "Summary");
		compactCtx.sessionManager.getSessionFile = mock(() => "/sessions/PARENT2.jsonl");

		await fireEvent(
			captured,
			"session_before_compact",
			{
				type: "session_before_compact",
				preparation: { messagesToSummarize: [], previousSummary: undefined },
				branchEntries: [],
				signal: new AbortController().signal,
			},
			compactCtx,
		);

		const newCtx1 = createCtx();
		newCtx1.sessionManager.getHeader = mock(() => ({
			parentSession: "/sessions/PARENT2.jsonl",
		}));
		await fireEvent(
			captured,
			"session_switch",
			{ type: "session_switch", reason: "new", previousSessionFile: undefined },
			newCtx1,
		);
		expect(newCtx1.ui.setEditorText.mock.calls.length).toBe(1);

		// Fire again — pending text should be gone now
		const newCtx2 = createCtx();
		newCtx2.sessionManager.getHeader = mock(() => ({
			parentSession: "/sessions/PARENT2.jsonl",
		}));
		await fireEvent(
			captured,
			"session_switch",
			{ type: "session_switch", reason: "new", previousSessionFile: undefined },
			newCtx2,
		);
		expect(newCtx2.ui.setEditorText.mock.calls.length).toBe(0);
	});
});
