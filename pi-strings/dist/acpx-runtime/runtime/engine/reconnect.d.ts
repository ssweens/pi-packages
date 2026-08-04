import type { AcpClient } from "../../acp/client.js";
import type { SessionRecord, SessionResumePolicy } from "../../types.js";
export type ConnectedSessionController = {
    hasActivePrompt: () => boolean;
    requestCancelActivePrompt: () => Promise<boolean>;
    setSessionMode: (modeId: string) => Promise<void>;
    setSessionModel: (modelId: string) => ReturnType<AcpClient["setSessionModel"]>;
    setSessionConfigOption: (configId: string, value: string) => ReturnType<AcpClient["setSessionConfigOption"]>;
};
export type ConnectAndLoadSessionOptions = {
    client: AcpClient;
    record: SessionRecord;
    resumePolicy?: SessionResumePolicy;
    timeoutMs?: number;
    verbose?: boolean;
    suppressWarnings?: boolean;
    activeController: ConnectedSessionController;
    onClientAvailable?: (controller: ConnectedSessionController) => void;
    onConnectedRecord?: (record: SessionRecord) => void;
    onSessionIdResolved?: (sessionId: string) => void;
};
export type ConnectAndLoadSessionResult = {
    sessionId: string;
    agentSessionId?: string;
    resumed: boolean;
    loadError?: string;
};
export declare function connectAndLoadSession(options: ConnectAndLoadSessionOptions): Promise<ConnectAndLoadSessionResult>;
