import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RealLauncher } from "../../src/client/launcher.js";
import camoufoxExtension, {
	__TEST_LAUNCHER_FACTORY__,
	type PiExtensionApi,
} from "../../src/index.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

function makeStubPi() {
	const bus = new EventEmitter();
	const registerTool = vi.fn();
	const registerCommand = vi.fn();
	const on = vi.fn();
	const emit = vi.fn((event: string, payload: unknown) => bus.emit(event, payload));
	const pi = {
		on,
		registerTool,
		registerCommand,
		exec: vi.fn(),
		events: { emit },
		ui: { setStatus: vi.fn(), notify: vi.fn() },
		cwd: "/tmp/pi",
	} as unknown as PiExtensionApi;
	return { pi, registerTool, registerCommand, on, emit };
}

describe("extension load-time registration", () => {
	beforeEach(() => {
		__TEST_LAUNCHER_FACTORY__.fn = () => makeFakeLauncher();
	});
	afterEach(() => {
		__TEST_LAUNCHER_FACTORY__.fn = () => new RealLauncher();
	});

	it("registers both tools before any session_start event fires", () => {
		const { pi, registerTool } = makeStubPi();
		camoufoxExtension(pi);
		const toolNames = registerTool.mock.calls.map((c) => (c[0] as { name: string }).name);
		expect(toolNames).toContain("tff-fetch_url");
		expect(toolNames).toContain("tff-search_web");
	});

	it("registers session_start and session_shutdown listeners", () => {
		const { pi, on } = makeStubPi();
		camoufoxExtension(pi);
		const events = on.mock.calls.map((c) => c[0]);
		expect(events).toContain("session_start");
		expect(events).toContain("session_shutdown");
	});

	it("does NOT emit any pi.events before session_start", () => {
		const { pi, emit } = makeStubPi();
		camoufoxExtension(pi);
		expect(emit).not.toHaveBeenCalled();
	});
});
