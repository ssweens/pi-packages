declare const AGENT_SESSION_ID_META_KEYS: readonly ["agentSessionId", "sessionId"];
export declare function normalizeAgentSessionId(value: unknown): string | undefined;
export declare function extractAgentSessionId(meta: unknown): string | undefined;
export { AGENT_SESSION_ID_META_KEYS };
