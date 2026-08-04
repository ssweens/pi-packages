import type { CreateTerminalRequest, CreateTerminalResponse, KillTerminalRequest, KillTerminalResponse, ReleaseTerminalRequest, ReleaseTerminalResponse, TerminalOutputRequest, TerminalOutputResponse, WaitForTerminalExitRequest, WaitForTerminalExitResponse } from "@agentclientprotocol/sdk";
import type { ClientOperation, NonInteractivePermissionPolicy, PermissionMode } from "../types.js";
export type TerminalManagerOptions = {
    cwd: string;
    permissionMode: PermissionMode;
    nonInteractivePermissions?: NonInteractivePermissionPolicy;
    onOperation?: (operation: ClientOperation) => void;
    confirmExecute?: (commandLine: string) => Promise<boolean>;
    killGraceMs?: number;
};
type TerminalSpawnOptions = {
    cwd: string;
    env: NodeJS.ProcessEnv | undefined;
    stdio: ["ignore", "pipe", "pipe"];
    detached?: boolean;
    shell?: true;
    windowsHide: true;
};
export declare function buildTerminalSpawnOptions(command: string, cwd: string, env: CreateTerminalRequest["env"], platform?: NodeJS.Platform): TerminalSpawnOptions;
export declare class TerminalManager {
    private readonly cwd;
    private permissionMode;
    private nonInteractivePermissions;
    private readonly onOperation?;
    private readonly usesDefaultConfirmExecute;
    private readonly confirmExecute;
    private readonly killGraceMs;
    private readonly terminals;
    constructor(options: TerminalManagerOptions);
    updatePermissionPolicy(permissionMode: PermissionMode, nonInteractivePermissions?: NonInteractivePermissionPolicy): void;
    createTerminal(params: CreateTerminalRequest): Promise<CreateTerminalResponse>;
    terminalOutput(params: TerminalOutputRequest): Promise<TerminalOutputResponse>;
    waitForTerminalExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
    killTerminal(params: KillTerminalRequest): Promise<KillTerminalResponse>;
    releaseTerminal(params: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse>;
    shutdown(): Promise<void>;
    private getTerminal;
    private emitOperation;
    private isExecuteApproved;
    private isRunning;
    private killProcess;
    private signalProcess;
    private signalWindowsProcessGroup;
    private signalPosixProcessGroup;
    private captureDescendantPids;
    private waitForCleanupAfterSignal;
    private waitForTerminalAndTrackedDescendants;
}
export {};
