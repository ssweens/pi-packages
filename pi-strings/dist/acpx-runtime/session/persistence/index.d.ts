import type { SessionRecord } from "../../types.js";
declare const SESSION_INDEX_SCHEMA = "acpx.session-index.v1";
export type SessionIndexEntry = {
    file: string;
    acpxRecordId: string;
    acpSessionId: string;
    agentCommand: string;
    cwd: string;
    name?: string;
    closed: boolean;
    lastUsedAt: string;
};
type SessionIndex = {
    schema: typeof SESSION_INDEX_SCHEMA;
    files: string[];
    entries: SessionIndexEntry[];
};
export declare function sessionIndexPath(sessionDir: string): string;
export declare function toSessionIndexEntry(record: SessionRecord, fileName: string): SessionIndexEntry;
export declare function readSessionIndex(sessionDir: string): Promise<SessionIndex | undefined>;
export declare function writeSessionIndex(sessionDir: string, index: {
    files: string[];
    entries: SessionIndexEntry[];
}): Promise<void>;
export declare function rebuildSessionIndex(sessionDir: string): Promise<SessionIndex>;
export declare function loadOrRebuildSessionIndex(sessionDir: string): Promise<SessionIndex>;
export {};
