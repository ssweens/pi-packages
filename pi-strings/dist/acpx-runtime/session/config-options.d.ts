import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { SessionCreateResult, SessionLoadResult } from "../acp/client.js";
import type { SessionAcpxState, SessionRecord } from "../types.js";
type ConfigOptionsResult = Pick<SessionCreateResult | SessionLoadResult, "configOptions">;
export declare function applyConfigOptionsToState(state: SessionAcpxState | undefined, configOptions: SessionConfigOption[]): SessionAcpxState;
export declare function applyConfigOptionsToRecord(record: SessionRecord, result: ConfigOptionsResult | undefined): void;
export {};
