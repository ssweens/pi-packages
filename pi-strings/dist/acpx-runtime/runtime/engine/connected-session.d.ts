import type { SetSessionConfigOptionResponse } from "@agentclientprotocol/sdk";
import { AcpClient } from "../../acp/client.js";
import type { AcpPermissionDecision, AcpPermissionRequest, AuthPolicy, McpServer, NonInteractivePermissionPolicy, PermissionMode, PermissionPolicy, SessionRecord, SessionResumePolicy } from "../../types.js";
import { type ConnectedSessionController } from "./reconnect.js";
export type FullConnectedSessionController = ConnectedSessionController & {
    setSessionModel: (modelId: string) => Promise<SetSessionConfigOptionResponse | undefined>;
    setSessionConfigOption: (configId: string, value: string) => Promise<SetSessionConfigOptionResponse>;
};
type ConnectedSessionContext = {
    record: SessionRecord;
    client: AcpClient;
    activeController: FullConnectedSessionController;
    sessionId: string;
    resumed: boolean;
    loadError?: string;
};
export type WithConnectedSessionOptions<T> = {
    sessionRecordId: string;
    loadRecord: (sessionRecordId: string) => Promise<SessionRecord>;
    saveRecord: (record: SessionRecord) => Promise<void>;
    createClient?: (options: ConstructorParameters<typeof AcpClient>[0]) => AcpClient;
    mcpServers?: McpServer[];
    permissionMode?: PermissionMode;
    nonInteractivePermissions?: NonInteractivePermissionPolicy;
    permissionPolicy?: PermissionPolicy;
    onPermissionRequest?: (req: AcpPermissionRequest, ctx: {
        signal: AbortSignal;
    }) => Promise<AcpPermissionDecision | undefined>;
    authCredentials?: Record<string, string>;
    authPolicy?: AuthPolicy;
    fs?: boolean;
    terminal?: boolean;
    resumePolicy?: SessionResumePolicy;
    timeoutMs?: number;
    verbose?: boolean;
    onClientAvailable?: (controller: FullConnectedSessionController) => void;
    onClientClosed?: () => void;
    onConnectedRecord?: (record: SessionRecord) => void;
    onInterrupt?: (params: {
        client: AcpClient;
        record: SessionRecord;
    }) => Promise<void>;
    run: (context: ConnectedSessionContext) => Promise<T>;
};
export type WithConnectedSessionResult<T> = {
    value: T;
    record: SessionRecord;
    resumed: boolean;
    loadError?: string;
};
export declare function withConnectedSession<T>(options: WithConnectedSessionOptions<T>): Promise<WithConnectedSessionResult<T>>;
export {};
