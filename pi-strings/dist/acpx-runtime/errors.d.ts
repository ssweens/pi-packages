import type { OutputErrorAcpPayload, OutputErrorCode, OutputErrorOrigin } from "./types.js";
type AcpxErrorOptions = ErrorOptions & {
    outputCode?: OutputErrorCode;
    detailCode?: string;
    origin?: OutputErrorOrigin;
    retryable?: boolean;
    acp?: OutputErrorAcpPayload;
    outputAlreadyEmitted?: boolean;
};
export declare class AcpxOperationalError extends Error {
    readonly outputCode?: OutputErrorCode;
    readonly detailCode?: string;
    readonly origin?: OutputErrorOrigin;
    readonly retryable?: boolean;
    readonly acp?: OutputErrorAcpPayload;
    readonly outputAlreadyEmitted?: boolean;
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class SessionNotFoundError extends AcpxOperationalError {
    readonly sessionId: string;
    constructor(sessionId: string);
}
export declare class SessionResolutionError extends AcpxOperationalError {
}
export declare class AgentSpawnError extends AcpxOperationalError {
    readonly agentCommand: string;
    constructor(agentCommand: string, cause?: unknown);
}
export declare class AgentStartupError extends AcpxOperationalError {
    readonly agentCommand: string;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly stderrSummary?: string;
    constructor(params: {
        agentCommand: string;
        exitCode: number | null;
        signal: NodeJS.Signals | null;
        stderrSummary?: string;
        cause?: unknown;
    });
}
export declare class AgentDisconnectedError extends AcpxOperationalError {
    readonly reason: string;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    constructor(reason: string, exitCode: number | null, signal: NodeJS.Signals | null, options?: AcpxErrorOptions);
}
export declare class UnsupportedPromptContentError extends AcpxOperationalError {
    constructor(message: string);
}
export declare class SessionResumeRequiredError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class GeminiAcpStartupTimeoutError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class SessionModeReplayError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class SessionModelReplayError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class SessionConfigOptionReplayError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class ClaudeAcpSessionCreateTimeoutError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class CopilotAcpUnsupportedError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class AuthPolicyError extends AcpxOperationalError {
    constructor(message: string, options?: AcpxErrorOptions);
}
export declare class QueueConnectionError extends AcpxOperationalError {
}
export declare class QueueProtocolError extends AcpxOperationalError {
}
export declare class PermissionDeniedError extends AcpxOperationalError {
}
export declare class PermissionPromptUnavailableError extends AcpxOperationalError {
    constructor();
}
export {};
