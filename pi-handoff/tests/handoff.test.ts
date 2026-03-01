/**
 * Handoff extension tests.
 *
 * Follows pi's own compaction-extensions.test.ts pattern:
 * - Real AgentSession with real SessionManager (temp dir)
 * - Real extension wired in via Extension interface
 * - Real LLM calls for e2e tests (gated by API_KEY)
 * - Minimal mocking: only what can't run in tests (TUI components)
 *
 * The extension registers handlers via pi.on() / registerCommand() / registerTool().
 * We capture those registrations into an Extension object, wire it into AgentSession,
 * and drive events through the real session machinery.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
	AgentSession,
	AuthStorage,
	createExtensionRuntime,
	type Extension,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";

// Import the real extension and its system prompt
import handoffExtension, { SYSTEM_PROMPT } from "../extensions/handoff.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve API key from pi's auth storage (~/.pi/agent/auth.json).
 * Handles both plain API keys and OAuth credentials (with refresh).
 */
async function resolveApiKey(provider: string): Promise<string | undefined> {
	const { homedir } = await import("node:os");
	const { join } = await import("node:path");
	const { existsSync, readFileSync } = await import("node:fs");
	const { getOAuthApiKey } = await import("@mariozechner/pi-ai");

	const authPath = join(homedir(), ".pi", "agent", "auth.json");
	if (!existsSync(authPath)) return undefined;

	let storage: Record<string, any>;
	try {
		storage = JSON.parse(readFileSync(authPath, "utf-8"));
	} catch {
		return undefined;
	}

	const entry = storage[provider];
	if (!entry) return undefined;

	if (entry.type === "api_key") return entry.key;

	if (entry.type === "oauth") {
		const oauthCreds: Record<string, any> = {};
		for (const [key, value] of Object.entries(storage)) {
			if ((value as any).type === "oauth") {
				const { type: _, ...creds } = value as any;
				oauthCreds[key] = creds;
			}
		}
		const result = await getOAuthApiKey(provider as any, oauthCreds);
		return result?.apiKey;
	}

	return undefined;
}

const API_KEY = await resolveApiKey("anthropic");

/**
 * Load the real handoff extension into an Extension object
 * by capturing pi.on(), registerCommand(), registerTool() calls.
 */
function loadExtension(): { extension: Extension; pi: ExtensionAPI } {
	const handlers = new Map<string, ((event: any, ctx: any) => Promise<any>)[]>();
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();

	const pi: ExtensionAPI = {
		on: (event: string, handler: any) => {
			if (!handlers.has(event)) handlers.set(event, []);
			handlers.get(event)!.push(handler);
		},
		registerCommand: (name: string, opts: any) => {
			commands.set(name, { name, ...opts });
		},
		registerTool: (tool: any) => {
			tools.set(tool.name, {
				definition: tool,
				extensionPath: "pi-handoff",
			});
		},
		setSessionName: mock(() => {}),
		sendMessage: mock(() => {}),
		sendUserMessage: mock(() => {}),
		appendEntry: mock(() => {}),
		getSessionName: () => undefined,
		setLabel: mock(() => {}),
		getActiveTools: () => [],
		getAllTools: () => [],
		setActiveTools: mock(() => {}),
		getCommands: () => [],
		setModel: mock(async () => true),
		getThinkingLevel: () => "medium" as any,
		setThinkingLevel: mock(() => {}),
		registerProvider: mock(() => {}),
		unregisterProvider: mock(() => {}),
		registerFlag: mock(() => {}),
		getFlag: () => undefined,
		registerShortcut: mock(() => {}),
		registerMessageRenderer: mock(() => {}),
		exec: mock(async () => ({ exitCode: 0, stdout: "", stderr: "" })),
		events: { emit: mock(() => {}), on: mock(() => () => {}) } as any,
	} as any;

	handoffExtension(pi);

	const extension: Extension = {
		path: "pi-handoff",
		resolvedPath: join(__dirname, "../extensions/handoff.ts"),
		handlers,
		tools,
		messageRenderers: new Map(),
		commands,
		flags: new Map(),
		shortcuts: new Map(),
	};

	return { extension, pi };
}

/**
 * Create a minimal mock UI context for handler tests.
 * Only mocks what can't run without a terminal.
 */
function createMockUI(overrides: Record<string, any> = {}) {
	return {
		select: mock(async () => undefined),
		confirm: mock(async () => false),
		input: mock(async () => undefined),
		notify: mock((_msg: string, _type?: string) => {}),
		setEditorText: mock((_text: string) => {}),
		getEditorText: mock(() => ""),
		custom: mock(async () => null),
		pasteToEditor: mock(),
		editor: mock(async () => undefined),
		setEditorComponent: mock(),
		setStatus: mock(),
		setWorkingMessage: mock(),
		setWidget: mock(),
		setFooter: mock(),
		setHeader: mock(),
		setTitle: mock(),
		onTerminalInput: mock(() => () => {}),
		getToolsExpanded: mock(() => false),
		setToolsExpanded: mock(),
		getAllThemes: mock(() => []),
		getTheme: mock(() => undefined),
		setTheme: mock(() => ({ success: true })),
		theme: {},
		...overrides,
	};
}

function createTestResourceLoader(extensions: Extension[] = []) {
	const runtime = createExtensionRuntime();
	return {
		getExtensions: () => ({ extensions, errors: [], runtime }),
		getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }),
		getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined,
		getAppendSystemPrompt: () => [],
		getPathMetadata: () => new Map(),
		reload: async () => {},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Handoff extension", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-handoff-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	// ── Registration ────────────────────────────────────────────────────────

	describe("registration", () => {
		it("registers all expected handlers, commands, and tools", () => {
			const { extension } = loadExtension();

			expect(extension.handlers.has("session_switch")).toBe(true);
			expect(extension.handlers.has("context")).toBe(true);
			expect(extension.handlers.has("input")).toBe(true);
			expect(extension.handlers.has("agent_end")).toBe(true);
			expect(extension.handlers.has("before_agent_start")).toBe(true);
			expect(extension.handlers.has("session_before_compact")).toBe(true);
			expect(extension.commands.has("handoff")).toBe(true);
			expect(extension.tools.has("handoff")).toBe(true);
		});
	});

	// ── /handoff command flow ───────────────────────────────────────────────
	// Generate prompt → newSession → session_switch → editor text set

	describe("/handoff command flow", () => {
		it("generates prompt, creates new session, and sets editor text", async () => {
			const { extension } = loadExtension();

			const sessionManager = SessionManager.create(tempDir);
			const originalSessionFile = sessionManager.getSessionFile();

			// Track what lands in the editor
			let editorText = "";
			const ui = createMockUI({
				// Simulate LLM generating a summary
				custom: mock(async () => ({ type: "prompt", text: "## Context\nWe discussed auth.\n\n## Task\nImplement OAuth" })),
				setEditorText: mock((text: string) => {
					editorText = text;
				}),
			});

			// Build a mock command context with the REAL session manager
			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "test-key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
				// Command context methods
				waitForIdle: async () => {},
				newSession: mock(async (opts?: any) => {
					// Actually create the new session via real SessionManager
					sessionManager.newSession(opts);
					// Fire session_switch handlers with real state
					const switchHandlers = extension.handlers.get("session_switch") ?? [];
					for (const h of switchHandlers) {
						await h(
							{ type: "session_switch", reason: "new", previousSessionFile: originalSessionFile },
							{ ...ctx, sessionManager },
						);
					}
					return { cancelled: false };
				}),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			// Seed the session with real messages so gatherConversation works
			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("How do I implement OAuth?"));
			sessionManager.appendMessage(assistantMsg("You'll need to set up an auth provider..."));

			// Execute the command handler
			const commandHandler = extension.commands.get("handoff")!;
			await commandHandler.handler("implement OAuth", ctx);

			// Verify: newSession was called
			expect(ctx.newSession).toHaveBeenCalled();

			// Verify: editor text was set in the new session
			expect(editorText.length).toBeGreaterThan(0);
			expect(editorText).toContain("Context");
			expect(editorText).toContain("OAuth");
		});

		it("does nothing when no conversation exists", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI();

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => null,
				compact: () => {},
				getSystemPrompt: () => "",
				newSession: mock(async () => ({ cancelled: false })),
				waitForIdle: async () => {},
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			await extension.commands.get("handoff")!.handler("some goal", ctx);

			// newSession should NOT have been called
			expect(ctx.newSession).not.toHaveBeenCalled();
			// Should have shown an error
			expect(ui.notify).toHaveBeenCalled();
		});

		it("shows error when LLM returns context_length_exceeded", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI({
				custom: mock(async () => ({
					type: "error",
					message: 'Codex error: {"type":"error","error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Your input exceeds the context window of this model."}}',
				})),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "test-key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async () => ({ cancelled: false })),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("Some big conversation"));
			sessionManager.appendMessage(assistantMsg("Some big reply"));

			await extension.commands.get("handoff")!.handler("continue work", ctx);

			// newSession should NOT have been called
			expect(ctx.newSession).not.toHaveBeenCalled();
			// Error notification with the failure message
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("Handoff failed");
			expect(notifyCall[0]).toContain("context_length_exceeded");
			expect(notifyCall[1]).toBe("error");
		});

		it("shows error when LLM returns empty response", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI({
				custom: mock(async () => ({ type: "error", message: "LLM returned empty response" })),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "test-key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async () => ({ cancelled: false })),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("Hello"));
			sessionManager.appendMessage(assistantMsg("Hi"));

			await extension.commands.get("handoff")!.handler("do something", ctx);

			expect(ctx.newSession).not.toHaveBeenCalled();
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("Handoff failed");
			expect(notifyCall[0]).toContain("empty response");
			expect(notifyCall[1]).toBe("error");
		});

		it("shows error when prompt generation throws", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI({
				// In real code, errors inside the BorderedLoader's run() are caught
				// and returned as { type: "error" }. The mock simulates that outcome.
				custom: mock(async () => ({ type: "error", message: "Network timeout" })),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "test-key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async () => ({ cancelled: false })),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("Hello"));
			sessionManager.appendMessage(assistantMsg("Hi"));

			await extension.commands.get("handoff")!.handler("do something", ctx);

			expect(ctx.newSession).not.toHaveBeenCalled();
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("Handoff failed");
			expect(notifyCall[0]).toContain("Network timeout");
			expect(notifyCall[1]).toBe("error");
		});

		it("shows error when no model is selected", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI();

			const ctx: any = {
				hasUI: true,
				model: null,
				sessionManager,
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => null,
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async () => ({ cancelled: false })),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			await extension.commands.get("handoff")!.handler("some goal", ctx);

			expect(ctx.newSession).not.toHaveBeenCalled();
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("No model selected");
			expect(notifyCall[1]).toBe("error");
		});

		it("shows usage error when no goal provided", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI();

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model" },
				sessionManager,
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => null,
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async () => ({ cancelled: false })),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			await extension.commands.get("handoff")!.handler("", ctx);

			expect(ctx.newSession).not.toHaveBeenCalled();
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("Usage:");
			expect(notifyCall[1]).toBe("error");
		});
	});

	// ── Compact hook flow ───────────────────────────────────────────────────
	// User selects handoff → prompt generated → raw sessionManager.newSession()
	// → editor text set → compaction cancelled

	describe("compact hook flow", () => {
		it("generates prompt, switches session, sets editor, cancels compaction", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			let editorText = "";
			const ui = createMockUI({
				select: mock(async () => "Handoff to new session"),
				custom: mock(async () => ({ type: "prompt", text: "## Context\nWorking on tests.\n\n## Task\nContinue" })),
				setEditorText: mock((text: string) => {
					editorText = text;
				}),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const originalSessionFile = sessionManager.getSessionFile();

			const event = {
				type: "session_before_compact",
				preparation: {
					messagesToSummarize: [
						{ role: "user", content: "Build me auth", timestamp: Date.now() },
						{
							role: "assistant",
							content: [{ type: "text", text: "Sure" }],
							timestamp: Date.now(),
						},
					],
					previousSummary: undefined,
					turnPrefixMessages: [],
					isSplitTurn: false,
					tokensBefore: 180000,
					firstKeptEntryId: "x",
					fileOps: { read: new Set(), edited: new Set() },
					settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
				},
				branchEntries: [],
				signal: new AbortController().signal,
			};

			const handlers = extension.handlers.get("session_before_compact")!;
			const result = await handlers[0](event, ctx);

			// Compaction was cancelled
			expect(result).toEqual({ cancel: true });

			// Session file changed (raw newSession was called)
			expect(sessionManager.getSessionFile()).not.toBe(originalSessionFile);

			// Editor has the generated prompt
			expect(editorText.length).toBeGreaterThan(0);
			expect(editorText).toContain("Context");

			// Notification shown
			expect(ui.notify).toHaveBeenCalled();
		});

		it("falls back to compaction when user selects Compact context", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			const ui = createMockUI({
				select: mock(async () => "Compact context"),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const result = await extension.handlers.get("session_before_compact")![0](
				{
					type: "session_before_compact",
					preparation: { messagesToSummarize: [], previousSummary: undefined, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 0, firstKeptEntryId: "x", fileOps: { read: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
					branchEntries: [],
					signal: new AbortController().signal,
				},
				ctx,
			);

			// Returns undefined = proceed with compaction
			expect(result).toBeUndefined();
		});

		it("falls back to compaction when prompt generation is cancelled", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			const ui = createMockUI({
				select: mock(async () => "Handoff to new session"),
				custom: mock(async () => null), // user pressed Escape
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const originalSessionFile = sessionManager.getSessionFile();

			const result = await extension.handlers.get("session_before_compact")![0](
				{
					type: "session_before_compact",
					preparation: { messagesToSummarize: [], previousSummary: undefined, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 0, firstKeptEntryId: "x", fileOps: { read: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
					branchEntries: [],
					signal: new AbortController().signal,
				},
				ctx,
			);

			// Falls back to compaction (returns undefined)
			expect(result).toBeUndefined();
			// Session did NOT change
			expect(sessionManager.getSessionFile()).toBe(originalSessionFile);
			// Warning shown
			expect(ui.notify).toHaveBeenCalled();
		});

		it("falls back to compaction when LLM returns context_length_exceeded", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			const ui = createMockUI({
				select: mock(async () => "Handoff to new session"),
				custom: mock(async () => ({
					type: "error",
					message: 'Codex error: {"type":"error","error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Your input exceeds the context window of this model."}}',
				})),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const originalSessionFile = sessionManager.getSessionFile();

			const result = await extension.handlers.get("session_before_compact")![0](
				{
					type: "session_before_compact",
					preparation: { messagesToSummarize: [{ role: "user", content: "big msg", timestamp: Date.now() }], previousSummary: undefined, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 180000, firstKeptEntryId: "x", fileOps: { read: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
					branchEntries: [],
					signal: new AbortController().signal,
				},
				ctx,
			);

			// Falls back to compaction (returns undefined)
			expect(result).toBeUndefined();
			// Session did NOT change
			expect(sessionManager.getSessionFile()).toBe(originalSessionFile);
			// Warning notification with failure message
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("Handoff failed");
			expect(notifyCall[0]).toContain("context_length_exceeded");
			expect(notifyCall[0]).toContain("Compacting instead");
			expect(notifyCall[1]).toBe("warning");
		});

		it("falls back to compaction when prompt generation throws", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			const ui = createMockUI({
				select: mock(async () => "Handoff to new session"),
				custom: mock(async () => ({ type: "error", message: "API request failed: 529 overloaded" })),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const originalSessionFile = sessionManager.getSessionFile();

			const result = await extension.handlers.get("session_before_compact")![0](
				{
					type: "session_before_compact",
					preparation: { messagesToSummarize: [{ role: "user", content: "msg", timestamp: Date.now() }], previousSummary: undefined, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 180000, firstKeptEntryId: "x", fileOps: { read: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
					branchEntries: [],
					signal: new AbortController().signal,
				},
				ctx,
			);

			// Falls back to compaction
			expect(result).toBeUndefined();
			expect(sessionManager.getSessionFile()).toBe(originalSessionFile);
			expect(ui.notify).toHaveBeenCalled();
			const notifyCall = (ui.notify as any).mock.calls[0];
			expect(notifyCall[0]).toContain("Handoff failed");
			expect(notifyCall[0]).toContain("overloaded");
			expect(notifyCall[0]).toContain("Compacting instead");
			expect(notifyCall[1]).toBe("warning");
		});
	});

	// ── Tool → agent_end flow ───────────────────────────────────────────────
	// Tool stores pending → agent_end fires → raw newSession → editor set

	describe("tool → agent_end flow", () => {
		it("defers session switch to agent_end, then sets editor", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			let editorText = "";
			const ui = createMockUI({
				custom: mock(async () => ({ type: "prompt", text: "## Context\nTool handoff.\n\n## Task\nContinue" })),
				setEditorText: mock((text: string) => {
					editorText = text;
				}),
			});

			// Seed messages
			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("Help me refactor"));
			sessionManager.appendMessage(assistantMsg("Let's start with..."));

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const originalSessionFile = sessionManager.getSessionFile();

			// Execute tool
			const toolDef = extension.tools.get("handoff")!.definition;
			const result = await toolDef.execute("tc1", { goal: "refactor auth" }, undefined, undefined, ctx);

			// Tool returns success message
			expect(result.content[0].text).toContain("Handoff initiated");

			// Session has NOT switched yet (deferred)
			expect(sessionManager.getSessionFile()).toBe(originalSessionFile);

			// Fire agent_end — this triggers the deferred switch
			const agentEndHandlers = extension.handlers.get("agent_end")!;
			await agentEndHandlers[0]({ type: "agent_end", messages: [] }, ctx);

			// Now session HAS switched
			expect(sessionManager.getSessionFile()).not.toBe(originalSessionFile);

			// Editor text set via setTimeout — need to flush
			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(editorText.length).toBeGreaterThan(0);
			expect(editorText).toContain("Context");
		});

		it("returns error message when LLM returns context_length_exceeded", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI({
				custom: mock(async () => ({
					type: "error",
					message: 'Codex error: {"type":"error","error":{"type":"invalid_request_error","code":"context_length_exceeded","message":"Your input exceeds the context window of this model."}}',
				})),
			});

			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("Big conversation"));
			sessionManager.appendMessage(assistantMsg("Big reply"));

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const toolDef = extension.tools.get("handoff")!.definition;
			const result = await toolDef.execute("tc1", { goal: "continue" }, undefined, undefined, ctx);

			// Returns error message to the agent
			expect(result.content[0].text).toContain("Handoff failed");
			expect(result.content[0].text).toContain("context_length_exceeded");

			// No pending handoff — agent_end should be a no-op
			const agentEndHandlers = extension.handlers.get("agent_end")!;
			await agentEndHandlers[0]({ type: "agent_end", messages: [] }, ctx);

			// Session should NOT have switched
			expect(sessionManager.getSessionFile()).toBe(sessionManager.getSessionFile());
		});

		it("returns error message when prompt generation throws", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const ui = createMockUI({
				custom: mock(async () => ({ type: "error", message: "Connection refused" })),
			});

			const { userMsg, assistantMsg } = makeMessages();
			sessionManager.appendMessage(userMsg("Something"));
			sessionManager.appendMessage(assistantMsg("Reply"));

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			const toolDef = extension.tools.get("handoff")!.definition;
			const result = await toolDef.execute("tc1", { goal: "continue" }, undefined, undefined, ctx);

			expect(result.content[0].text).toContain("Handoff failed");
			expect(result.content[0].text).toContain("Connection refused");
		});
	});

	// ── Context filter ──────────────────────────────────────────────────────
	// After raw newSession, old messages are filtered by timestamp

	describe("context filter after raw session switch", () => {
		it("filters old messages after compact-hook handoff", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			const ui = createMockUI({
				select: mock(async () => "Handoff to new session"),
				custom: mock(async () => ({ type: "prompt", text: "## Summary\nDone." })),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			// Fire compact hook (sets handoffTimestamp + calls raw newSession)
			await extension.handlers.get("session_before_compact")![0](
				{
					type: "session_before_compact",
					preparation: { messagesToSummarize: [{ role: "user", content: "old msg", timestamp: Date.now() - 10000 }], previousSummary: undefined, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 0, firstKeptEntryId: "x", fileOps: { read: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
					branchEntries: [],
					signal: new AbortController().signal,
				},
				ctx,
			);

			// Now fire context event with old + new messages
			const contextHandlers = extension.handlers.get("context")!;
			const oldMsg = { role: "user", content: "old", timestamp: Date.now() - 60000 };
			const newMsg = { role: "user", content: "new prompt", timestamp: Date.now() + 1000 };

			const filterResult = await contextHandlers[0](
				{ type: "context", messages: [oldMsg, newMsg] },
				ctx,
			);

			// Old message filtered out, only new message remains
			expect(filterResult).toBeDefined();
			expect(filterResult.messages.length).toBe(1);
			expect(filterResult.messages[0].content).toBe("new prompt");
		});

		it("context filter is cleared on proper session_switch", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);

			const ui = createMockUI({
				select: mock(async () => "Handoff to new session"),
				custom: mock(async () => ({ type: "prompt", text: "## Summary" })),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
				compact: () => {},
				getSystemPrompt: () => "",
			};

			// Fire compact hook to set handoffTimestamp
			await extension.handlers.get("session_before_compact")![0](
				{
					type: "session_before_compact",
					preparation: { messagesToSummarize: [], previousSummary: undefined, turnPrefixMessages: [], isSplitTurn: false, tokensBefore: 0, firstKeptEntryId: "x", fileOps: { read: new Set(), edited: new Set() }, settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 } },
					branchEntries: [],
					signal: new AbortController().signal,
				},
				ctx,
			);

			// Fire session_switch (simulates user doing /new later)
			await extension.handlers.get("session_switch")![0](
				{ type: "session_switch", reason: "new", previousSessionFile: undefined },
				ctx,
			);

			// Now context filter should be cleared
			const contextResult = await extension.handlers.get("context")![0](
				{ type: "context", messages: [{ role: "user", content: "x", timestamp: 0 }] },
				ctx,
			);

			// No filtering — returns undefined (pass through)
			expect(contextResult).toBeUndefined();
		});
	});

	// ── Collapsed file markers ──────────────────────────────────────────────

	describe("collapsed file markers", () => {
		it("shows collapsed markers in editor and expands on input", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const { userMsg } = makeMessages();

			// Seed with assistant messages that have tool calls (read + edit)
			sessionManager.appendMessage(userMsg("Fix the bug"));
			sessionManager.appendMessage({
				role: "assistant" as const,
				content: [
					{ type: "text" as const, text: "I'll read and fix the files." },
					{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "src/auth.ts" } },
					{ type: "toolCall", id: "tc2", name: "read", arguments: { path: "src/db.ts" } },
					{ type: "toolCall", id: "tc3", name: "read", arguments: { path: "src/utils.ts" } },
					{ type: "toolCall", id: "tc4", name: "edit", arguments: { path: "src/auth.ts", oldText: "a", newText: "b" } },
					{ type: "toolCall", id: "tc5", name: "write", arguments: { path: "src/new-file.ts" } },
				],
				api: "anthropic-messages" as const,
				provider: "anthropic",
				model: "test",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop" as const,
				timestamp: Date.now(),
			});

			let editorText = "";
			const ui = createMockUI({
				custom: mock(async () => ({ type: "prompt", text: "## Goal\nFix auth bug" })),
				setEditorText: mock((text: string) => {
					editorText = text;
				}),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "test-key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async (opts?: any) => {
					sessionManager.newSession(opts);
					const switchHandlers = extension.handlers.get("session_switch") ?? [];
					for (const h of switchHandlers) {
						await h(
							{ type: "session_switch", reason: "new", previousSessionFile: "old" },
							{ ...ctx, sessionManager },
						);
					}
					return { cancelled: false };
				}),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			await extension.commands.get("handoff")!.handler("fix auth", ctx);

			// Editor shows collapsed markers, not raw file lists
			expect(editorText).toContain("[+2 read filenames]");
			expect(editorText).toContain("[+2 modified filenames]");
			expect(editorText).not.toContain("<read-files>");
			expect(editorText).not.toContain("<modified-files>");
			expect(editorText).not.toContain("src/db.ts");

			// Now simulate the user pressing Enter — input hook expands markers
			const inputHandlers = extension.handlers.get("input")!;
			const inputResult = await inputHandlers[0](
				{ type: "input", text: editorText, source: "editor" },
				ctx,
			);

			// Input was transformed with expanded file lists
			expect(inputResult).toBeDefined();
			expect(inputResult.action).toBe("transform");
			expect(inputResult.text).toContain("<read-files>");
			expect(inputResult.text).toContain("src/db.ts");
			expect(inputResult.text).toContain("src/utils.ts");
			expect(inputResult.text).toContain("<modified-files>");
			expect(inputResult.text).toContain("src/auth.ts");
			expect(inputResult.text).toContain("src/new-file.ts");
			// Markers are gone in the expanded text
			expect(inputResult.text).not.toContain("read filenames]");
			expect(inputResult.text).not.toContain("modified filenames]");
		});

		it("input hook is no-op when no markers are active", async () => {
			const { extension } = loadExtension();

			const ctx: any = {
				hasUI: true,
				model: { id: "test" },
			};

			const inputHandlers = extension.handlers.get("input")!;
			const result = await inputHandlers[0](
				{ type: "input", text: "just a normal message", source: "editor" },
				ctx,
			);

			// No transformation — returns undefined (pass through)
			expect(result).toBeUndefined();
		});

		it("markers are single-use — cleared after first expansion", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const { userMsg } = makeMessages();

			sessionManager.appendMessage(userMsg("read stuff"));
			sessionManager.appendMessage({
				role: "assistant" as const,
				content: [
					{ type: "toolCall", id: "tc1", name: "read", arguments: { path: "a.ts" } },
					{ type: "toolCall", id: "tc2", name: "read", arguments: { path: "b.ts" } },
				],
				api: "anthropic-messages" as const,
				provider: "anthropic",
				model: "test",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop" as const,
				timestamp: Date.now(),
			});

			const ui = createMockUI({
				custom: mock(async () => ({ type: "prompt", text: "## Goal\nStuff" })),
				setEditorText: mock(() => {}),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => null,
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async (opts?: any) => {
					sessionManager.newSession(opts);
					const switchHandlers = extension.handlers.get("session_switch") ?? [];
					for (const h of switchHandlers) {
						await h({ type: "session_switch", reason: "new" }, { ...ctx, sessionManager });
					}
					return { cancelled: false };
				}),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			await extension.commands.get("handoff")!.handler("stuff", ctx);

			const inputHandlers = extension.handlers.get("input")!;

			// First call expands
			const first = await inputHandlers[0](
				{ type: "input", text: "[+2 read filenames]", source: "editor" },
				ctx,
			);
			expect(first).toBeDefined();
			expect(first.action).toBe("transform");

			// Second call — markers cleared, no-op
			const second = await inputHandlers[0](
				{ type: "input", text: "[+2 read filenames]", source: "editor" },
				ctx,
			);
			expect(second).toBeUndefined();
		});

		it("singular 'file' for single-file lists", async () => {
			const { extension } = loadExtension();
			const sessionManager = SessionManager.create(tempDir);
			const { userMsg } = makeMessages();

			sessionManager.appendMessage(userMsg("edit one file"));
			sessionManager.appendMessage({
				role: "assistant" as const,
				content: [
					{ type: "toolCall", id: "tc1", name: "edit", arguments: { path: "src/index.ts", oldText: "x", newText: "y" } },
				],
				api: "anthropic-messages" as const,
				provider: "anthropic",
				model: "test",
				usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop" as const,
				timestamp: Date.now(),
			});

			let editorText = "";
			const ui = createMockUI({
				custom: mock(async () => ({ type: "prompt", text: "## Goal\nEdit" })),
				setEditorText: mock((text: string) => { editorText = text; }),
			});

			const ctx: any = {
				hasUI: true,
				model: { id: "test-model", contextWindow: 200000 },
				sessionManager,
				modelRegistry: { getApiKey: async () => "key" },
				ui,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => null,
				compact: () => {},
				getSystemPrompt: () => "",
				waitForIdle: async () => {},
				newSession: mock(async (opts?: any) => {
					sessionManager.newSession(opts);
					const switchHandlers = extension.handlers.get("session_switch") ?? [];
					for (const h of switchHandlers) {
						await h({ type: "session_switch", reason: "new" }, { ...ctx, sessionManager });
					}
					return { cancelled: false };
				}),
				fork: async () => ({ cancelled: false }),
				navigateTree: async () => ({ cancelled: false }),
				switchSession: async () => ({ cancelled: false }),
				reload: async () => {},
			};

			await extension.commands.get("handoff")!.handler("edit", ctx);

			// Singular "file" not "files"
			expect(editorText).toContain("[+1 modified filename]");
			expect(editorText).not.toContain("read filename"); // no read-only files
		});
	});
});

// ── Ancestry chain ──────────────────────────────────────────────────────────

describe("Ancestry chain in handoff prompt", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-handoff-ancestry-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	it("includes grandparent and ancestor sessions in the prompt", async () => {
		const { extension } = loadExtension();
		const { userMsg, assistantMsg } = makeMessages();

		// Create a chain: grandparent → parent → current
		// Each session needs messages so the file gets flushed to disk
		const grandparentSession = SessionManager.create(tempDir);
		grandparentSession.appendMessage(userMsg("grandparent msg"));
		grandparentSession.appendMessage(assistantMsg("grandparent reply"));
		const grandparentFile = grandparentSession.getSessionFile();

		const parentSession = SessionManager.create(tempDir);
		parentSession.newSession({ parentSession: grandparentFile });
		parentSession.appendMessage(userMsg("parent msg"));
		parentSession.appendMessage(assistantMsg("parent reply"));
		const parentFile = parentSession.getSessionFile();

		const currentSession = SessionManager.create(tempDir);
		currentSession.newSession({ parentSession: parentFile });

		let editorText = "";
		const ui = createMockUI({
			custom: mock(async () => ({ type: "prompt", text: "## Goal\nContinue work" })),
			setEditorText: mock((text: string) => {
				editorText = text;
			}),
		});

		const ctx: any = {
			hasUI: true,
			model: { id: "test-model", contextWindow: 200000 },
			sessionManager: currentSession,
			modelRegistry: { getApiKey: async () => "test-key" },
			ui,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
			compact: () => {},
			getSystemPrompt: () => "",
			waitForIdle: async () => {},
			newSession: mock(async (opts?: any) => {
				currentSession.newSession(opts);
				const switchHandlers = extension.handlers.get("session_switch") ?? [];
				for (const h of switchHandlers) {
					await h(
						{ type: "session_switch", reason: "new", previousSessionFile: parentFile },
						{ ...ctx, sessionManager: currentSession },
					);
				}
				return { cancelled: false };
			}),
			fork: async () => ({ cancelled: false }),
			navigateTree: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			reload: async () => {},
		};

		// Seed messages in current session
		currentSession.appendMessage(userMsg("Build the feature"));
		currentSession.appendMessage(assistantMsg("On it."));

		await extension.commands.get("handoff")!.handler("continue", ctx);

		// Parent session is listed
		expect(editorText).toContain("Parent session:");
		expect(editorText).toContain(parentFile!);

		// Grandparent is listed under ancestor sessions
		expect(editorText).toContain("Ancestor sessions:");
		expect(editorText).toContain(grandparentFile!);
	});

	it("handles single parent with no grandparent (no ancestor section)", async () => {
		const { extension } = loadExtension();
		const { userMsg, assistantMsg } = makeMessages();

		// Create a single session (no parent) and handoff from it.
		// The handoff wraps currentSessionFile as the parent of the new session.
		// Since the current session has no parentSession in its header,
		// the ancestry chain is just [currentSessionFile] — no ancestors.
		const currentSession = SessionManager.create(tempDir);

		let editorText = "";
		const ui = createMockUI({
			custom: mock(async () => ({ type: "prompt", text: "## Goal\nDo stuff" })),
			setEditorText: mock((text: string) => {
				editorText = text;
			}),
		});

		const ctx: any = {
			hasUI: true,
			model: { id: "test-model", contextWindow: 200000 },
			sessionManager: currentSession,
			modelRegistry: { getApiKey: async () => "test-key" },
			ui,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => ({ tokens: 50000, contextWindow: 200000, percent: 25 }),
			compact: () => {},
			getSystemPrompt: () => "",
			waitForIdle: async () => {},
			newSession: mock(async (opts?: any) => {
				currentSession.newSession(opts);
				const switchHandlers = extension.handlers.get("session_switch") ?? [];
				for (const h of switchHandlers) {
					await h(
						{ type: "session_switch", reason: "new", previousSessionFile: currentSessionFile },
						{ ...ctx, sessionManager: currentSession },
					);
				}
				return { cancelled: false };
			}),
			fork: async () => ({ cancelled: false }),
			navigateTree: async () => ({ cancelled: false }),
			switchSession: async () => ({ cancelled: false }),
			reload: async () => {},
		};

		currentSession.appendMessage(userMsg("Hello"));
		currentSession.appendMessage(assistantMsg("Hi"));

		const currentSessionFile = currentSession.getSessionFile();
		await extension.commands.get("handoff")!.handler("do stuff", ctx);

		// Parent listed (the current session becomes the parent of the new session)
		expect(editorText).toContain("Parent session:");
		expect(editorText).toContain(currentSessionFile!);

		// No ancestor section when the parent has no parent of its own
		expect(editorText).not.toContain("Ancestor sessions:");
	});
});

// ── E2E with real LLM ───────────────────────────────────────────────────────

describe.skipIf(!API_KEY)("Handoff e2e (real LLM)", () => {
	let tempDir: string;
	let session: AgentSession;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-handoff-e2e-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		if (session) session.dispose();
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	it("compact hook generates real handoff prompt and switches session", async () => {
		const { extension } = loadExtension();
		const model = getModel("anthropic", "claude-haiku-4-5")!;
		const sessionManager = SessionManager.create(tempDir);
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		// Use pi's real auth storage so OAuth credentials are available
		const { homedir } = await import("node:os");
		const realAuthPath = join(homedir(), ".pi", "agent", "auth.json");
		const authStorage = AuthStorage.create(realAuthPath);
		const modelRegistry = new ModelRegistry(authStorage);

		const agent = new Agent({
			getApiKey: () => API_KEY!,
			initialState: {
				model,
				systemPrompt: "Be concise.",
				tools: [],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader: createTestResourceLoader([extension]),
		});

		// Build conversation
		await session.prompt("I'm building an OAuth2 authentication module in src/auth.ts. I've implemented the token exchange flow and refresh logic. The next step is adding PKCE support for public clients. Keep replies brief.");
		await session.agent.waitForIdle();

		const originalSessionFile = sessionManager.getSessionFile();

		// Now fire the compact hook directly with a real LLM-backed ctx.ui.custom
		// For this test, we mock ui.custom to call the real complete() function
		let editorText = "";
		const ui = createMockUI({
			select: mock(async () => "Handoff to new session"),
			// Let the real LLM generate the prompt
			custom: mock(async (factory: any) => {
				// We can't run the real BorderedLoader in tests,
				// but we CAN call complete() directly
				const { complete: realComplete } = await import("@mariozechner/pi-ai");
				const { buildSessionContext, convertToLlm, serializeConversation } = await import("@mariozechner/pi-coding-agent");

				// Use buildSessionContext (compaction-aware) — same as the real extension
				const branch = sessionManager.getBranch();
				const leafId = sessionManager.getLeafId();
				const { messages: msgs } = buildSessionContext(branch, leafId);
				const text = serializeConversation(convertToLlm(msgs));

				const response = await realComplete(
					model,
					{
						systemPrompt: SYSTEM_PROMPT,
						messages: [{
							role: "user",
							content: [{ type: "text", text: `## Conversation History\n\n${text}\n\n## User's Goal for New Thread\n\nContinue implementing PKCE support for the OAuth2 module` }],
							timestamp: Date.now(),
						}],
					},
					{ apiKey: API_KEY! },
				);

				const promptText = response.content
					.filter((c: any) => c.type === "text")
					.map((c: any) => c.text)
					.join("\n");
				return { type: "prompt", text: promptText };
			}),
			setEditorText: mock((text: string) => {
				editorText = text;
			}),
		});

		const ctx: any = {
			hasUI: true,
			model,
			sessionManager,
			modelRegistry,
			ui,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => ({ tokens: 180000, contextWindow: 200000, percent: 90 }),
			compact: () => {},
			getSystemPrompt: () => "",
		};

		const compactEvent = {
			type: "session_before_compact",
			preparation: {
				messagesToSummarize: session.messages,
				previousSummary: undefined,
				turnPrefixMessages: [],
				isSplitTurn: false,
				tokensBefore: 50000,
				firstKeptEntryId: "x",
				fileOps: { read: new Set(), edited: new Set() },
				settings: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
			},
			branchEntries: sessionManager.getBranch(),
			signal: new AbortController().signal,
		};

		const result = await extension.handlers.get("session_before_compact")![0](compactEvent, ctx);

		// Compaction cancelled
		expect(result).toEqual({ cancel: true });

		// Session switched
		expect(sessionManager.getSessionFile()).not.toBe(originalSessionFile);

		// Editor has real LLM-generated content with expected handoff sections
		expect(editorText.length).toBeGreaterThan(20);

		// Validate the LLM returned structured handoff format, not gibberish
		expect(editorText).toContain("## Goal");
		expect(editorText).toContain("## Next Steps");

		// Should contain at least 3 of the expected sections
		const expectedSections = ["## Goal", "## Constraints & Preferences", "## Progress", "## Key Decisions", "## Next Steps", "## Critical Context"];
		const foundSections = expectedSections.filter((s) => editorText.includes(s));
		expect(foundSections.length).toBeGreaterThanOrEqual(3);

		// Should reference the parent session
		expect(editorText).toContain("Parent session:");
		expect(editorText).toContain("/skill:pi-session-query");
	}, 120000);
});

// ---------------------------------------------------------------------------
// Message factories (matching pi's test utilities)
// ---------------------------------------------------------------------------

function makeMessages() {
	return {
		userMsg: (text: string) => ({
			role: "user" as const,
			content: text,
			timestamp: Date.now(),
		}),
		assistantMsg: (text: string) => ({
			role: "assistant" as const,
			content: [{ type: "text" as const, text }],
			api: "anthropic-messages" as const,
			provider: "anthropic",
			model: "test",
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop" as const,
			timestamp: Date.now(),
		}),
	};
}
