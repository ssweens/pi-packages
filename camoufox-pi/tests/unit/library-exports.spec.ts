import "../../src/tools/formats.js";
import { Type } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";

import { CamoufoxErrorBox } from "../../src/errors.js";
import camoufoxExtension, {
	CamoufoxService,
	createAllCommands,
	createAllHooks,
} from "../../src/index.js";
import type { ToolDefinition } from "../../src/tools/types.js";
import { makeFakeLauncher } from "../helpers/fake-launcher.js";

describe("library exports", () => {
	it("exposes the default extension entry", () => {
		expect(typeof camoufoxExtension).toBe("function");
	});

	it("exposes the service and factories with an eagerly-constructed client", () => {
		const service = new CamoufoxService({ launcher: makeFakeLauncher() });
		expect(typeof service.getConfig).toBe("function");
		expect(createAllCommands(service)).toEqual([]);
		expect(createAllHooks(service)).toEqual([]);
		expect(service.getClient()).toBeDefined();
	});
});

describe("milestone-2 public API exports", () => {
	it("exports CamoufoxClient, createClient, RealLauncher as values", async () => {
		const lib = await import("../../src/index.js");
		expect(typeof lib.CamoufoxClient).toBe("function");
		expect(typeof lib.createClient).toBe("function");
		expect(typeof lib.RealLauncher).toBe("function");
	});

	it("createClient returns a CamoufoxClient with a typed events emitter", async () => {
		const lib = await import("../../src/index.js");
		const client = lib.createClient({ launcher: makeFakeLauncher() });
		expect(client).toBeInstanceOf(lib.CamoufoxClient);
		expect(typeof client.events.on).toBe("function");
		expect(typeof client.events.off).toBe("function");
		expect(typeof client.events.emit).toBe("function");
		await client.close();
	});

	it("exposes checkHealth on the client instance", async () => {
		const lib = await import("../../src/index.js");
		const client = lib.createClient({ launcher: makeFakeLauncher() });
		expect(typeof client.checkHealth).toBe("function");
		const health = await client.checkHealth();
		expect(health.status).toMatch(/launching|ready/);
		await client.close();
	});
});

describe("milestone 5 exports", () => {
	it("exports redditAdapter factory", async () => {
		const mod = await import("../../src/index.js");
		expect(typeof mod.redditAdapter).toBe("function");
		const adapter = mod.redditAdapter();
		expect(adapter.name).toBe("reddit");
	});
});

describe("wrapTool boundary", () => {
	it("throws CamoufoxErrorBox on invalid input and threads the signal on valid", async () => {
		const schema = Type.Object({ url: Type.String({ format: "uri" }) });
		const toolDef: ToolDefinition<typeof schema> = {
			name: "test-tool",
			label: "test",
			description: "test",
			promptSnippet: "",
			promptGuidelines: [],
			parameters: schema,
			async execute(_id, input, signal) {
				return {
					content: [{ type: "text", text: "ok" }],
					details: {
						url: input.url,
						aborted: signal?.aborted ?? false,
					},
				};
			},
		};

		const { __test_wrapTool__ } = await import("../../src/index.js");
		const w = __test_wrapTool__(toolDef);

		await expect(w.execute("id", { url: "not-a-url" }, undefined)).rejects.toBeInstanceOf(
			CamoufoxErrorBox,
		);

		const ctrl = new AbortController();
		const res = await w.execute("id", { url: "https://ok.test/" }, ctrl.signal);
		expect(res.details).toMatchObject({ url: "https://ok.test/" });
	});
});
