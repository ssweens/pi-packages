import type { SessionRecord } from "../../types.js";
export type SystemPromptOption = string | {
    append: string;
};
export type SessionAgentOptions = {
    model?: string;
    allowedTools?: string[];
    maxTurns?: number;
    systemPrompt?: SystemPromptOption;
    /**
     * Per-agent environment variables injected into the spawned agent child
     * process and persisted with the session record for reconnects. Keys here
     * override the parent process environment for the spawned child, except
     * acpx-managed auth credential keys. Do not put secrets here; use
     * authCredentials for credentials. Callers are responsible for sanitizing
     * dangerous keys such as `PATH`, `LD_PRELOAD`, and `NODE_OPTIONS` before
     * passing them to acpx.
     */
    env?: Record<string, string>;
};
export declare function mergeSessionOptions(preferred: SessionAgentOptions | undefined, fallback: SessionAgentOptions | undefined): SessionAgentOptions | undefined;
export declare function persistSessionOptions(record: SessionRecord, options: SessionAgentOptions | undefined): void;
export declare function sessionOptionsFromRecord(record: SessionRecord): SessionAgentOptions | undefined;
