import os from "node:os";
import path from "node:path";
export const DEFAULT_EVENT_SEGMENT_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_EVENT_MAX_SEGMENTS = 5;
export function sessionBaseDir() {
    return path.join(os.homedir(), ".acpx", "sessions");
}
export function safeSessionId(sessionId) {
    return encodeURIComponent(sessionId);
}
export function sessionEventActivePath(sessionId) {
    return path.join(sessionBaseDir(), `${safeSessionId(sessionId)}.stream.ndjson`);
}
export function sessionEventSegmentPath(sessionId, segment) {
    return path.join(sessionBaseDir(), `${safeSessionId(sessionId)}.stream.${segment}.ndjson`);
}
export function sessionEventLockPath(sessionId) {
    return path.join(sessionBaseDir(), `${safeSessionId(sessionId)}.stream.lock`);
}
export function defaultSessionEventLog(sessionId) {
    return {
        active_path: sessionEventActivePath(sessionId),
        segment_count: DEFAULT_EVENT_MAX_SEGMENTS,
        max_segment_bytes: DEFAULT_EVENT_SEGMENT_MAX_BYTES,
        max_segments: DEFAULT_EVENT_MAX_SEGMENTS,
        last_write_at: undefined,
        last_write_error: null,
    };
}
