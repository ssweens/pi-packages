export function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function asTrimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
}
export function asString(value) {
    return typeof value === "string" ? value : undefined;
}
export function asOptionalString(value) {
    const text = asTrimmedString(value);
    return text || undefined;
}
export function asOptionalBoolean(value) {
    return typeof value === "boolean" ? value : undefined;
}
export function deriveAgentFromSessionKey(sessionKey, fallbackAgent) {
    const match = sessionKey.match(/^agent:([^:]+):/i);
    const candidate = match?.[1] ? asTrimmedString(match[1]) : "";
    return candidate || fallbackAgent;
}
