import type { TObject } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { type Launcher, RealLauncher } from "./client/launcher.js";
import type { CommandContext, CommandDefinition } from "./commands/index.js";
import { createAllCommands } from "./commands/index.js";
import { CamoufoxErrorBox } from "./errors.js";
import { createAllHooks } from "./hooks/index.js";
import { CamoufoxService } from "./services/camoufox-service.js";
import type { ToolDefinition } from "./tools/index.js";
import { createAllTools } from "./tools/index.js";
import { checkForUpdates } from "./update-check.js";

// ---------------------------------------------------------------------------
// Library-style named exports — non-PI consumers (TFF daemon, scripts, CI)
// import directly. This is off-label per PI docs but mechanically sound
// because CamoufoxClient has no runtime dependency on pi-coding-agent.
// ---------------------------------------------------------------------------

export { CamoufoxClient } from "./client/camoufox-client.js";
export { createClient } from "./client/create-client.js";
export { RealLauncher } from "./client/launcher.js";
export { CamoufoxService } from "./services/camoufox-service.js";
export { createAllTools } from "./tools/index.js";
export { createAllCommands } from "./commands/index.js";
export { createAllHooks } from "./hooks/index.js";
export { CamoufoxErrorBox } from "./errors.js";

export type { CamoufoxConfig } from "./types.js";
export type { ToolDefinition } from "./tools/index.js";
export type { CommandDefinition, CommandContext } from "./commands/index.js";
export type { HookDefinition } from "./hooks/index.js";
export type { Launcher, LaunchedBrowser, LaunchOpts } from "./client/launcher.js";
export type { CreateClientOptions } from "./client/create-client.js";
export type { HealthStatus } from "./client/camoufox-client.js";
export type {
	CamoufoxEvents,
	CamoufoxEventEmitter,
	SearchEvent,
	FetchUrlEvent,
	BrowserLaunchEvent,
	BinaryDownloadProgressEvent,
	ErrorEvent,
} from "./client/events.js";
export type { CamoufoxError } from "./errors.js";
export type { RawResult, SearchEngineChoice, SearchEngineName } from "./search/types.js";

// Sources (milestone 5)
export type {
	SourceName,
	KnownSourceName,
	SourceAdapter,
	SourceFetchOptions,
	AdapterContext,
	FetchSourcesResult,
	BrowserSession,
} from "./sources/types.js";
export type { SourceItem } from "./sources/source-item.js";
export { redditAdapter } from "./sources/adapters/reddit.js";

// Credentials (milestone 5)
export type { CredentialBackend } from "./credentials/backend.js";
export type { CredentialSpec, CredentialKind } from "./credentials/types.js";
export type { CredentialReader } from "./credentials/reader.js";
export type { CredentialsConfig } from "./client/credentials-config.js";

// HTTP primitive (type only — no public constructor on the client)
export type { HttpFetch, HttpFetchInit, HttpResponse } from "./client/http-fetch.js";

// Events (milestone 5 additions)
export type { SourceFetchEvent, HttpFetchEvent } from "./client/events.js";

// ---------------------------------------------------------------------------
// Structural PI API — minimal subset of what @mariozechner/pi-coding-agent
// exposes at runtime. We deliberately avoid importing the real type so this
// package can be imported and unit-tested without the peer dep installed.
// ---------------------------------------------------------------------------

type PiEventHandler = (event: unknown, ctx: unknown) => unknown | Promise<unknown>;

interface PiToolExecuteResult {
	content: Array<{ type: "text"; text: string }>;
	details: unknown;
}

interface PiRegisteredTool {
	name: string;
	label: string;
	description: string;
	promptSnippet: string;
	promptGuidelines: string[];
	parameters: unknown;
	execute(
		toolCallId: string,
		input: unknown,
		signal?: AbortSignal,
		onUpdate?: unknown,
		ctx?: unknown,
	): Promise<PiToolExecuteResult>;
}

interface PiRegisteredCommand {
	description?: string | undefined;
	handler(args: string, ctx: PiCommandContext): Promise<void>;
}

interface PiCommandContext {
	ui?: { notify?: (message: string, level?: string) => void };
	cwd?: string;
}

export interface PiExtensionApi {
	on(event: string, handler: PiEventHandler): void;
	registerTool(tool: PiRegisteredTool): void;
	registerCommand(name: string, config: PiRegisteredCommand): void;
	exec: (
		cmd: string,
		args: string[],
		opts?: { timeout?: number },
	) => Promise<{ stdout: string; code: number }>;
	events: {
		emit(event: string, payload: unknown): boolean;
		on?: (event: string, fn: (p: unknown) => void) => void;
	};
	ui?: {
		setStatus?: (key: string, message: string | null) => void;
		notify?: (message: string, level?: string) => void;
	};
	cwd?: string;
}

// ---------------------------------------------------------------------------
// Boundary adapters: bridge tool/command definitions to PI's structural
// shape without casts. `wrapTool` uses TypeBox's runtime Value.Check to
// narrow the unknown input to Static<S> before delegating to the typed
// execute().
// ---------------------------------------------------------------------------

function wrapTool<S extends TObject>(def: ToolDefinition<S>): PiRegisteredTool {
	const guidelines = [...def.promptGuidelines];
	if (def.readOnly) {
		guidelines.push(
			"This tool is read-only (no side effects). Safe to call in parallel with other read-only tools.",
		);
	}
	return {
		name: def.name,
		label: def.label,
		description: def.description,
		promptSnippet: def.promptSnippet,
		promptGuidelines: guidelines,
		parameters: def.parameters,
		async execute(toolCallId, input, signal) {
			if (!Value.Check(def.parameters, input)) {
				const first = [...Value.Errors(def.parameters, input)][0];
				throw new CamoufoxErrorBox({
					type: "config_invalid",
					field: first?.path ?? "(root)",
					reason: first?.message ?? "validation failed",
				});
			}
			return def.execute(toolCallId, input, signal);
		},
	};
}

// Exposed for unit tests only. Not part of the public API.
export const __test_wrapTool__ = wrapTool;

function wrapCommand(def: CommandDefinition): PiRegisteredCommand {
	return {
		description: def.description,
		async handler(args, piCtx) {
			const ctx: CommandContext = {
				cwd: piCtx.cwd ?? process.cwd(),
				ui: {
					notify: (message, level = "info") => {
						piCtx.ui?.notify?.(message, level);
					},
				},
			};
			await def.handler(args, ctx);
		},
	};
}

// ---------------------------------------------------------------------------
// Test seam — unit tests swap the factory to inject a fake Launcher.
// Production code calls camoufoxExtension(pi) and gets a RealLauncher.
// ---------------------------------------------------------------------------

/**
 * @internal Test-only seam. Unit tests swap `fn` to inject a fake Launcher.
 * Do NOT read or mutate this from production code. The identifier is
 * intentionally SCREAMING_CASE to signal "you are editing an internal
 * contract".
 */
export const __TEST_LAUNCHER_FACTORY__: { fn: () => Launcher } = {
	fn: () => new RealLauncher(),
};

// ---------------------------------------------------------------------------
// Default export — called by PI with its ExtensionAPI instance at startup.
// Tools and hooks are registered at LOAD TIME so they appear in PI's
// startup system prompt. Service attaches session hooks and the event
// bridge synchronously after construction.
// ---------------------------------------------------------------------------

export default function camoufoxExtension(pi: PiExtensionApi): void {
	const service = new CamoufoxService({ launcher: __TEST_LAUNCHER_FACTORY__.fn() });

	for (const def of createAllTools(service)) pi.registerTool(wrapTool(def));
	for (const def of createAllCommands(service)) pi.registerCommand(def.name, wrapCommand(def));
	for (const hook of createAllHooks(service)) pi.on(hook.event, hook.handler);

	service.attach(pi);

	queueMicrotask(() => {
		void checkForUpdates(pi as unknown as Parameters<typeof checkForUpdates>[0]).then((info) => {
			if (info?.updateAvailable) {
				pi.ui?.notify?.(
					`📦 Update available: ${info.latestVersion} (you have ${info.currentVersion}). Run: pi install npm:@the-forge-flow/camoufox-pi`,
					"info",
				);
			}
		});
	});
}
