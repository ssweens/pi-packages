import { DEFAULT_AGENT_NAME } from "./agent-registry.js";
import { AcpRuntimeManager } from "./runtime/engine/manager.js";
import type { AcpAgentRegistry, AcpRuntime, AcpRuntimeCapabilities, AcpRuntimeDoctorReport, AcpRuntimeEnsureInput, AcpRuntimeEvent, AcpRuntimeHandle, AcpRuntimeOptions, AcpRuntimeStatus, AcpRuntimeTurnInput, AcpSessionStore } from "./runtime/public/contract.js";
import { createFileSessionStore } from "./runtime/public/file-session-store.js";
export { DEFAULT_AGENT_NAME, createFileSessionStore };
export { AcpRuntimeError, isAcpRuntimeError } from "./runtime/public/errors.js";
export type { AcpRuntimeErrorCode } from "./runtime/public/errors.js";
export { REQUESTED_MODEL_UNSUPPORTED_ERROR_CODE, REQUESTED_MODEL_UNSUPPORTED_REASONS, isRequestedModelUnsupportedError, RequestedModelUnsupportedError, } from "./acp/model-support.js";
export type { RequestedModelUnsupportedErrorCode, RequestedModelUnsupportedReason, } from "./acp/model-support.js";
export { decodeAcpxRuntimeHandleState, encodeAcpxRuntimeHandleState, } from "./runtime/public/handle-state.js";
export type { AcpAgentRegistry, AcpFileSessionStoreOptions, AcpPermissionDecision, AcpPermissionRequest, AcpRuntime, AcpRuntimeAvailableCommand, AcpRuntimeCapabilities, AcpRuntimeDoctorReport, AcpRuntimeEnsureInput, AcpRuntimeEvent, AcpRuntimeHandle, AcpRuntimeOptions, AcpRuntimePromptMode, AcpRuntimeSessionMode, AcpRuntimeSessionModels, AcpRuntimeSessionUsage, AcpRuntimeStatus, AcpRuntimeTurn, AcpRuntimeTurnAttachment, AcpRuntimeTurnInput, AcpRuntimeTurnResult, AcpRuntimeTurnResultError, AcpRuntimeUsageBreakdown, AcpRuntimeUsageCost, AcpSessionRecord, AcpSessionStore, AcpSessionUpdateTag, PermissionPolicy, SessionAgentOptions, SystemPromptOption, } from "./runtime/public/contract.js";
export declare const ACPX_BACKEND_ID = "acpx";
type AcpxRuntimeLike = AcpRuntime & {
    probeAvailability(): Promise<void>;
    isHealthy(): boolean;
    doctor(): Promise<AcpRuntimeDoctorReport>;
};
export declare function createAgentRegistry(params?: {
    overrides?: Record<string, string | string[]>;
}): AcpAgentRegistry;
export declare class AcpxRuntime implements AcpxRuntimeLike {
    private readonly options;
    private readonly testOptions?;
    private healthy;
    private manager;
    private managerPromise;
    constructor(options: AcpRuntimeOptions, testOptions?: {
        managerFactory?: (options: AcpRuntimeOptions) => AcpRuntimeManager;
        probeRunner?: (options: AcpRuntimeOptions) => Promise<{
            ok: boolean;
            message: string;
            details?: unknown[];
        }>;
    } | undefined);
    isHealthy(): boolean;
    probeAvailability(): Promise<void>;
    doctor(): Promise<AcpRuntimeDoctorReport>;
    ensureSession(input: AcpRuntimeEnsureInput): Promise<AcpRuntimeHandle>;
    startTurn(input: AcpRuntimeTurnInput): {
        requestId: string;
        events: {
            [Symbol.asyncIterator](): AsyncGenerator<AcpRuntimeEvent, void, any>;
        };
        readonly result: Promise<import("./runtime.js").AcpRuntimeTurnResult>;
        cancel(inputArgs?: {
            reason?: string;
        }): Promise<void>;
        closeStream(inputArgs?: {
            reason?: string;
        }): Promise<void>;
    };
    runTurn(input: AcpRuntimeTurnInput): AsyncIterable<AcpRuntimeEvent>;
    getCapabilities(input?: {
        handle?: AcpRuntimeHandle;
    }): Promise<AcpRuntimeCapabilities>;
    getStatus(input: {
        handle: AcpRuntimeHandle;
        signal?: AbortSignal;
    }): Promise<AcpRuntimeStatus>;
    setMode(input: {
        handle: AcpRuntimeHandle;
        mode: string;
    }): Promise<void>;
    setConfigOption(input: {
        handle: AcpRuntimeHandle;
        key: string;
        value: string;
    }): Promise<void>;
    cancel(input: {
        handle: AcpRuntimeHandle;
        reason?: string;
    }): Promise<void>;
    close(input: {
        handle: AcpRuntimeHandle;
        reason: string;
        discardPersistentState?: boolean;
    }): Promise<void>;
    private getManager;
    private runProbe;
    private resolveManagerHandle;
    private resolveHandleState;
}
export declare function createAcpRuntime(options: AcpRuntimeOptions): AcpxRuntime;
export declare function createRuntimeStore(options: {
    stateDir: string;
}): AcpSessionStore;
