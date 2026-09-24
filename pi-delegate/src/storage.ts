import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

export const SUBSESSION_DIR = join(".agents", "pi", "subsessions");

export function storageDir(cwd: string): string {
	const dir = join(realpathSync(cwd), SUBSESSION_DIR);
	mkdirSync(dir, { recursive: true });
	const ignore = join(dir, ".gitignore");
	if (!existsSync(ignore)) writeFileSync(ignore, "*\n", { mode: 0o600 });
	return dir;
}

/** A missing record is different from a corrupt or unreadable one. Never overwrite the latter. */
export function readRecord<T>(path: string): T | undefined {
	try { return JSON.parse(readFileSync(path, "utf8")) as T; }
	catch (error: any) { if (error.code === "ENOENT") return undefined; throw error; }
}

export function writeRecord(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
		renameSync(tmp, path);
	} finally { rmSync(tmp, { force: true }); }
}

/**
 * Ownership is per child run, not per parent. Any number of Pi processes may share a
 * directory or even a parent session: each writes only the runs it owns. A run whose owner
 * process is alive is read-only elsewhere; a run whose owner died is adopted by whoever
 * restores it. The token is stable across extension reloads within one process.
 */
export interface RunOwner { ownerPid: number; ownerHost: string; ownerToken: string }

const identityKey = Symbol.for("@ssweens/pi-delegate/process-owner/1");

export function processOwner(): RunOwner {
	const slot = globalThis as typeof globalThis & { [key: symbol]: RunOwner };
	return slot[identityKey] ??= { ownerPid: process.pid, ownerHost: hostname(), ownerToken: randomUUID() };
}

/** True when another live process owns the run. Unowned records and dead owners are not "elsewhere". */
export function ownedElsewhere(record: Partial<RunOwner>): boolean {
	const me = processOwner();
	if (!record.ownerToken || record.ownerToken === me.ownerToken) return false;
	// Another host's process cannot be probed from here; never take its runs.
	if (record.ownerHost !== me.ownerHost) return true;
	// Same pid, different token: a previous process that reused our pid, so it is gone.
	if (!Number.isInteger(record.ownerPid) || record.ownerPid === me.ownerPid) return false;
	try { process.kill(record.ownerPid!, 0); return true; }
	catch (error: any) { return error.code === "EPERM"; }
}
