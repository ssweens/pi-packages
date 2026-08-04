export class AcpxOperationalError extends Error {
    outputCode;
    detailCode;
    origin;
    retryable;
    acp;
    outputAlreadyEmitted;
    constructor(message, options) {
        super(message, options);
        this.name = new.target.name;
        this.outputCode = options?.outputCode;
        this.detailCode = options?.detailCode;
        this.origin = options?.origin;
        this.retryable = options?.retryable;
        this.acp = options?.acp;
        this.outputAlreadyEmitted = options?.outputAlreadyEmitted;
    }
}
export class SessionNotFoundError extends AcpxOperationalError {
    sessionId;
    constructor(sessionId) {
        super(`Session not found: ${sessionId}`);
        this.sessionId = sessionId;
    }
}
export class SessionResolutionError extends AcpxOperationalError {
}
export class AgentSpawnError extends AcpxOperationalError {
    agentCommand;
    constructor(agentCommand, cause) {
        super(`Failed to spawn agent command: ${agentCommand}`, {
            cause: cause instanceof Error ? cause : undefined,
        });
        this.agentCommand = agentCommand;
    }
}
export class AgentStartupError extends AcpxOperationalError {
    agentCommand;
    exitCode;
    signal;
    stderrSummary;
    constructor(params) {
        const exitSummary = `exit=${params.exitCode ?? "null"}, signal=${params.signal ?? "null"}`;
        const stderrSuffix = typeof params.stderrSummary === "string" && params.stderrSummary.trim().length > 0
            ? `: ${params.stderrSummary.trim()}`
            : "";
        super(`ACP agent exited before initialize completed (${exitSummary})${stderrSuffix}`, {
            cause: params.cause instanceof Error ? params.cause : undefined,
            outputCode: "RUNTIME",
            detailCode: "AGENT_STARTUP_FAILED",
            origin: "acp",
        });
        this.agentCommand = params.agentCommand;
        this.exitCode = params.exitCode;
        this.signal = params.signal;
        this.stderrSummary = params.stderrSummary?.trim() || undefined;
    }
}
export class AgentDisconnectedError extends AcpxOperationalError {
    reason;
    exitCode;
    signal;
    constructor(reason, exitCode, signal, options) {
        super(`ACP agent disconnected during request (${reason}, exit=${exitCode ?? "null"}, signal=${signal ?? "null"})`, {
            outputCode: "RUNTIME",
            detailCode: "AGENT_DISCONNECTED",
            origin: "acp",
            ...options,
        });
        this.reason = reason;
        this.exitCode = exitCode;
        this.signal = signal;
    }
}
export class UnsupportedPromptContentError extends AcpxOperationalError {
    constructor(message) {
        super(message, {
            outputCode: "USAGE",
            detailCode: "UNSUPPORTED_PROMPT_CONTENT",
            origin: "acp",
        });
    }
}
export class SessionResumeRequiredError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "RUNTIME",
            detailCode: "SESSION_RESUME_REQUIRED",
            origin: "acp",
            retryable: true,
            ...options,
        });
    }
}
export class GeminiAcpStartupTimeoutError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "TIMEOUT",
            detailCode: "GEMINI_ACP_STARTUP_TIMEOUT",
            origin: "acp",
            ...options,
        });
    }
}
export class SessionModeReplayError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "RUNTIME",
            detailCode: "SESSION_MODE_REPLAY_FAILED",
            origin: "acp",
            ...options,
        });
    }
}
export class SessionModelReplayError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "RUNTIME",
            detailCode: "SESSION_MODEL_REPLAY_FAILED",
            origin: "acp",
            ...options,
        });
    }
}
export class SessionConfigOptionReplayError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "RUNTIME",
            detailCode: "SESSION_CONFIG_OPTION_REPLAY_FAILED",
            origin: "acp",
            ...options,
        });
    }
}
export class ClaudeAcpSessionCreateTimeoutError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "TIMEOUT",
            detailCode: "CLAUDE_ACP_SESSION_CREATE_TIMEOUT",
            origin: "acp",
            ...options,
        });
    }
}
export class CopilotAcpUnsupportedError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "RUNTIME",
            detailCode: "COPILOT_ACP_UNSUPPORTED",
            origin: "acp",
            ...options,
        });
    }
}
export class AuthPolicyError extends AcpxOperationalError {
    constructor(message, options) {
        super(message, {
            outputCode: "RUNTIME",
            detailCode: "AUTH_REQUIRED",
            origin: "acp",
            ...options,
        });
    }
}
export class QueueConnectionError extends AcpxOperationalError {
}
export class QueueProtocolError extends AcpxOperationalError {
}
export class PermissionDeniedError extends AcpxOperationalError {
}
export class PermissionPromptUnavailableError extends AcpxOperationalError {
    constructor() {
        super("Permission prompt unavailable in non-interactive mode");
    }
}
