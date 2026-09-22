import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";

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

/** One writer for a parent's children, including their JSONL files. Survives extension reload. */
export async function claimOwner(path: string, onCompromised: (error: Error) => void): Promise<() => Promise<void>> {
	mkdirSync(dirname(path), { recursive: true });
	try {
		return await lockfile.lock(path, { realpath: false, stale: 10_000, update: 2_000, retries: 0, onCompromised });
	} catch (error: any) {
		if (error.code === "ELOCKED") throw new Error("This parent's delegated sessions are owned by another Pi process. Close it first; after a crash, its filesystem lease expires within 10 seconds.");
		throw error;
	}
}
