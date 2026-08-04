import type { AcpClientOptions } from "../types.js";
export declare function readEnvCredential(methodId: string): string | undefined;
export declare function resolveConfiguredAuthCredential(methodId: string, authCredentials: AcpClientOptions["authCredentials"]): string | undefined;
export declare function buildAgentSpawnOptions(cwd: string, authCredentials: Record<string, string> | undefined, sessionEnv?: Record<string, string>): {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ["pipe", "pipe", "pipe"];
    windowsHide: true;
};
