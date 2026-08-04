import { AGENT_SESSION_ID_META_KEYS, extractAgentSessionId, normalizeAgentSessionId, } from "../acp/agent-session-id.js";
export const RUNTIME_SESSION_ID_META_KEYS = AGENT_SESSION_ID_META_KEYS;
export function normalizeRuntimeSessionId(value) {
    return normalizeAgentSessionId(value);
}
export function extractRuntimeSessionId(meta) {
    return extractAgentSessionId(meta);
}
