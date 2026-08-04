const AGENT_SESSION_ID_META_KEYS = ["agentSessionId", "sessionId"];
export function normalizeAgentSessionId(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function asMetaRecord(meta) {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        return undefined;
    }
    return meta;
}
export function extractAgentSessionId(meta) {
    const record = asMetaRecord(meta);
    if (!record) {
        return undefined;
    }
    for (const key of AGENT_SESSION_ID_META_KEYS) {
        const normalized = normalizeAgentSessionId(record[key]);
        if (normalized) {
            return normalized;
        }
    }
    return undefined;
}
export { AGENT_SESSION_ID_META_KEYS };
