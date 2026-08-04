import { assertRequestedModelSupported, modelStateFromConfigOptions, } from "../acp/model-support.js";
import { withTimeout } from "../async-control.js";
export function currentModelIdFromSetModelResponse(response, fallbackModelId) {
    return modelStateFromConfigOptions(response?.configOptions)?.currentModelId ?? fallbackModelId;
}
export async function applyRequestedModelIfAdvertised(params) {
    const requestedModel = typeof params.requestedModel === "string" ? params.requestedModel.trim() : "";
    if (!requestedModel) {
        return { applied: false };
    }
    const warning = assertRequestedModelSupported({
        requestedModel,
        models: params.models,
        agentCommand: params.agentCommand,
        context: "apply",
    });
    if (warning) {
        params.onWarning?.(warning);
    }
    if (!params.models) {
        return { applied: false };
    }
    if (params.models.currentModelId === requestedModel) {
        return { applied: true };
    }
    const response = await withTimeout(params.client.setSessionModel(params.sessionId, requestedModel, params.models), params.timeoutMs);
    return { applied: true, response };
}
