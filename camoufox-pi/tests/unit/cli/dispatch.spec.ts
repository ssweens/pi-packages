import { describe, expect, it, vi } from "vitest";

import { runCli } from "../../../src/cli/index.js";

describe("CLI dispatcher", () => {
	it("dispatches to 'setup' subcommand", async () => {
		const setup = vi.fn(async () => 0);
		const exit = await runCli(["setup"], {
			handlers: { setup, "setup:check": async () => 0 },
			log: () => undefined,
		});
		expect(setup).toHaveBeenCalled();
		expect(exit).toBe(0);
	});

	it("returns 0 and prints usage for 'help' / no args", async () => {
		const logs: string[] = [];
		const exit = await runCli([], {
			handlers: {},
			log: (m) => {
				logs.push(m);
			},
		});
		expect(exit).toBe(0);
		expect(logs.join("\n")).toContain("Usage");
	});

	it("returns nonzero for unknown subcommand", async () => {
		const exit = await runCli(["bogus"], { handlers: {}, log: () => undefined });
		expect(exit).not.toBe(0);
	});

	it("parses setup --check as setup:check handler", async () => {
		const check = vi.fn(async () => 0);
		await runCli(["setup", "--check"], {
			handlers: { "setup:check": check, setup: async () => 0 },
			log: () => undefined,
		});
		expect(check).toHaveBeenCalled();
	});
});
