import type { SessionRecord } from "../../types.js";
export declare const DEFAULT_HISTORY_LIMIT = 20;
type FindSessionOptions = {
    agentCommand: string;
    cwd: string;
    name?: string;
    includeClosed?: boolean;
};
type FindSessionByDirectoryWalkOptions = {
    agentCommand: string;
    cwd: string;
    name?: string;
    boundary?: string;
};
export declare function writeSessionRecord(record: SessionRecord): Promise<void>;
export declare function resolveSessionRecord(sessionId: string): Promise<SessionRecord>;
export declare function absolutePath(value: string): string;
export declare function findGitRepositoryRoot(startDir: string): string | undefined;
export declare function normalizeName(value: string | undefined): string | undefined;
export declare function isoNow(): string;
export declare function listSessions(): Promise<SessionRecord[]>;
export declare function listSessionsForAgent(agentCommand: string): Promise<SessionRecord[]>;
export declare function findSession(options: FindSessionOptions): Promise<SessionRecord | undefined>;
export declare function findSessionByDirectoryWalk(options: FindSessionByDirectoryWalkOptions): Promise<SessionRecord | undefined>;
export type PruneOptions = {
    agentCommand?: string;
    before?: Date;
    olderThanMs?: number;
    includeHistory?: boolean;
    dryRun?: boolean;
};
export type PruneResult = {
    pruned: SessionRecord[];
    bytesFreed: number;
    dryRun: boolean;
};
export declare function pruneSessions(options?: PruneOptions): Promise<PruneResult>;
export declare function closeSession(id: string): Promise<SessionRecord>;
export {};
