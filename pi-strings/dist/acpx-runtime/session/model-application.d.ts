import type { SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk";
import type { AcpClient, SessionCreateResult } from "../acp/client.js";
export declare function currentModelIdFromSetModelResponse(response: SetSessionConfigOptionResponse | undefined, fallbackModelId: string | undefined): string | undefined;
export declare function applyRequestedModelIfAdvertised(params: {
    client: AcpClient;
    sessionId: string;
    requestedModel: string | undefined;
    models: SessionCreateResult["models"];
    agentCommand?: string;
    timeoutMs?: number;
    onWarning?: (message: string) => void;
}): Promise<{
    applied: boolean;
    response?: SetSessionConfigOptionResponse;
}>;
