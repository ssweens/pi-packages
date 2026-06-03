import type { CredentialBackend } from "../credentials/backend.js";
import { createCredentialReader } from "../credentials/reader.js";
import type { CredentialSpec } from "../credentials/types.js";
import { makeNamespacedKey } from "../credentials/types.js";
import type { SourceAdapter } from "../sources/types.js";
import type { CliHandler } from "./index.js";
import { promptLine as realPromptLine, promptSecret as realPromptSecret } from "./prompts.js";

export interface RunSetupDeps {
	readonly mode: "full" | "check";
	readonly adapters: readonly SourceAdapter[];
	readonly backend: CredentialBackend;
	readonly log: (line: string) => void;
	readonly promptLine: (msg: string) => Promise<string>;
	readonly promptSecret: (msg: string) => Promise<string>;
}

interface AuditRow {
	source: string;
	tier: number;
	credentials: Array<{
		spec: CredentialSpec;
		status: "ok" | "missing" | "invalid";
	}>;
}

export async function runSetup(deps: RunSetupDeps): Promise<number> {
	deps.log("camoufox-pi setup — audit");
	if (deps.adapters.length === 0) {
		deps.log("");
		deps.log("No source adapters are registered on the default CLI entry.");
		deps.log("Source adapters are registered programmatically via:");
		deps.log("  createClient({ sources: [redditAdapter(), /* ... */] })");
		deps.log("If you meant to audit an application, run setup from that app's context.");
		return 0;
	}
	const rows = await audit(deps.adapters, deps.backend);
	printAudit(rows, deps.log);

	if (deps.mode === "check") {
		return rows.every((r) => r.credentials.every((c) => c.status === "ok")) ? 0 : 1;
	}

	for (const row of rows) {
		for (const cred of row.credentials) {
			if (cred.status === "ok") continue;
			const handled = await handleCredential(row.source, cred.spec, deps);
			if (handled) {
				await reaudit(row.source, cred.spec, deps.backend, deps.log);
			}
		}
	}

	deps.log("\nFinal state:");
	const finalRows = await audit(deps.adapters, deps.backend);
	printAudit(finalRows, deps.log);
	return finalRows.every((r) => r.credentials.every((c) => c.status === "ok")) ? 0 : 1;
}

async function audit(
	adapters: readonly SourceAdapter[],
	backend: CredentialBackend,
): Promise<AuditRow[]> {
	const rows: AuditRow[] = [];
	for (const a of adapters) {
		const row: AuditRow = { source: a.name, tier: a.tier, credentials: [] };
		for (const spec of a.requiredCredentials) {
			const key = makeNamespacedKey(a.name, spec.key);
			const value = await backend.get(key);
			if (value === null) {
				row.credentials.push({ spec, status: "missing" });
			} else if (spec.kind === "cookie_jar") {
				try {
					JSON.parse(value);
					row.credentials.push({ spec, status: "ok" });
				} catch {
					row.credentials.push({ spec, status: "invalid" });
				}
			} else {
				row.credentials.push({ spec, status: "ok" });
			}
		}
		rows.push(row);
	}
	return rows;
}

function printAudit(rows: readonly AuditRow[], log: (l: string) => void): void {
	for (const row of rows) {
		if (row.credentials.length === 0) {
			log(`  ${row.source} (tier ${row.tier})  0/0 credentials  ok`);
			continue;
		}
		const okCount = row.credentials.filter((c) => c.status === "ok").length;
		const total = row.credentials.length;
		const overall = row.credentials.some((c) => c.status !== "ok") ? "needs setup" : "ok";
		log(`  ${row.source} (tier ${row.tier})  ${okCount}/${total} credentials  ${overall}`);
		for (const c of row.credentials) {
			log(`     - ${c.spec.key} (${c.spec.kind})  ${c.status}`);
		}
	}
}

async function handleCredential(
	source: string,
	spec: CredentialSpec,
	deps: RunSetupDeps,
): Promise<boolean> {
	deps.log("");
	deps.log(`Configuring ${source}:${spec.key} — ${spec.description}`);
	if (spec.obtainUrl) deps.log(`  Obtain at: ${spec.obtainUrl}`);
	if (spec.loginUrl) deps.log(`  Login URL: ${spec.loginUrl}`);

	if (spec.kind === "cookie_jar") {
		deps.log("  [cookie_jar capture not yet implemented — will land in the next milestone]");
		return false;
	}

	const value = await deps.promptSecret(`  Paste ${spec.kind} (input hidden): `);
	if (!value) {
		deps.log("  skipped (empty input)");
		return false;
	}
	await deps.backend.set(makeNamespacedKey(source, spec.key), value);
	deps.log("  stored");
	return true;
}

async function reaudit(
	source: string,
	spec: CredentialSpec,
	backend: CredentialBackend,
	log: (l: string) => void,
): Promise<void> {
	const reader = createCredentialReader(backend, source);
	const value = await reader.get(spec.key);
	log(value !== null ? "  re-audit: ok" : "  re-audit: still missing");
}

export function registerSetupHandlers(): Partial<Record<string, CliHandler>> {
	// Real entry point: lazy-imports keyring backend. Unit tests inject via
	// runSetup directly; this function exists so the CLI dispatcher in
	// src/cli/index.ts can be wired without pulling client deps at type time.
	const build = async (mode: "full" | "check"): Promise<number> => {
		const { createKeyringBackend } = await import("../credentials/keyring-backend.js");
		// No default-registered adapters in milestone 5. A real consumer passes
		// adapters via createClient() — invoking setup CLI without registered
		// adapters prints no rows and exits 0.
		const adapters: SourceAdapter[] = [];
		let backend: CredentialBackend;
		try {
			backend = await createKeyringBackend();
		} catch (err) {
			console.error(`credential backend unavailable: ${err instanceof Error ? err.message : err}`);
			return 2;
		}
		return runSetup({
			mode,
			adapters,
			backend,
			log: (l) => console.log(l),
			promptLine: realPromptLine,
			promptSecret: realPromptSecret,
		});
	};
	return {
		setup: () => build("full"),
		"setup:check": () => build("check"),
	};
}
