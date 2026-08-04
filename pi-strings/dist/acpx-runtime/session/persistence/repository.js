import { statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionNotFoundError, SessionResolutionError } from "../../errors.js";
import { incrementPerfCounter, measurePerf } from "../../perf-metrics.js";
import { assertPersistedKeyPolicy } from "../../persisted-key-policy.js";
import { createAtomicWriteTempPath } from "./atomic-write.js";
import { loadOrRebuildSessionIndex, rebuildSessionIndex, toSessionIndexEntry, writeSessionIndex, } from "./index.js";
import { parseSessionRecord } from "./parse.js";
import { serializeSessionRecordForDisk } from "./serialize.js";
export const DEFAULT_HISTORY_LIMIT = 20;
function sessionFilePath(acpxRecordId) {
    const safeId = encodeURIComponent(acpxRecordId);
    return path.join(sessionBaseDir(), `${safeId}.json`);
}
function sessionBaseDir() {
    return path.join(os.homedir(), ".acpx", "sessions");
}
async function ensureSessionDir() {
    await fs.mkdir(sessionBaseDir(), { recursive: true });
}
async function loadRecordFromIndexEntry(entry) {
    try {
        const payload = await fs.readFile(path.join(sessionBaseDir(), entry.file), "utf8");
        return parseSessionRecord(JSON.parse(payload)) ?? undefined;
    }
    catch {
        return undefined;
    }
}
async function loadSessionIndexEntries() {
    await ensureSessionDir();
    const index = await measurePerf("session.index_load", async () => {
        return await loadOrRebuildSessionIndex(sessionBaseDir());
    });
    return index.entries;
}
function matchesSessionEntry(session, normalizedCwd, normalizedName, includeClosed = false) {
    if (session.cwd !== normalizedCwd) {
        return false;
    }
    if (!includeClosed && session.closed) {
        return false;
    }
    if (normalizedName == null) {
        return session.name == null;
    }
    return session.name === normalizedName;
}
export async function writeSessionRecord(record) {
    await measurePerf("session.write_record", async () => {
        await ensureSessionDir();
        const persisted = serializeSessionRecordForDisk(record);
        assertPersistedKeyPolicy(persisted);
        const file = sessionFilePath(record.acpxRecordId);
        const tempFile = createAtomicWriteTempPath(file);
        const payload = JSON.stringify(persisted, null, 2);
        await fs.writeFile(tempFile, `${payload}\n`, "utf8");
        await fs.rename(tempFile, file);
        const sessionDir = sessionBaseDir();
        const index = await loadOrRebuildSessionIndex(sessionDir);
        const fileName = path.basename(file);
        const entries = index.entries.filter((entry) => entry.file !== fileName);
        entries.push(toSessionIndexEntry(record, fileName));
        const files = [...new Set([...index.files.filter((entry) => entry !== fileName), fileName])];
        await writeSessionIndex(sessionDir, { files, entries });
    });
}
export async function resolveSessionRecord(sessionId) {
    await ensureSessionDir();
    const directPath = sessionFilePath(sessionId);
    try {
        const directPayload = await measurePerf("session.resolve_direct", async () => {
            return await fs.readFile(directPath, "utf8");
        });
        const directRecord = parseSessionRecord(JSON.parse(directPayload));
        if (directRecord) {
            return directRecord;
        }
    }
    catch {
        // fallback to indexed search
    }
    const entries = await loadSessionIndexEntries();
    const exactEntries = entries.filter((entry) => entry.acpxRecordId === sessionId || entry.acpSessionId === sessionId);
    const exactRecords = (await Promise.all(exactEntries.map((entry) => loadRecordFromIndexEntry(entry)))).filter((entry) => Boolean(entry));
    if (exactRecords.length === 1) {
        return exactRecords[0];
    }
    if (exactRecords.length > 1) {
        throw new SessionResolutionError(`Multiple sessions match id: ${sessionId}`);
    }
    const suffixEntries = entries.filter((entry) => entry.acpxRecordId.endsWith(sessionId) || entry.acpSessionId.endsWith(sessionId));
    const suffixRecords = (await Promise.all(suffixEntries.map((entry) => loadRecordFromIndexEntry(entry)))).filter((entry) => Boolean(entry));
    if (suffixRecords.length === 1) {
        return suffixRecords[0];
    }
    if (suffixRecords.length > 1) {
        throw new SessionResolutionError(`Session id is ambiguous: ${sessionId}`);
    }
    incrementPerfCounter("session.resolve_miss");
    throw new SessionNotFoundError(sessionId);
}
function hasGitDirectory(dir) {
    const gitPath = path.join(dir, ".git");
    try {
        return statSync(gitPath).isDirectory();
    }
    catch {
        return false;
    }
}
function isWithinBoundary(boundary, target) {
    const relative = path.relative(boundary, target);
    return relative.length === 0 || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function absolutePath(value) {
    return path.resolve(value);
}
export function findGitRepositoryRoot(startDir) {
    let current = absolutePath(startDir);
    const root = path.parse(current).root;
    for (;;) {
        if (hasGitDirectory(current)) {
            return current;
        }
        if (current === root) {
            return undefined;
        }
        const parent = path.dirname(current);
        if (parent === current) {
            return undefined;
        }
        current = parent;
    }
}
export function normalizeName(value) {
    if (value == null) {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
export function isoNow() {
    return new Date().toISOString();
}
export async function listSessions() {
    await ensureSessionDir();
    const entries = await loadSessionIndexEntries();
    const records = [];
    for (const entry of entries) {
        const parsed = await loadRecordFromIndexEntry(entry);
        if (parsed) {
            records.push(parsed);
        }
    }
    records.sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
    return records;
}
export async function listSessionsForAgent(agentCommand) {
    const entries = (await loadSessionIndexEntries()).filter((session) => session.agentCommand === agentCommand);
    const records = await Promise.all(entries.map((entry) => loadRecordFromIndexEntry(entry)));
    return records
        .filter((entry) => Boolean(entry))
        .toSorted((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
}
export async function findSession(options) {
    const normalizedCwd = absolutePath(options.cwd);
    const normalizedName = normalizeName(options.name);
    const entries = await loadSessionIndexEntries();
    const match = entries.find((session) => session.agentCommand === options.agentCommand &&
        matchesSessionEntry(session, normalizedCwd, normalizedName, options.includeClosed));
    if (!match) {
        return undefined;
    }
    return await loadRecordFromIndexEntry(match);
}
export async function findSessionByDirectoryWalk(options) {
    const normalizedName = normalizeName(options.name);
    const normalizedStart = absolutePath(options.cwd);
    const normalizedBoundary = absolutePath(options.boundary ?? normalizedStart);
    const walkBoundary = isWithinBoundary(normalizedBoundary, normalizedStart)
        ? normalizedBoundary
        : normalizedStart;
    const sessions = (await loadSessionIndexEntries()).filter((session) => session.agentCommand === options.agentCommand);
    let current = normalizedStart;
    const walkRoot = path.parse(current).root;
    for (;;) {
        const match = sessions.find((session) => matchesSessionEntry(session, current, normalizedName));
        if (match) {
            return await loadRecordFromIndexEntry(match);
        }
        const parent = nextWalkParent(current, walkBoundary, walkRoot);
        if (!parent) {
            return undefined;
        }
        current = parent;
    }
}
function nextWalkParent(current, walkBoundary, walkRoot) {
    if (current === walkBoundary || current === walkRoot) {
        return undefined;
    }
    const parent = path.dirname(current);
    if (parent === current || !isWithinBoundary(walkBoundary, parent)) {
        return undefined;
    }
    return parent;
}
function killSignalCandidates(signal) {
    if (!signal) {
        return ["SIGTERM", "SIGKILL"];
    }
    const normalized = signal.toUpperCase();
    if (normalized === "SIGKILL") {
        return ["SIGKILL"];
    }
    return [normalized, "SIGKILL"];
}
function closedAtOrLastUsedAt(record) {
    return record.closedAt ?? record.lastUsedAt;
}
function isSessionStreamFile(fileName, safeId) {
    return (fileName === `${safeId}.stream.ndjson` ||
        fileName === `${safeId}.stream.lock` ||
        fileName.startsWith(`${safeId}.stream.`));
}
export async function pruneSessions(options = {}) {
    await ensureSessionDir();
    const entries = await loadSessionIndexEntries();
    const eligible = filterPruneCandidates(entries, options.agentCommand);
    const cutoff = options.before ??
        (options.olderThanMs != null ? new Date(Date.now() - options.olderThanMs) : undefined);
    const records = await loadPrunableRecords(eligible, cutoff);
    if (options.dryRun) {
        return { pruned: records, bytesFreed: 0, dryRun: true };
    }
    const sessionDir = sessionBaseDir();
    let bytesFreed = 0;
    // Read the directory once upfront so stream-file matching doesn't re-read
    // it for every session in the loop.
    let dirEntries = [];
    if (options.includeHistory) {
        try {
            dirEntries = await fs.readdir(sessionDir);
        }
        catch {
            // ignore
        }
    }
    for (const record of records) {
        bytesFreed += await pruneSessionFiles(record, sessionDir, dirEntries, options.includeHistory === true);
    }
    await rebuildSessionIndex(sessionDir).catch(() => {
        // best effort cache rebuild
    });
    return { pruned: records, bytesFreed, dryRun: false };
}
function filterPruneCandidates(entries, agentCommand) {
    return entries.filter((entry) => entry.closed && (!agentCommand || entry.agentCommand === agentCommand));
}
async function loadPrunableRecords(entries, cutoff) {
    const records = [];
    const cutoffIso = cutoff?.toISOString();
    for (const entry of entries) {
        const record = await loadRecordFromIndexEntry(entry);
        if (record && isBeforeCutoff(record, cutoffIso)) {
            records.push(record);
        }
    }
    return records;
}
function isBeforeCutoff(record, cutoffIso) {
    return !cutoffIso || closedAtOrLastUsedAt(record) < cutoffIso;
}
async function pruneSessionFiles(record, sessionDir, dirEntries, includeHistory) {
    const safeId = encodeURIComponent(record.acpxRecordId);
    let bytesFreed = await unlinkCountingBytes(path.join(sessionDir, `${safeId}.json`));
    if (includeHistory) {
        for (const name of dirEntries.filter((entry) => isSessionStreamFile(entry, safeId))) {
            bytesFreed += await unlinkCountingBytes(path.join(sessionDir, name));
        }
    }
    return bytesFreed;
}
async function unlinkCountingBytes(filePath) {
    let bytes = 0;
    try {
        const stat = await fs.stat(filePath);
        bytes = stat.size;
    }
    catch {
        // file already gone
    }
    await fs.unlink(filePath).catch(() => undefined);
    return bytes;
}
export async function closeSession(id) {
    const record = await resolveSessionRecord(id);
    const now = isoNow();
    if (record.pid) {
        for (const signal of killSignalCandidates(record.lastAgentExitSignal ?? undefined)) {
            try {
                process.kill(record.pid, signal);
            }
            catch {
                // ignore
            }
        }
    }
    record.closed = true;
    record.closedAt = now;
    record.pid = undefined;
    record.lastUsedAt = now;
    record.lastPromptAt = record.lastPromptAt ?? now;
    await writeSessionRecord(record);
    await rebuildSessionIndex(sessionBaseDir()).catch(() => {
        // best effort cache rebuild
    });
    return record;
}
