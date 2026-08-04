import { type ExitCode, type OutputErrorAcpPayload, type OutputErrorCode, type OutputErrorOrigin } from "../types.js";
import { extractAcpError, isAcpResourceNotFoundError } from "./error-shapes.js";
export type NormalizedOutputError = {
    code: OutputErrorCode;
    message: string;
    detailCode?: string;
    origin?: OutputErrorOrigin;
    retryable?: boolean;
    acp?: OutputErrorAcpPayload;
};
export type NormalizeOutputErrorOptions = {
    defaultCode?: OutputErrorCode;
    detailCode?: string;
    origin?: OutputErrorOrigin;
    retryable?: boolean;
    acp?: OutputErrorAcpPayload;
};
export declare function formatErrorMessage(error: unknown): string;
export { extractAcpError, isAcpResourceNotFoundError };
export declare function isAcpQueryClosedBeforeResponseError(error: unknown): boolean;
export declare function normalizeOutputError(error: unknown, options?: NormalizeOutputErrorOptions): NormalizedOutputError;
/**
 * Returns true when an error from `client.prompt()` looks transient and
 * can reasonably be retried (e.g. model-API 400/500, network hiccups that
 * surface as ACP internal errors).
 *
 * Errors that are definitively non-recoverable (auth, missing session,
 * invalid params, timeout, permission) return false.
 */
export declare function isRetryablePromptError(error: unknown): boolean;
export declare function exitCodeForOutputErrorCode(code: OutputErrorCode): ExitCode;
