export const EXIT_CODES = {
    SUCCESS: 0,
    ERROR: 1,
    USAGE: 2,
    TIMEOUT: 3,
    NO_SESSION: 4,
    PERMISSION_DENIED: 5,
    INTERRUPTED: 130,
};
export const OUTPUT_FORMATS = ["text", "json", "quiet"];
export const PERMISSION_MODES = ["approve-all", "approve-reads", "deny-all"];
export const AUTH_POLICIES = ["skip", "fail"];
export const NON_INTERACTIVE_PERMISSION_POLICIES = ["deny", "fail"];
export const PERMISSION_POLICY_ACTIONS = ["approve", "deny", "escalate"];
export const SESSION_RESUME_POLICIES = ["allow-new", "same-session-only"];
export const OUTPUT_STREAMS = ["prompt", "control"];
export const OUTPUT_ERROR_CODES = [
    "NO_SESSION",
    "TIMEOUT",
    "PERMISSION_DENIED",
    "PERMISSION_PROMPT_UNAVAILABLE",
    "RUNTIME",
    "USAGE",
];
export const OUTPUT_ERROR_ORIGINS = ["cli", "runtime", "queue", "acp"];
export const QUEUE_ERROR_DETAIL_CODES = [
    "QUEUE_OWNER_CLOSED",
    "QUEUE_OWNER_SHUTTING_DOWN",
    "QUEUE_OWNER_OVERLOADED",
    "QUEUE_OWNER_GENERATION_MISMATCH",
    "QUEUE_REQUEST_INVALID",
    "QUEUE_REQUEST_PAYLOAD_INVALID_JSON",
    "QUEUE_ACK_MISSING",
    "QUEUE_DISCONNECTED_BEFORE_ACK",
    "QUEUE_DISCONNECTED_BEFORE_COMPLETION",
    "QUEUE_PROTOCOL_INVALID_JSON",
    "QUEUE_PROTOCOL_MALFORMED_MESSAGE",
    "QUEUE_PROTOCOL_UNEXPECTED_RESPONSE",
    "QUEUE_NOT_ACCEPTING_REQUESTS",
    "QUEUE_CONTROL_REQUEST_FAILED",
    "QUEUE_RUNTIME_PROMPT_FAILED",
];
export const SESSION_RECORD_SCHEMA = "acpx.session.v1";
