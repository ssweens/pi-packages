export declare const RUNTIME_SESSION_ID_META_KEYS: readonly ["agentSessionId", "sessionId"];
export declare function normalizeRuntimeSessionId(value: unknown): string | undefined;
export declare function extractRuntimeSessionId(meta: unknown): string | undefined;
