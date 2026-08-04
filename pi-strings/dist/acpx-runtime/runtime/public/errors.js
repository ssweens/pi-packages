export const ACP_ERROR_CODES = [
    "ACP_BACKEND_MISSING",
    "ACP_BACKEND_UNAVAILABLE",
    "ACP_BACKEND_UNSUPPORTED_CONTROL",
    "ACP_DISPATCH_DISABLED",
    "ACP_INVALID_RUNTIME_OPTION",
    "ACP_SESSION_INIT_FAILED",
    "ACP_TURN_FAILED",
];
export class AcpRuntimeError extends Error {
    code;
    cause;
    constructor(code, message, options) {
        super(message);
        this.name = "AcpRuntimeError";
        this.code = code;
        this.cause = options?.cause;
    }
}
export function isAcpRuntimeError(value) {
    return value instanceof AcpRuntimeError;
}
