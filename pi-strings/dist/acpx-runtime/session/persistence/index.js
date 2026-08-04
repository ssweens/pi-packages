import fs from "node:fs/promises";
import path from "node:path";
import { createAtomicWriteTempPath } from "./atomic-write.js";
import { parseSessionRecord } from "./parse.js";
const SESSION_INDEX_SCHEMA = "acpx.session-index.v1";
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function parseIndexEntry(raw) {
    const record = asRecord(raw);
    if (!record) {
        return undefined;
    }
    if (!hasRequiredIndexEntryFields(record)) {
        return undefined;
    }
    if (record.name !== undefined && typeof record.name !== "string") {
        return undefined;
    }
    return {
        file: record.file,
        acpxRecordId: record.acpxRecordId,
        acpSessionId: record.acpSessionId,
        agentCommand: record.agentCommand,
        cwd: record.cwd,
        name: record.name,
        closed: record.closed,
        lastUsedAt: record.lastUsedAt,
    };
}
function hasRequiredIndexEntryFields(record) {
    return (["file", "acpxRecordId", "acpSessionId", "agentCommand", "cwd", "lastUsedAt"].every((key) => typeof record[key] === "string") && typeof record.closed === "boolean");
}
export function sessionIndexPath(sessionDir) {
    return path.join(sessionDir, "index.json");
}
export function toSessionIndexEntry(record, fileName) {
    return {
        file: fileName,
        acpxRecordId: record.acpxRecordId,
        acpSessionId: record.acpSessionId,
        agentCommand: record.agentCommand,
        cwd: record.cwd,
        name: record.name,
        closed: record.closed === true,
        lastUsedAt: record.lastUsedAt,
    };
}
export async function readSessionIndex(sessionDir) {
    const filePath = sessionIndexPath(sessionDir);
    try {
        const payload = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(payload);
        const record = asRecord(parsed);
        if (!record || record.schema !== SESSION_INDEX_SCHEMA || !Array.isArray(record.files)) {
            return undefined;
        }
        const files = record.files.filter((entry) => typeof entry === "string");
        if (files.length !== record.files.length || !Array.isArray(record.entries)) {
            return undefined;
        }
        const entries = record.entries
            .map((entry) => parseIndexEntry(entry))
            .filter((entry) => Boolean(entry));
        if (entries.length !== record.entries.length) {
            return undefined;
        }
        return {
            schema: SESSION_INDEX_SCHEMA,
            files,
            entries,
        };
    }
    catch {
        return undefined;
    }
}
export async function writeSessionIndex(sessionDir, index) {
    const filePath = sessionIndexPath(sessionDir);
    const tempFile = createAtomicWriteTempPath(filePath);
    const payload = JSON.stringify({
        schema: SESSION_INDEX_SCHEMA,
        files: [...index.files].toSorted(),
        entries: [...index.entries].toSorted((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt)),
    }, null, 2);
    await fs.writeFile(tempFile, `${payload}\n`, "utf8");
    await fs.rename(tempFile, filePath);
}
export async function rebuildSessionIndex(sessionDir) {
    const entries = await fs.readdir(sessionDir, { withFileTypes: true });
    const files = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json")
        .map((entry) => entry.name)
        .toSorted();
    const indexEntries = [];
    for (const file of files) {
        try {
            const payload = await fs.readFile(path.join(sessionDir, file), "utf8");
            const parsed = parseSessionRecord(JSON.parse(payload));
            if (!parsed) {
                continue;
            }
            indexEntries.push(toSessionIndexEntry(parsed, file));
        }
        catch {
            // ignore corrupt session files while rebuilding the cache index
        }
    }
    const index = {
        schema: SESSION_INDEX_SCHEMA,
        files,
        entries: indexEntries,
    };
    await writeSessionIndex(sessionDir, index);
    return index;
}
export async function loadOrRebuildSessionIndex(sessionDir) {
    const files = (await fs.readdir(sessionDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json") && entry.name !== "index.json")
        .map((entry) => entry.name)
        .toSorted();
    const existing = await readSessionIndex(sessionDir);
    if (existing &&
        existing.files.length === files.length &&
        existing.files.every((file, index) => file === files[index])) {
        return existing;
    }
    return await rebuildSessionIndex(sessionDir);
}
