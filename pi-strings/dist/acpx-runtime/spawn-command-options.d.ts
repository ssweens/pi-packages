import { spawn } from "node:child_process";
export declare function readWindowsEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined;
export declare function resolveWindowsCommand(command: string, env?: NodeJS.ProcessEnv): string | undefined;
/**
 * Resolve a Windows command to a native executable suitable for direct spawn.
 *
 * Batch and PowerShell shims are intentionally rejected unless they point at a
 * real `.exe` entrypoint. Callers that need shell execution should use the
 * command-specific shell policy instead.
 */
export declare function resolveWindowsExecutablePath(command: string, env?: NodeJS.ProcessEnv): string | undefined;
export type AgentSpawnCommand = {
    command: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
};
export declare function buildAgentSpawnCommand(command: string, args: readonly string[], platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): AgentSpawnCommand;
export declare function buildSpawnCommandOptions(command: string, options: Parameters<typeof spawn>[2], platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): Parameters<typeof spawn>[2];
export type TerminalSpawnCommand = {
    command: string;
    args: string[];
    killProcessGroup: boolean;
};
export declare function buildTerminalSpawnCommand(command: string, args: string[] | undefined): TerminalSpawnCommand;
export declare function buildTerminalShellSpawnCommand(command: string, platform?: NodeJS.Platform): TerminalSpawnCommand;
