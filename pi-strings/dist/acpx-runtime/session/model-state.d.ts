import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { type SessionModelState } from "../acp/model-support.js";
import type { SessionAcpxState } from "../types.js";
export declare function advertisedModelState(state: SessionAcpxState | undefined): SessionModelState | undefined;
export declare function applyAdvertisedModelState(state: SessionAcpxState, models: SessionModelState): void;
export declare function clearAdvertisedModelState(state: SessionAcpxState): void;
export declare function removeModelConfigOptions(state: SessionAcpxState): void;
export declare function applyConfigOptionsModelState(state: SessionAcpxState, configOptions: SessionConfigOption[]): void;
