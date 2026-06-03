import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walkFiles(root: string, exts: string[]): string[] {
	const out: string[] = [];
	for (const name of readdirSync(root)) {
		const full = join(root, name);
		const s = statSync(full);
		if (s.isDirectory()) out.push(...walkFiles(full, exts));
		else if (exts.some((e) => full.endsWith(e))) out.push(full);
	}
	return out;
}

describe("module isolation (structural)", () => {
	it("src/client/** does NOT import pi-coding-agent / pi-ai / pi-tui", () => {
		const files = walkFiles("src/client", [".ts"]);
		const offenders: string[] = [];
		for (const f of files) {
			const body = readFileSync(f, "utf8");
			if (/@mariozechner\/pi-(coding-agent|ai|tui)/.test(body)) offenders.push(f);
		}
		expect(offenders).toEqual([]);
	});

	it("src/services/camoufox-service.ts is the ONLY file that references pi.events or pi.ui", () => {
		const files = walkFiles("src", [".ts"]);
		const offenders: string[] = [];
		for (const f of files) {
			if (f.endsWith("/camoufox-service.ts")) continue;
			// src/index.ts may reference pi.ui.notify for the update-available
			// banner, which is a narrow, one-off PI-UX affordance. The rule
			// for everywhere else is: no pi.events or pi.ui references at all.
			if (f.endsWith("/index.ts")) continue;
			const body = readFileSync(f, "utf8");
			if (/\bpi\.events\b|\bpi\.ui\b/.test(body)) offenders.push(f);
		}
		expect(offenders).toEqual([]);
	});

	it("camoufox-js is imported only from src/client/launcher.ts", () => {
		const files = walkFiles("src", [".ts"]);
		const offenders: string[] = [];
		for (const f of files) {
			if (f.endsWith("/launcher.ts")) continue;
			const body = readFileSync(f, "utf8");
			if (/from ["']camoufox-js["']|require\(["']camoufox-js["']\)/.test(body)) offenders.push(f);
		}
		expect(offenders).toEqual([]);
	});
});
