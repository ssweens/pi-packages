import { describe, expect, it, vi } from "vitest";

import { runSetup } from "../../../src/cli/setup.js";
import { redditAdapter } from "../../../src/sources/adapters/reddit.js";
import type { SourceAdapter } from "../../../src/sources/types.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";

describe("runSetup audit", () => {
	it("exits 0 when all sources are fully configured", async () => {
		const logs: string[] = [];
		const exit = await runSetup({
			mode: "full",
			adapters: [redditAdapter()],
			backend: createFakeCredentialBackend(),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(exit).toBe(0);
		expect(logs.join("\n")).toContain("reddit");
		expect(logs.join("\n")).toContain("ok");
	});

	it("reports missing credentials in audit", async () => {
		const logs: string[] = [];
		const fakeAdapter: SourceAdapter = {
			name: "fake-api",
			tier: 4,
			requiredCredentials: [
				{
					kind: "api_key",
					key: "api_key",
					description: "Test API key",
					obtainUrl: "https://example.test/get-key",
				},
			],
			fetch: async () => [],
		};
		const exit = await runSetup({
			mode: "check",
			adapters: [fakeAdapter],
			backend: createFakeCredentialBackend(),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(exit).not.toBe(0);
		expect(logs.join("\n")).toContain("missing");
	});

	it("prompts for missing api_key, stores, re-audits green", async () => {
		const logs: string[] = [];
		const backend = createFakeCredentialBackend();
		const fakeAdapter: SourceAdapter = {
			name: "fake-api",
			tier: 4,
			requiredCredentials: [
				{
					kind: "api_key",
					key: "api_key",
					description: "Test API key",
				},
			],
			fetch: async () => [],
		};
		const promptSecret = vi.fn(async () => "entered-value");
		const exit = await runSetup({
			mode: "full",
			adapters: [fakeAdapter],
			backend,
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret,
		});
		expect(promptSecret).toHaveBeenCalled();
		expect(await backend.get("camoufox-pi:fake-api:api_key")).toBe("entered-value");
		expect(exit).toBe(0);
	});

	it("cookie_jar in milestone 5 prints 'not yet implemented' and skips", async () => {
		const logs: string[] = [];
		const backend = createFakeCredentialBackend();
		const fakeAdapter: SourceAdapter = {
			name: "cookie-src",
			tier: 2,
			requiredCredentials: [
				{
					kind: "cookie_jar",
					key: "cookies",
					description: "Login cookies",
					loginUrl: "https://site.test/login",
				},
			],
			fetch: async () => [],
		};
		const exit = await runSetup({
			mode: "full",
			adapters: [fakeAdapter],
			backend,
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(logs.join("\n")).toContain("not yet implemented");
		expect(exit).not.toBe(0);
	});

	it("prints an explanatory message and exits 0 when no adapters are registered", async () => {
		const logs: string[] = [];
		const exit = await runSetup({
			mode: "full",
			adapters: [],
			backend: createFakeCredentialBackend(),
			log: (l) => {
				logs.push(l);
			},
			promptLine: async () => "",
			promptSecret: async () => "",
		});
		expect(exit).toBe(0);
		expect(logs.join("\n")).toContain("No source adapters are registered");
	});
});
