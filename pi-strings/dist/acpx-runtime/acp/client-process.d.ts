import { type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import { Readable, Writable } from "node:stream";
export type CommandParts = {
    command: string;
    args: string[];
};
export declare function normalizeAgentCommandInput(value: string | readonly string[]): {
    agentCommand: string;
    agentArgv?: string[];
};
export declare function renderArgvIdentity(argv: readonly string[]): string;
type ResolveSessionCwdOptions = {
    platform?: NodeJS.Platform;
    existsSync?: (filePath: string) => boolean;
    runWslpath?: (cwd: string) => Promise<string>;
};
export declare function isoNow(): string;
export declare function waitForSpawn(child: ChildProcess): Promise<void>;
export declare function isChildProcessRunning(child: ChildProcess): boolean;
export declare function requireAgentStdio(child: ChildProcess): ChildProcessByStdio<Writable, Readable, Readable>;
export declare function waitForChildExit(child: ChildProcessByStdio<Writable, Readable, Readable>, timeoutMs: number): Promise<boolean>;
export declare function resolveAgentCommandParts(value: string, argv: readonly string[] | undefined, platform?: NodeJS.Platform): CommandParts;
export declare function splitCommandLine(value: string): CommandParts;
export declare function asAbsoluteCwd(cwd: string): string;
export declare function resolveAgentSessionCwd(cwd: string, agentCommand: string, options?: ResolveSessionCwdOptions): Promise<string>;
export declare function basenameToken(value: string): string;
export {};
