export type SessionModelState = {
    configId?: string;
    currentModelId: string;
    availableModels: Array<{
        modelId: string;
        name: string;
    }>;
};
type AdvertisedModelIds = Pick<SessionModelState, "availableModels">;
export declare const REQUESTED_MODEL_UNSUPPORTED_ERROR_CODE: "ACP_MODEL_UNSUPPORTED";
export type RequestedModelUnsupportedErrorCode = typeof REQUESTED_MODEL_UNSUPPORTED_ERROR_CODE;
export declare const REQUESTED_MODEL_UNSUPPORTED_REASONS: readonly ["missing-capability", "unadvertised-model"];
export type RequestedModelUnsupportedReason = (typeof REQUESTED_MODEL_UNSUPPORTED_REASONS)[number];
export declare class RequestedModelUnsupportedError extends Error {
    readonly code: "ACP_MODEL_UNSUPPORTED";
    readonly reason: RequestedModelUnsupportedReason;
    constructor(message: string, reason: RequestedModelUnsupportedReason);
}
export declare function isRequestedModelUnsupportedError(value: unknown): value is RequestedModelUnsupportedError;
export declare function supportsLegacyClaudeCodeModelMetadata(agentCommand: string | undefined): boolean;
export declare function modelStateFromConfigOptions(configOptions: unknown): SessionModelState | undefined;
export declare function modelStateFromLegacyResponse(response: unknown): SessionModelState | undefined;
export declare function modelStateFromSessionResponse(params: {
    configOptions: unknown;
    response: unknown;
}): SessionModelState | undefined;
export declare function formatAvailableModelIds(models: SessionModelState | undefined): string;
export declare function resolveRequestedModelId(params: {
    requestedModel: string;
    models: AdvertisedModelIds | undefined;
    agentCommand?: string;
}): string;
export declare function assertRequestedModelSupported(params: {
    requestedModel: string;
    models: SessionModelState | undefined;
    agentCommand?: string;
    context: "apply" | "replay";
}): string | undefined;
export {};
