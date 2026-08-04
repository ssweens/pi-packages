import { type RequestPermissionRequest, type RequestPermissionResponse, type ToolKind } from "@agentclientprotocol/sdk";
import type { AcpPermissionDecision, NonInteractivePermissionPolicy, PermissionEscalationEvent, PermissionMode, PermissionPolicy } from "./types.js";
type PermissionDecision = "approved" | "denied" | "cancelled";
export type ResolvedPermissionRequest = {
    response: RequestPermissionResponse;
    escalation?: PermissionEscalationEvent;
};
export declare function inferToolKind(params: RequestPermissionRequest): ToolKind | undefined;
export declare function permissionModeSatisfies(actual: PermissionMode, required: PermissionMode): boolean;
export declare function resolvePermissionRequest(params: RequestPermissionRequest, mode: PermissionMode, nonInteractivePolicy?: NonInteractivePermissionPolicy, policy?: PermissionPolicy): Promise<RequestPermissionResponse>;
export declare function resolvePermissionRequestWithDetails(params: RequestPermissionRequest, mode: PermissionMode, nonInteractivePolicy?: NonInteractivePermissionPolicy, policy?: PermissionPolicy): Promise<ResolvedPermissionRequest>;
export declare function decisionToResponse(params: RequestPermissionRequest, decision: AcpPermissionDecision): RequestPermissionResponse;
export declare function classifyPermissionDecision(params: RequestPermissionRequest, response: RequestPermissionResponse): PermissionDecision;
export {};
