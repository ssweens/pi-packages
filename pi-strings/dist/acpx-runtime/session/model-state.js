import { modelStateFromConfigOptions } from "../acp/model-support.js";
function configOptionsAreAuthoritative(state) {
    return state.model_control === "config_option";
}
function legacyModelState(state) {
    if (!Array.isArray(state.available_models)) {
        return undefined;
    }
    return {
        currentModelId: state.current_model_id ?? "",
        availableModels: state.available_models.map((modelId) => ({ modelId, name: modelId })),
    };
}
export function advertisedModelState(state) {
    if (!state) {
        return undefined;
    }
    const configModels = modelStateFromConfigOptions(state?.config_options);
    if (configModels) {
        return configModels;
    }
    if (configOptionsAreAuthoritative(state)) {
        return undefined;
    }
    return legacyModelState(state);
}
export function applyAdvertisedModelState(state, models) {
    state.current_model_id = models.currentModelId;
    state.available_models = models.availableModels.map((model) => model.modelId);
    state.model_control = models.configId ? "config_option" : "legacy_set_model";
}
export function clearAdvertisedModelState(state) {
    delete state.current_model_id;
    delete state.available_models;
    delete state.model_control;
}
export function removeModelConfigOptions(state) {
    if (!state.config_options) {
        return;
    }
    state.config_options = state.config_options.filter((option) => option.category !== "model" && option.id !== "model");
}
export function applyConfigOptionsModelState(state, configOptions) {
    const previousConfigModels = modelStateFromConfigOptions(state.config_options);
    const preservesLegacyControl = state.model_control === "legacy_set_model" ||
        (state.model_control === undefined &&
            previousConfigModels === undefined &&
            legacyModelState(state) !== undefined);
    state.config_options = structuredClone(configOptions);
    const models = modelStateFromConfigOptions(configOptions);
    if (models) {
        applyAdvertisedModelState(state, models);
    }
    else if (preservesLegacyControl) {
        state.model_control = "legacy_set_model";
    }
    else {
        clearAdvertisedModelState(state);
    }
}
