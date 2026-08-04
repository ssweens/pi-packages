import fs from "node:fs/promises";
import path from "node:path";
import { assertPersistedKeyPolicy } from "../../persisted-key-policy.js";
import { createAtomicWriteTempPath } from "../../session/persistence/atomic-write.js";
import { parseSessionRecord } from "../../session/persistence/parse.js";
import { serializeSessionRecordForDisk } from "../../session/persistence/serialize.js";
function safeSessionId(sessionId) {
    return encodeURIComponent(sessionId);
}
class FileSessionStore {
    stateDir;
    constructor(stateDir) {
        this.stateDir = stateDir;
    }
    get sessionDir() {
        return path.join(this.stateDir, "sessions");
    }
    filePath(sessionId) {
        return path.join(this.sessionDir, `${safeSessionId(sessionId)}.json`);
    }
    async ensureDir() {
        await fs.mkdir(this.sessionDir, { recursive: true });
    }
    async load(sessionId) {
        await this.ensureDir();
        let payload;
        try {
            payload = await fs.readFile(this.filePath(sessionId), "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return undefined;
            }
            throw error;
        }
        let parsed;
        try {
            parsed = JSON.parse(payload);
        }
        catch {
            return undefined;
        }
        return parseSessionRecord(parsed) ?? undefined;
    }
    async save(record) {
        await this.ensureDir();
        const persisted = serializeSessionRecordForDisk(record);
        assertPersistedKeyPolicy(persisted);
        const file = this.filePath(record.acpxRecordId);
        const tempFile = createAtomicWriteTempPath(file);
        const payload = JSON.stringify(persisted, null, 2);
        await fs.writeFile(tempFile, `${payload}\n`, "utf8");
        await fs.rename(tempFile, file);
    }
}
export function createFileSessionStore(options) {
    return new FileSessionStore(path.resolve(options.stateDir));
}
