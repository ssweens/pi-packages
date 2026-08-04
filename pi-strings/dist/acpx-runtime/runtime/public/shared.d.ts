export type AcpxHandleState = {
    name: string;
    agent: string;
    cwd: string;
    mode: "persistent" | "oneshot";
    acpxRecordId?: string;
    backendSessionId?: string;
    agentSessionId?: string;
};
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function asTrimmedString(value: unknown): string;
export declare function asString(value: unknown): string | undefined;
export declare function asOptionalString(value: unknown): string | undefined;
export declare function asOptionalBoolean(value: unknown): boolean | undefined;
export declare function deriveAgentFromSessionKey(sessionKey: string, fallbackAgent: string): string;
