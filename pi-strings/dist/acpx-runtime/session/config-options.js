import { cloneSessionAcpxState } from "./conversation-model.js";
import { applyConfigOptionsModelState } from "./model-state.js";
export function applyConfigOptionsToState(state, configOptions) {
    const acpxState = cloneSessionAcpxState(state) ?? {};
    applyConfigOptionsModelState(acpxState, configOptions);
    return acpxState;
}
export function applyConfigOptionsToRecord(record, result) {
    const configOptions = result?.configOptions;
    if (!configOptions) {
        return;
    }
    record.acpx = applyConfigOptionsToState(record.acpx, configOptions);
}
