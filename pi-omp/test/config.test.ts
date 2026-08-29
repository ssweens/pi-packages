import { afterAll, describe, expect, test } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { loadConfig, saveConfig } from "../src/config";

const TMP = path.join(os.tmpdir(), `pi-omp-config-test-${process.pid}`);

afterAll(async () => {
	await fs.rm(TMP, { recursive: true, force: true });
});

describe("config persistence", () => {
	test("role bindings survive a save → reload round trip", async () => {
		const cwd = path.join(TMP, "proj");
		await fs.mkdir(path.join(cwd, ".pi"), { recursive: true });

		const cfg = await loadConfig(cwd);
		cfg.roles = { ...cfg.roles, slow: { model: "xiaomi/mi-ai", thinking: "xhigh", enabled: true } };
		cfg.features.commit = true;
		const target = await saveConfig(cwd, cfg); // writes project (if present) or global
		expect(target.length).toBeGreaterThan(0);

		const cfg2 = await loadConfig(cwd);
		expect(cfg2.roles.slow).toEqual({ model: "xiaomi/mi-ai", thinking: "xhigh", enabled: true });
		expect(cfg2.features.commit).toBe(true);
	});

	test("saveConfig creates the parent dir so persistence never hits ENOENT", async () => {
		// Isolated HOME so we never touch the real config.
		const cwd = path.join(TMP, "empty-proj");
		const oldHome = process.env.HOME;
		process.env.HOME = path.join(TMP, "home");
		try {
			await fs.mkdir(cwd, { recursive: true });
			const cfg = await loadConfig(cwd);
			cfg.roles = { ...cfg.roles, smol: { thinking: "low" } };
			const target = await saveConfig(cwd, cfg); // must not throw even if the dir is fresh
			expect(target.length).toBeGreaterThan(0);
			expect(await loadConfig(cwd)).toBeDefined();
		} finally {
			process.env.HOME = oldHome;
		}
	});
});
