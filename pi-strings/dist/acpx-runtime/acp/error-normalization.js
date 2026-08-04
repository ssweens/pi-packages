import { AuthPolicyError, PermissionDeniedError, PermissionPromptUnavailableError, } from "../errors.js";
import { EXIT_CODES, OUTPUT_ERROR_CODES, OUTPUT_ERROR_ORIGINS, } from "../types.js";
import { extractAcpError, formatUnknownErrorMessage, isAcpResourceNotFoundError, } from "./error-shapes.js";
const AUTH_REQUIRED_ACP_CODES = new Set([-32000]);
const QUERY_CLOSED_BEFORE_RESPONSE_DETAIL = "query closed before response received";
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function isAuthRequiredMessage(value) {
    if (!value) {
        return false;
    }
    const normalized = value.toLowerCase();
    return [
        "auth required",
        "authentication required",
        "authorization required",
        "credential required",
        "credentials required",
        "token required",
        "login required",
    ].some((needle) => normalized.includes(needle));
}
function isAcpAuthRequiredPayload(acp) {
    if (!acp) {
        return false;
    }
    if (!AUTH_REQUIRED_ACP_CODES.has(acp.code)) {
        return false;
    }
    if (isAuthRequiredMessage(acp.message)) {
        return true;
    }
    const data = asRecord(acp.data);
    if (!data) {
        return false;
    }
    return hasAuthRequiredData(data);
}
function hasAuthRequiredData(data) {
    return (data.authRequired === true || hasNonEmptyString(data.methodId) || hasNonEmptyArray(data.methods));
}
function hasNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function hasNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}
function isOutputErrorCode(value) {
    return typeof value === "string" && OUTPUT_ERROR_CODES.includes(value);
}
function isOutputErrorOrigin(value) {
    return typeof value === "string" && OUTPUT_ERROR_ORIGINS.includes(value);
}
function readOutputErrorMeta(error) {
    const record = asRecord(error);
    if (!record) {
        return {};
    }
    const outputCode = isOutputErrorCode(record.outputCode) ? record.outputCode : undefined;
    const detailCode = typeof record.detailCode === "string" && record.detailCode.trim().length > 0
        ? record.detailCode
        : undefined;
    const origin = isOutputErrorOrigin(record.origin) ? record.origin : undefined;
    const retryable = typeof record.retryable === "boolean" ? record.retryable : undefined;
    const acp = extractAcpError(record.acp);
    return {
        outputCode,
        detailCode,
        origin,
        retryable,
        acp,
    };
}
function isTimeoutLike(error) {
    return error instanceof Error && error.name === "TimeoutError";
}
function isNoSessionLike(error) {
    return error instanceof Error && error.name === "NoSessionError";
}
function isUsageLike(error) {
    if (!(error instanceof Error)) {
        return false;
    }
    return (error.name === "CommanderError" ||
        error.name === "InvalidArgumentError" ||
        asRecord(error)?.code === "commander.invalidArgument");
}
export function formatErrorMessage(error) {
    return formatUnknownErrorMessage(error);
}
export { extractAcpError, isAcpResourceNotFoundError };
export function isAcpQueryClosedBeforeResponseError(error) {
    const acp = extractAcpError(error);
    if (!acp || acp.code !== -32603) {
        return false;
    }
    const data = asRecord(acp.data);
    const details = data?.details;
    if (typeof details !== "string") {
        return false;
    }
    return details.toLowerCase().includes(QUERY_CLOSED_BEFORE_RESPONSE_DETAIL);
}
function mapErrorCode(error) {
    if (error instanceof PermissionPromptUnavailableError) {
        return "PERMISSION_PROMPT_UNAVAILABLE";
    }
    if (error instanceof PermissionDeniedError) {
        return "PERMISSION_DENIED";
    }
    if (isTimeoutLike(error)) {
        return "TIMEOUT";
    }
    if (isNoSessionLike(error) || isAcpResourceNotFoundError(error)) {
        return "NO_SESSION";
    }
    if (isUsageLike(error)) {
        return "USAGE";
    }
    return undefined;
}
export function normalizeOutputError(error, options = {}) {
    const meta = readOutputErrorMeta(error);
    const code = resolveOutputErrorCode(error, options, meta);
    const acp = options.acp ?? meta.acp ?? extractAcpError(error);
    return {
        code,
        message: formatErrorMessage(error),
        detailCode: resolveDetailCode(error, acp, options, meta),
        origin: meta.origin ?? options.origin,
        retryable: meta.retryable ?? options.retryable,
        acp,
    };
}
function resolveOutputErrorCode(error, options, meta) {
    const code = meta.outputCode ?? mapErrorCode(error) ?? options.defaultCode ?? "RUNTIME";
    if (code === "RUNTIME" && isAcpResourceNotFoundError(error)) {
        return "NO_SESSION";
    }
    return code;
}
function resolveDetailCode(error, acp, options, meta) {
    return (meta.detailCode ??
        options.detailCode ??
        (error instanceof AuthPolicyError || isAcpAuthRequiredPayload(acp)
            ? "AUTH_REQUIRED"
            : undefined));
}
/**
 * Returns true when an error from `client.prompt()` looks transient and
 * can reasonably be retried (e.g. model-API 400/500, network hiccups that
 * surface as ACP internal errors).
 *
 * Errors that are definitively non-recoverable (auth, missing session,
 * invalid params, timeout, permission) return false.
 */
export function isRetryablePromptError(error) {
    if (isNonRetryablePromptError(error)) {
        return false;
    }
    // Extract ACP payload once and reuse for all subsequent checks.
    const acp = extractAcpError(error);
    if (!acp) {
        // Non-ACP errors (e.g. process crash) are not retried at the prompt level.
        return false;
    }
    if (isPermanentPromptAcpError(acp)) {
        return false;
    }
    // ACP internal errors (-32603) typically wrap model-API failures → retryable.
    // Parse errors (-32700) can also be transient.
    return acp.code === -32603 || acp.code === -32700;
}
function isNonRetryablePromptError(error) {
    return (error instanceof PermissionDeniedError ||
        error instanceof PermissionPromptUnavailableError ||
        isTimeoutLike(error) ||
        isNoSessionLike(error) ||
        isUsageLike(error));
}
function isPermanentPromptAcpError(acp) {
    return (acp.code === -32001 ||
        acp.code === -32002 ||
        acp.code === -32601 ||
        acp.code === -32602 ||
        isAcpAuthRequiredPayload(acp));
}
export function exitCodeForOutputErrorCode(code) {
    switch (code) {
        case "USAGE":
            return EXIT_CODES.USAGE;
        case "TIMEOUT":
            return EXIT_CODES.TIMEOUT;
        case "NO_SESSION":
            return EXIT_CODES.NO_SESSION;
        case "PERMISSION_DENIED":
        case "PERMISSION_PROMPT_UNAVAILABLE":
            return EXIT_CODES.PERMISSION_DENIED;
        case "RUNTIME":
        default:
            return EXIT_CODES.ERROR;
    }
}
