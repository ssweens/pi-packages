import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { claimOwner, readRecord, storageDir, writeRecord } from "../src/storage.ts";

function fixture(t: any) {
	const dir = mkdtempSync(join(tmpdir(), "delegate-storage-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("records distinguish missing, corrupt, and atomically replaced values", (t) => {
	const dir = fixture(t);
	const path = join(dir, "record.json");
	assert.equal(readRecord(path), undefined);
	writeRecord(path, { segment: 1 });
	writeRecord(path, { segment: 2, stopped: true });
	assert.deepEqual(readRecord(path), { segment: 2, stopped: true });
	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.deepEqual(readdirSync(dir), ["record.json"]);
	assert.throws(() => writeRecord(path, { bad: 1n }));
	assert.deepEqual(readRecord(path), { segment: 2, stopped: true });
	assert.deepEqual(readdirSync(dir), ["record.json"]);
	writeFileSync(path, "{");
	assert.throws(() => readRecord(path), SyntaxError);
});

test("subsession storage is self-ignored and resolves cwd aliases", (t) => {
	const dir = fixture(t);
	const alias = `${dir}-alias`;
	symlinkSync(dir, alias);
	t.after(() => rmSync(alias));
	const path = storageDir(dir);
	assert.equal(storageDir(alias), path);
	assert.equal(readFileSync(join(path, ".gitignore"), "utf8"), "*\n");
	writeFileSync(join(path, ".gitignore"), "*\n# retained\n");
	storageDir(dir);
	assert.equal(readFileSync(join(path, ".gitignore"), "utf8"), "*\n# retained\n");
});

test("one parent owner holds the lease until release", async (t) => {
	const path = join(fixture(t), "owners", "parent.json");
	const compromised = (error: Error) => { throw error; };
	const release = await claimOwner(path, compromised);
	await assert.rejects(claimOwner(path, compromised), /owned by another Pi process/);
	await release();
	const releaseAgain = await claimOwner(path, compromised);
	await releaseAgain();
	assert.deepEqual(readdirSync(join(path, "..")), []);
});
