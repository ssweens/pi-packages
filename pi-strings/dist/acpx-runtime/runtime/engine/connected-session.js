import { AcpClient } from "../../acp/client.js";
import { withInterrupt } from "../../async-control.js";
import { applyConfigOptionsToRecord } from "../../session/config-options.js";
import { advertisedModelState } from "../../session/model-state.js";
import { absolutePath, isoNow } from "../../session/persistence.js";
import { applyLifecycleSnapshotToRecord } from "./lifecycle.js";
import { connectAndLoadSession } from "./reconnect.js";
import { sessionOptionsFromRecord } from "./session-options.js";
function createActiveSessionController(params) {
    const getActiveSessionId = () => params.getActiveSessionId();
    return {
        hasActivePrompt: () => params.client.hasActivePrompt(),
        requestCancelActivePrompt: async () => await params.client.requestCancelActivePrompt(),
        setSessionMode: async (modeId) => {
            await params.client.setSessionMode(getActiveSessionId(), modeId);
        },
        setSessionModel: async (modelId) => {
            const models = advertisedModelState(params.record.acpx);
            const response = await params.client.setSessionModel(getActiveSessionId(), modelId, models);
            applyConfigOptionsToRecord(params.record, response);
            return response;
        },
        setSessionConfigOption: async (configId, value) => {
            return await params.client.setSessionConfigOption(getActiveSessionId(), configId, value);
        },
    };
}
export async function withConnectedSession(options) {
    const record = await options.loadRecord(options.sessionRecordId);
    const client = options.createClient?.({
        agentCommand: record.agentCommand,
        agentArgv: record.agentArgv,
        cwd: absolutePath(record.cwd),
        mcpServers: options.mcpServers,
        permissionMode: options.permissionMode ?? "approve-reads",
        nonInteractivePermissions: options.nonInteractivePermissions,
        permissionPolicy: options.permissionPolicy,
        onPermissionRequest: options.onPermissionRequest,
        authCredentials: options.authCredentials,
        authPolicy: options.authPolicy,
        fs: options.fs,
        terminal: options.terminal,
        verbose: options.verbose,
        sessionOptions: sessionOptionsFromRecord(record),
    }) ??
        new AcpClient({
            agentCommand: record.agentCommand,
            agentArgv: record.agentArgv,
            cwd: absolutePath(record.cwd),
            mcpServers: options.mcpServers,
            permissionMode: options.permissionMode ?? "approve-reads",
            nonInteractivePermissions: options.nonInteractivePermissions,
            permissionPolicy: options.permissionPolicy,
            onPermissionRequest: options.onPermissionRequest,
            authCredentials: options.authCredentials,
            authPolicy: options.authPolicy,
            fs: options.fs,
            terminal: options.terminal,
            verbose: options.verbose,
            sessionOptions: sessionOptionsFromRecord(record),
        });
    let activeSessionIdForControl = record.acpSessionId;
    let notifiedClientAvailable = false;
    const activeController = createActiveSessionController({
        client,
        record,
        getActiveSessionId: () => activeSessionIdForControl,
    });
    try {
        return await withInterrupt(async () => {
            const { sessionId, resumed, loadError } = await connectAndLoadSession({
                client,
                record,
                resumePolicy: options.resumePolicy,
                timeoutMs: options.timeoutMs,
                verbose: options.verbose,
                activeController,
                onClientAvailable: (controller) => {
                    options.onClientAvailable?.(controller);
                    notifiedClientAvailable = true;
                },
                onConnectedRecord: options.onConnectedRecord,
                onSessionIdResolved: (sessionIdValue) => {
                    activeSessionIdForControl = sessionIdValue;
                },
            });
            const value = await options.run({
                record,
                client,
                activeController,
                sessionId,
                resumed,
                loadError,
            });
            const now = isoNow();
            record.lastUsedAt = now;
            record.closed = false;
            record.closedAt = undefined;
            record.protocolVersion = client.initializeResult?.protocolVersion;
            record.agentCapabilities = client.initializeResult?.agentCapabilities;
            applyLifecycleSnapshotToRecord(record, client.getAgentLifecycleSnapshot());
            await options.saveRecord(record);
            return {
                value,
                record,
                resumed,
                loadError,
            };
        }, async () => {
            if (options.onInterrupt) {
                await options.onInterrupt({ client, record });
            }
            else {
                await client.cancelActivePrompt(2_500);
            }
            applyLifecycleSnapshotToRecord(record, client.getAgentLifecycleSnapshot());
            record.lastUsedAt = isoNow();
            await options.saveRecord(record).catch(() => {
                // best effort while process is being interrupted
            });
            await client.close();
        });
    }
    finally {
        if (notifiedClientAvailable) {
            options.onClientClosed?.();
        }
        await client.close();
        applyLifecycleSnapshotToRecord(record, client.getAgentLifecycleSnapshot());
        await options.saveRecord(record).catch(() => {
            // best effort on close
        });
    }
}
