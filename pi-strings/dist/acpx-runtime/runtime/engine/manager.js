import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeAgentCommandInput } from "../../acp/client-process.js";
import { AcpClient } from "../../acp/client.js";
import { normalizeOutputError } from "../../acp/error-normalization.js";
import { extractAcpError, isAcpResourceNotFoundError } from "../../acp/error-shapes.js";
import { modelStateFromConfigOptions } from "../../acp/model-support.js";
import { withTimeout } from "../../async-control.js";
import { textPrompt } from "../../prompt-content.js";
import { applyConfigOptionsToRecord, applyConfigOptionsToState, } from "../../session/config-options.js";
import { cloneSessionAcpxState, cloneSessionConversation, createSessionConversation, recordClientOperation, recordPromptSubmission, recordSessionUpdate, trimConversationForRuntime, } from "../../session/conversation-model.js";
import { defaultSessionEventLog } from "../../session/event-log.js";
import { LiveSessionCheckpoint } from "../../session/live-checkpoint.js";
import { clearDesiredConfigOption, setCurrentModelId, setDesiredConfigOption, setDesiredModelId, setDesiredModeId, syncAdvertisedModelState, } from "../../session/mode-preference.js";
import { applyRequestedModelIfAdvertised, currentModelIdFromSetModelResponse, } from "../../session/model-application.js";
import { advertisedModelState } from "../../session/model-state.js";
import { AcpRuntimeError } from "../public/errors.js";
import { parsePromptEventLine } from "../public/events.js";
import { withConnectedSession } from "./connected-session.js";
import { applyConversation, applyLifecycleSnapshotToRecord, reconcileAgentSessionId, } from "./lifecycle.js";
import { runPromptTurn } from "./prompt-turn.js";
import { connectAndLoadSession } from "./reconnect.js";
import { shouldReuseExistingRecord } from "./reuse-policy.js";
import { persistSessionOptions, sessionOptionsFromRecord, } from "./session-options.js";
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
class AsyncEventQueue {
    items = [];
    waits = [];
    closed = false;
    push(item) {
        if (this.closed) {
            return;
        }
        const waiter = this.waits.shift();
        if (waiter) {
            waiter.resolve(item);
            return;
        }
        this.items.push(item);
    }
    close() {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const waiter of this.waits.splice(0)) {
            waiter.resolve(null);
        }
    }
    clear() {
        this.items.length = 0;
    }
    async next() {
        if (this.items.length > 0) {
            return this.items.shift() ?? null;
        }
        if (this.closed) {
            return null;
        }
        const waiter = createDeferred();
        this.waits.push(waiter);
        return await waiter.promise;
    }
    async *iterate() {
        while (true) {
            const next = await this.next();
            if (!next) {
                return;
            }
            yield next;
        }
    }
}
function isoNow() {
    return new Date().toISOString();
}
function isUnsupportedSessionCloseError(error) {
    const acp = extractAcpError(error);
    if (!acp) {
        return false;
    }
    if (acp.code === -32601 || acp.code === -32602) {
        return true;
    }
    if (acp.code !== -32603 || !acp.data || typeof acp.data !== "object") {
        return false;
    }
    const details = acp.data.details;
    return typeof details === "string" && details.toLowerCase().includes("invalid params");
}
function toPromptInput(text, attachments) {
    if (!attachments || attachments.length === 0) {
        return text;
    }
    const blocks = [];
    if (text) {
        blocks.push({ type: "text", text });
    }
    for (const attachment of attachments) {
        if (attachment.mediaType.startsWith("image/")) {
            blocks.push({
                type: "image",
                mimeType: attachment.mediaType,
                data: attachment.data,
            });
            continue;
        }
        if (attachment.mediaType.startsWith("audio/")) {
            blocks.push({
                type: "audio",
                mimeType: attachment.mediaType,
                data: attachment.data,
            });
            continue;
        }
        throw new AcpRuntimeError("ACP_TURN_FAILED", `Unsupported ACP runtime attachment media type: ${attachment.mediaType}`);
    }
    return blocks.length > 0 ? blocks : textPrompt(text);
}
function createInitialRecord(params) {
    const now = isoNow();
    return {
        schema: "acpx.session.v1",
        acpxRecordId: params.recordId,
        acpSessionId: params.sessionId,
        agentSessionId: params.agentSessionId,
        agentCommand: params.agentCommand,
        agentArgv: params.agentArgv,
        cwd: params.cwd,
        name: params.sessionName,
        createdAt: now,
        lastUsedAt: now,
        lastSeq: 0,
        eventLog: defaultSessionEventLog(params.recordId),
        closed: false,
        closedAt: undefined,
        ...createSessionConversation(now),
        acpx: {},
    };
}
function createRecordId(sessionKey, mode) {
    if (mode === "persistent") {
        return sessionKey;
    }
    return `${sessionKey}:oneshot:${randomUUID()}`;
}
function resumePolicyForSessionMode(mode) {
    return mode === "persistent" ? "same-session-only" : "allow-new";
}
function legacyTerminalEventFromTurnResult(result) {
    if (result.status === "failed") {
        return {
            type: "error",
            message: result.error.message,
            ...(result.error.code ? { code: result.error.code } : {}),
            ...(result.error.detailCode ? { detailCode: result.error.detailCode } : {}),
            ...(result.error.retryable === undefined ? {} : { retryable: result.error.retryable }),
        };
    }
    return {
        type: "done",
        ...(result.stopReason ? { stopReason: result.stopReason } : {}),
    };
}
function statusSummary(record) {
    const parts = [
        `session=${record.acpxRecordId}`,
        `backendSessionId=${record.acpSessionId}`,
        record.agentSessionId ? `agentSessionId=${record.agentSessionId}` : null,
        record.pid != null ? `pid=${record.pid}` : null,
        record.closed ? "closed" : "open",
    ].filter(Boolean);
    return parts.join(" ");
}
function buildModelsField(record) {
    const available = record.acpx?.available_models;
    const currentModelId = record.acpx?.current_model_id;
    if (!available || available.length === 0) {
        return currentModelId === undefined
            ? {}
            : { models: { currentModelId, availableModelIds: [] } };
    }
    return {
        models: {
            ...(currentModelId !== undefined ? { currentModelId } : {}),
            availableModelIds: [...available],
        },
    };
}
function tokenUsageToBreakdown(usage) {
    if (!usage) {
        return undefined;
    }
    const breakdown = {};
    assignUsageBreakdownField(breakdown, "inputTokens", usage.input_tokens);
    assignUsageBreakdownField(breakdown, "outputTokens", usage.output_tokens);
    assignUsageBreakdownField(breakdown, "cachedReadTokens", usage.cache_read_input_tokens);
    assignUsageBreakdownField(breakdown, "cachedWriteTokens", usage.cache_creation_input_tokens);
    assignUsageBreakdownField(breakdown, "thoughtTokens", usage.thought_tokens);
    assignUsageBreakdownField(breakdown, "totalTokens", usage.total_tokens);
    return Object.keys(breakdown).length > 0 ? breakdown : undefined;
}
function assignUsageBreakdownField(breakdown, key, value) {
    if (value !== undefined) {
        breakdown[key] = value;
    }
}
function buildUsageField(record) {
    const cumulative = tokenUsageToBreakdown(record.cumulative_token_usage);
    const perRequestEntries = Object.entries(record.request_token_usage ?? {})
        .map(([id, value]) => [id, tokenUsageToBreakdown(value)])
        .filter((entry) => entry[1] !== undefined);
    const perRequest = perRequestEntries.length > 0 ? Object.fromEntries(perRequestEntries) : undefined;
    const cost = record.cumulative_cost;
    const usage = {
        ...(cumulative ? { cumulative } : {}),
        ...(cost ? { cost } : {}),
        ...(perRequest ? { perRequest } : {}),
    };
    return Object.keys(usage).length > 0 ? { usage } : {};
}
function buildAvailableCommandsField(record) {
    const commands = record.acpx?.available_commands;
    if (!commands || commands.length === 0) {
        return {};
    }
    const availableCommands = commands
        .map((command) => runtimeAvailableCommand(command))
        .filter((command) => command !== undefined);
    return availableCommands.length > 0 ? { availableCommands } : {};
}
function runtimeAvailableCommand(command) {
    if (typeof command === "string") {
        const name = command.trim();
        return name ? { name } : undefined;
    }
    const record = commandRecord(command);
    if (!record) {
        return undefined;
    }
    const name = trimmedField(record.name);
    if (!name) {
        return undefined;
    }
    const runtimeCommand = { name };
    const description = trimmedField(record.description);
    if (description) {
        runtimeCommand.description = description;
    }
    if (typeof record.has_input === "boolean") {
        runtimeCommand.hasInput = record.has_input;
    }
    return runtimeCommand;
}
function commandRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function trimmedField(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function advertisedConfigOptionIds(record) {
    const configOptions = record.acpx?.config_options;
    if (!configOptions) {
        return undefined;
    }
    return new Set(configOptions
        .map((option) => option.id)
        .filter((id) => typeof id === "string" && id.trim().length > 0));
}
function resolveSupportedConfigOptionId(record, configId) {
    const advertisedIds = advertisedConfigOptionIds(record);
    if (!advertisedIds) {
        return configId;
    }
    if (advertisedIds.has(configId)) {
        return configId;
    }
    if (configId === "thinking" && advertisedIds.has("effort")) {
        return "effort";
    }
    const supported = [...advertisedIds].toSorted();
    const supportedText = supported.length > 0 ? supported.join(", ") : "none";
    throw new AcpRuntimeError("ACP_BACKEND_UNSUPPORTED_CONTROL", `ACP session ${record.acpxRecordId} does not advertise config option '${configId}'. Supported config options: ${supportedText}.`);
}
function applyConfigOptionResponseToTurn(turn, response) {
    if (!response?.configOptions) {
        return;
    }
    turn.acpxState = applyConfigOptionsToState(turn.acpxState, response.configOptions);
}
function applyDesiredConfigOptionToTurn(turn, configId, value) {
    const nextState = cloneSessionAcpxState(turn.acpxState) ?? {};
    const modelConfigId = modelStateFromConfigOptions(nextState.config_options)?.configId;
    if (configId === modelConfigId) {
        nextState.session_options = { ...nextState.session_options, model: value };
        clearDesiredConfigOption(nextState, configId);
    }
    else if (configId === "mode") {
        nextState.desired_mode_id = value;
    }
    else {
        nextState.desired_config_options = {
            ...nextState.desired_config_options,
            [configId]: value,
        };
    }
    turn.acpxState = nextState;
}
function applyDesiredConfigOptionToRecord(record, configId, value) {
    const modelConfigId = modelStateFromConfigOptions(record.acpx?.config_options)?.configId;
    if (configId === modelConfigId) {
        setDesiredModelId(record, value, configId);
    }
    else if (configId === "mode") {
        setDesiredModeId(record, value);
    }
    else {
        setDesiredConfigOption(record, configId, value);
    }
}
async function createOrLoadRuntimeSession(client, resumeSessionId, cwd) {
    if (resumeSessionId) {
        if (client.supportsResumeSession()) {
            const resumed = await client.resumeSession(resumeSessionId, cwd);
            return {
                sessionId: resumeSessionId,
                agentSessionId: resumed.agentSessionId,
                sessionResult: resumed,
            };
        }
        if (!client.supportsLoadSession()) {
            throw new Error(`Agent does not support session/resume or session/load; cannot resume session ${resumeSessionId}`);
        }
        const loaded = await client.loadSession(resumeSessionId, cwd);
        return {
            sessionId: resumeSessionId,
            agentSessionId: loaded.agentSessionId,
            sessionResult: loaded,
        };
    }
    const created = await client.createSession(cwd);
    return {
        sessionId: created.sessionId,
        agentSessionId: created.agentSessionId,
        sessionResult: created,
    };
}
export class AcpRuntimeManager {
    options;
    deps;
    activeControllers = new Map();
    pendingPersistentClients = new Map();
    closingActiveRecords = new Set();
    constructor(options, deps = {}) {
        this.options = options;
        this.deps = deps;
    }
    createClient(options) {
        return this.deps.clientFactory?.(options) ?? new AcpClient(options);
    }
    async readPendingPersistentClient(record, options) {
        const pendingClient = this.pendingPersistentClients.get(record.acpxRecordId);
        if (!pendingClient) {
            return undefined;
        }
        if (!pendingClient.hasReusableSession(record.acpSessionId)) {
            this.pendingPersistentClients.delete(record.acpxRecordId);
            await pendingClient.close().catch(() => { });
            return undefined;
        }
        if (options.consume) {
            this.pendingPersistentClients.delete(record.acpxRecordId);
        }
        return pendingClient;
    }
    async closePendingPersistentClient(recordId) {
        const pendingClient = this.pendingPersistentClients.get(recordId);
        if (!pendingClient) {
            return;
        }
        this.pendingPersistentClients.delete(recordId);
        await pendingClient.close().catch(() => { });
    }
    async refreshClosedState(record) {
        if (!this.closingActiveRecords.has(record.acpxRecordId)) {
            return record.closed === true;
        }
        const latest = await this.options.sessionStore.load(record.acpxRecordId).catch(() => undefined);
        record.closed = true;
        record.closedAt = latest?.closedAt ?? record.closedAt ?? isoNow();
        if (latest?.acpx) {
            record.acpx = {
                ...record.acpx,
                ...latest.acpx,
            };
        }
        return true;
    }
    async retainPersistentClientAfterTurn(input) {
        const { record, client } = input;
        const isPersistentRecord = !record.acpxRecordId.includes(":oneshot:");
        if (!isPersistentRecord || record.closed || !client.hasReusableSession(record.acpSessionId)) {
            return false;
        }
        const previousClient = this.pendingPersistentClients.get(record.acpxRecordId);
        this.pendingPersistentClients.set(record.acpxRecordId, client);
        if (previousClient && previousClient !== client) {
            await previousClient.close().catch(() => { });
        }
        return true;
    }
    async withRuntimeControlSession(record, sessionMode, run) {
        const pendingClient = await this.readPendingPersistentClient(record, { consume: false });
        if (pendingClient) {
            const value = await run({
                client: pendingClient,
                sessionId: record.acpSessionId,
                record,
            });
            record.lastUsedAt = isoNow();
            record.closed = false;
            record.closedAt = undefined;
            record.protocolVersion = pendingClient.initializeResult?.protocolVersion;
            record.agentCapabilities = pendingClient.initializeResult?.agentCapabilities;
            applyLifecycleSnapshotToRecord(record, pendingClient.getAgentLifecycleSnapshot());
            return { value, record };
        }
        const result = await withConnectedSession({
            sessionRecordId: record.acpxRecordId,
            loadRecord: async (sessionRecordId) => await this.requireRecord(sessionRecordId),
            saveRecord: async (connectedRecord) => await this.options.sessionStore.save(connectedRecord),
            createClient: (options) => this.createClient(options),
            mcpServers: [...(this.options.mcpServers ?? [])],
            permissionMode: this.options.permissionMode,
            nonInteractivePermissions: this.options.nonInteractivePermissions,
            permissionPolicy: this.options.permissionPolicy,
            onPermissionRequest: this.options.onPermissionRequest,
            verbose: this.options.verbose,
            timeoutMs: this.options.timeoutMs,
            resumePolicy: resumePolicyForSessionMode(sessionMode),
            run,
        });
        return {
            value: result.value,
            record: result.record,
        };
    }
    async ensureSession(input) {
        const cwd = path.resolve(input.cwd?.trim() || this.options.cwd);
        const { agentCommand, agentArgv } = normalizeAgentCommandInput(this.options.agentRegistry.resolve(input.agent));
        const existing = await this.options.sessionStore.load(input.sessionKey);
        if (input.mode === "persistent" &&
            existing &&
            shouldReuseExistingRecord(existing, {
                cwd,
                agentCommand,
                resumeSessionId: input.resumeSessionId,
            })) {
            // sessionOptions on a reused record are intentionally ignored: system
            // prompts are fixed at newSession time; callers who need a different
            // prompt must use a distinct sessionKey or close the prior record.
            existing.closed = false;
            existing.closedAt = undefined;
            this.closingActiveRecords.delete(existing.acpxRecordId);
            await this.options.sessionStore.save(existing);
            return existing;
        }
        const client = this.createClient({
            agentCommand,
            agentArgv,
            cwd,
            mcpServers: [...(this.options.mcpServers ?? [])],
            permissionMode: this.options.permissionMode,
            nonInteractivePermissions: this.options.nonInteractivePermissions,
            permissionPolicy: this.options.permissionPolicy,
            onPermissionRequest: this.options.onPermissionRequest,
            verbose: this.options.verbose,
            sessionOptions: input.sessionOptions,
        });
        let keepClientOpen = false;
        try {
            await client.start();
            const session = await createOrLoadRuntimeSession(client, input.resumeSessionId, cwd);
            const record = await this.createAndSaveRuntimeRecord({
                input,
                client,
                agentCommand,
                agentArgv,
                cwd,
                session,
            });
            keepClientOpen = await this.keepPersistentClient(input.mode, record.acpxRecordId, client);
            return record;
        }
        finally {
            if (!keepClientOpen) {
                await client.close();
            }
        }
    }
    async createAndSaveRuntimeRecord(params) {
        const { input, client, agentCommand, agentArgv, cwd, session } = params;
        const record = createInitialRecord({
            recordId: createRecordId(input.sessionKey, input.mode),
            sessionName: input.sessionKey,
            sessionId: session.sessionId,
            agentCommand,
            agentArgv,
            cwd,
            agentSessionId: session.agentSessionId,
        });
        this.closingActiveRecords.delete(record.acpxRecordId);
        record.protocolVersion = client.initializeResult?.protocolVersion;
        record.agentCapabilities = client.initializeResult?.agentCapabilities;
        applyConfigOptionsToRecord(record, session.sessionResult);
        const modelApplication = await applyRequestedModelIfAdvertised({
            client,
            sessionId: session.sessionId,
            requestedModel: input.sessionOptions?.model,
            models: session.sessionResult.models,
            agentCommand,
            timeoutMs: this.options.timeoutMs,
        });
        applyConfigOptionsToRecord(record, modelApplication.response);
        syncAdvertisedModelState(record, modelApplication.response
            ? modelStateFromConfigOptions(modelApplication.response.configOptions)
            : session.sessionResult.models);
        if (modelApplication.applied) {
            setCurrentModelId(record, currentModelIdFromSetModelResponse(modelApplication.response, input.sessionOptions?.model));
        }
        applyLifecycleSnapshotToRecord(record, client.getAgentLifecycleSnapshot());
        persistSessionOptions(record, input.sessionOptions);
        await this.options.sessionStore.save(record);
        return record;
    }
    async keepPersistentClient(mode, recordId, client) {
        if (mode !== "persistent") {
            return false;
        }
        const previousClient = this.pendingPersistentClients.get(recordId);
        this.pendingPersistentClients.set(recordId, client);
        await previousClient?.close().catch(() => { });
        return true;
    }
    startTurn(input) {
        const promptInput = toPromptInput(input.text, input.attachments);
        const queue = new AsyncEventQueue();
        const result = createDeferred();
        const sessionReady = createDeferred();
        void sessionReady.promise.catch(() => { });
        let resultSettled = false;
        const state = {
            pendingCancel: false,
            turnActive: true,
            activeController: null,
        };
        let streamClosed = false;
        const settleResult = (next) => {
            if (resultSettled) {
                return;
            }
            resultSettled = true;
            result.resolve(next);
        };
        const closeStream = () => {
            if (streamClosed) {
                return;
            }
            streamClosed = true;
            queue.clear();
            queue.close();
        };
        const requestCancel = async () => {
            if (state.activeController) {
                return await state.activeController.requestCancelActivePrompt();
            }
            if (!state.turnActive) {
                return false;
            }
            state.pendingCancel = true;
            return true;
        };
        const abortHandler = () => {
            void requestCancel();
        };
        if (input.signal) {
            if (input.signal.aborted) {
                closeStream();
                settleResult({
                    status: "cancelled",
                    stopReason: "cancelled",
                });
                return {
                    requestId: input.requestId,
                    events: queue.iterate(),
                    result: result.promise,
                    cancel: async () => { },
                    closeStream: async () => { },
                };
            }
            input.signal.addEventListener("abort", abortHandler, { once: true });
        }
        void this.runRuntimeTurnTask({
            input,
            promptInput,
            queue,
            sessionReady,
            state,
            settleResult,
            abortHandler,
        });
        return {
            requestId: input.requestId,
            events: queue.iterate(),
            result: result.promise,
            cancel: async () => {
                await requestCancel();
            },
            closeStream: async () => {
                closeStream();
            },
        };
    }
    async runRuntimeTurnTask(task) {
        let turn;
        try {
            turn = await this.prepareRuntimeTurn(task);
            const { sessionId, resumed, loadError } = await this.connectRuntimeTurn(task, turn);
            await this.resolveRuntimeTurnReady(task, turn, resumed, loadError);
            if (this.cancelRuntimeTurnBeforePrompt(task)) {
                return;
            }
            await this.applyPendingRuntimeTurnCancel(task, turn);
            const response = await runPromptTurn({
                client: turn.client,
                sessionId,
                prompt: task.promptInput,
                timeoutMs: task.input.timeoutMs ?? this.options.timeoutMs,
                conversation: turn.conversation,
                promptMessageId: turn.promptMessageId,
            });
            await this.saveCompletedRuntimeTurn(turn, response.stopReason);
            task.settleResult({
                status: response.stopReason === "cancelled" ? "cancelled" : "completed",
                ...(response.stopReason ? { stopReason: response.stopReason } : {}),
            });
        }
        catch (error) {
            this.failRuntimeTurn(task, error);
        }
        finally {
            await this.finalizeRuntimeTurn(task, turn);
        }
    }
    async prepareRuntimeTurn(task) {
        const record = await this.requireRecord(task.input.handle.acpxRecordId ?? task.input.handle.sessionKey);
        const conversation = cloneSessionConversation(record);
        let acpxState = cloneSessionAcpxState(record.acpx);
        const promptStartedAt = isoNow();
        const promptMessageId = recordPromptSubmission(conversation, task.promptInput, promptStartedAt);
        trimConversationForRuntime(conversation);
        record.lastPromptAt = promptStartedAt;
        record.lastUsedAt = promptStartedAt;
        record.acpx = acpxState;
        applyConversation(record, conversation);
        await this.options.sessionStore.save(record);
        const pendingClient = await this.readPendingPersistentClient(record, { consume: true });
        const client = pendingClient ?? this.createTurnClient(record);
        const turn = {
            record,
            conversation,
            acpxState,
            liveCheckpoint: this.createRuntimeTurnCheckpoint(record, conversation, () => turn.acpxState),
            client,
            pendingClient,
            promptMessageId,
            activeSessionId: record.acpSessionId,
        };
        task.state.activeController = this.buildRuntimeTurnController(task, turn);
        this.activeControllers.set(record.acpxRecordId, task.state.activeController);
        this.installRuntimeTurnEventHandlers(task, turn);
        return turn;
    }
    createTurnClient(record) {
        return this.createClient({
            agentCommand: record.agentCommand,
            agentArgv: record.agentArgv,
            cwd: record.cwd,
            mcpServers: [...(this.options.mcpServers ?? [])],
            permissionMode: this.options.permissionMode,
            nonInteractivePermissions: this.options.nonInteractivePermissions,
            permissionPolicy: this.options.permissionPolicy,
            onPermissionRequest: this.options.onPermissionRequest,
            verbose: this.options.verbose,
            sessionOptions: sessionOptionsFromRecord(record),
        });
    }
    createRuntimeTurnCheckpoint(record, conversation, readAcpxState) {
        return new LiveSessionCheckpoint({
            save: async () => {
                record.lastUsedAt = isoNow();
                record.acpx = readAcpxState();
                applyConversation(record, conversation);
                await this.refreshClosedState(record);
                await this.options.sessionStore.save(record);
            },
        });
    }
    buildRuntimeTurnController(task, turn) {
        return {
            hasActivePrompt: () => turn.client.hasActivePrompt(),
            requestCancelActivePrompt: async () => await this.requestRuntimeTurnCancel(task, turn),
            setSessionMode: async (modeId) => {
                await this.waitForRuntimeControlSession(task, turn);
                await turn.client.setSessionMode(turn.activeSessionId, modeId);
                const nextState = cloneSessionAcpxState(turn.acpxState) ?? {};
                nextState.desired_mode_id = modeId;
                turn.acpxState = nextState;
            },
            setSessionModel: async (modelId) => {
                await this.waitForRuntimeControlSession(task, turn);
                const models = advertisedModelState(turn.acpxState);
                const response = await turn.client.setSessionModel(turn.activeSessionId, modelId, models);
                applyConfigOptionResponseToTurn(turn, response);
                const nextState = cloneSessionAcpxState(turn.acpxState) ?? {};
                nextState.session_options = { ...nextState.session_options, model: modelId };
                nextState.current_model_id = currentModelIdFromSetModelResponse(response, modelId);
                clearDesiredConfigOption(nextState, models?.configId);
                turn.acpxState = nextState;
                return response;
            },
            setSessionConfigOption: async (configId, value) => {
                const result = await task.state.activeController.setResolvedSessionConfigOption(configId, value);
                return result.response;
            },
            setResolvedSessionConfigOption: async (configId, value) => await this.setRuntimeResolvedSessionConfigOption(task, turn, configId, value),
        };
    }
    async waitForRuntimeControlSession(task, turn) {
        if (turn.client.hasActivePrompt()) {
            return;
        }
        await task.sessionReady.promise;
    }
    async requestRuntimeTurnCancel(task, turn) {
        if (turn.client.hasActivePrompt()) {
            return await turn.client.requestCancelActivePrompt();
        }
        if (!task.state.turnActive) {
            return false;
        }
        task.state.pendingCancel = true;
        return true;
    }
    async setRuntimeResolvedSessionConfigOption(task, turn, configId, value) {
        await this.waitForRuntimeControlSession(task, turn);
        const resolvedConfigId = resolveSupportedConfigOptionId({
            ...turn.record,
            acpx: turn.acpxState ?? undefined,
        }, configId);
        const response = await turn.client.setSessionConfigOption(turn.activeSessionId, resolvedConfigId, value);
        this.applyRuntimeConfigOptionState(turn, resolvedConfigId, value, response);
        return { configId: resolvedConfigId, response };
    }
    applyRuntimeConfigOptionState(turn, configId, value, response) {
        applyConfigOptionResponseToTurn(turn, response);
        applyDesiredConfigOptionToTurn(turn, configId, value);
    }
    installRuntimeTurnEventHandlers(task, turn) {
        turn.client.setEventHandlers({
            onSessionUpdate: (notification) => {
                turn.acpxState = recordSessionUpdate(turn.conversation, turn.acpxState, notification);
                trimConversationForRuntime(turn.conversation);
                turn.liveCheckpoint.request();
                this.emitRuntimeTurnEvent(task, {
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: notification,
                });
            },
            onClientOperation: (operation) => {
                turn.acpxState = recordClientOperation(turn.conversation, turn.acpxState, operation);
                trimConversationForRuntime(turn.conversation);
                turn.liveCheckpoint.request();
                this.emitRuntimeTurnEvent(task, {
                    type: "client_operation",
                    ...operation,
                });
            },
        });
    }
    emitRuntimeTurnEvent(task, payload) {
        const parsed = parsePromptEventLine(JSON.stringify(payload));
        if (!parsed) {
            return;
        }
        task.queue.push(parsed);
    }
    async connectRuntimeTurn(task, turn) {
        const loaded = turn.pendingClient
            ? { sessionId: turn.record.acpSessionId, resumed: false, loadError: undefined }
            : await this.connectRuntimeTurnClient(task, turn);
        turn.acpxState = cloneSessionAcpxState(turn.record.acpx);
        return loaded;
    }
    async connectRuntimeTurnClient(task, turn) {
        return await connectAndLoadSession({
            client: turn.client,
            record: turn.record,
            resumePolicy: resumePolicyForSessionMode(task.input.sessionMode),
            timeoutMs: this.options.timeoutMs,
            activeController: task.state.activeController,
            onClientAvailable: () => this.publishRuntimeTurnController(task, turn),
            onConnectedRecord: (connectedRecord) => {
                connectedRecord.lastPromptAt = isoNow();
            },
            onSessionIdResolved: (sessionIdValue) => {
                turn.activeSessionId = sessionIdValue;
            },
        });
    }
    publishRuntimeTurnController(task, turn) {
        const controller = task.state.activeController;
        if (controller) {
            this.activeControllers.set(turn.record.acpxRecordId, controller);
        }
    }
    async resolveRuntimeTurnReady(task, turn, resumed, loadError) {
        task.sessionReady.resolve();
        turn.record.lastRequestId = task.input.requestId;
        turn.record.lastPromptAt = isoNow();
        turn.record.closed = false;
        turn.record.closedAt = undefined;
        turn.record.lastUsedAt = isoNow();
        await turn.liveCheckpoint.checkpoint();
        this.emitRuntimeTurnLoadStatus(task, resumed, loadError);
    }
    emitRuntimeTurnLoadStatus(task, resumed, loadError) {
        if (!resumed && !loadError) {
            return;
        }
        this.emitRuntimeTurnEvent(task, {
            type: "status",
            text: loadError ? `session reconnect fallback: ${loadError}` : "session resumed",
        });
    }
    cancelRuntimeTurnBeforePrompt(task) {
        if (!task.state.pendingCancel && !task.input.signal?.aborted) {
            return false;
        }
        task.state.pendingCancel = false;
        task.settleResult({
            status: "cancelled",
            stopReason: "cancelled",
        });
        return true;
    }
    async applyPendingRuntimeTurnCancel(task, turn) {
        if (!task.state.pendingCancel || !turn.client.hasActivePrompt()) {
            return false;
        }
        const cancelled = await turn.client.requestCancelActivePrompt();
        if (cancelled) {
            task.state.pendingCancel = false;
        }
        return cancelled;
    }
    async saveCompletedRuntimeTurn(turn, _stopReason) {
        turn.record.acpSessionId = turn.activeSessionId;
        reconcileAgentSessionId(turn.record, turn.record.agentSessionId);
        turn.record.protocolVersion = turn.client.initializeResult?.protocolVersion;
        turn.record.agentCapabilities = turn.client.initializeResult?.agentCapabilities;
        turn.record.acpx = turn.acpxState;
        applyConversation(turn.record, turn.conversation);
        applyLifecycleSnapshotToRecord(turn.record, turn.client.getAgentLifecycleSnapshot());
        await this.options.sessionStore.save(turn.record);
    }
    failRuntimeTurn(task, error) {
        task.sessionReady.reject(error);
        const normalized = normalizeOutputError(error, { origin: "runtime" });
        task.settleResult({
            status: "failed",
            error: {
                message: normalized.message,
                ...(normalized.code ? { code: normalized.code } : {}),
                ...(normalized.detailCode ? { detailCode: normalized.detailCode } : {}),
                ...(normalized.retryable !== undefined ? { retryable: normalized.retryable } : {}),
            },
        });
    }
    async finalizeRuntimeTurn(task, turn) {
        task.state.turnActive = false;
        task.input.signal?.removeEventListener("abort", task.abortHandler);
        turn?.client.clearEventHandlers();
        const pooled = turn ? await this.finalizeRuntimeTurnRecord(turn) : false;
        if (!pooled) {
            await turn?.client.close().catch(() => { });
        }
        if (turn) {
            this.activeControllers.delete(turn.record.acpxRecordId);
            this.closingActiveRecords.delete(turn.record.acpxRecordId);
        }
        task.queue.close();
    }
    async finalizeRuntimeTurnRecord(turn) {
        applyLifecycleSnapshotToRecord(turn.record, turn.client.getAgentLifecycleSnapshot());
        turn.record.acpx = turn.acpxState;
        applyConversation(turn.record, turn.conversation);
        turn.record.lastUsedAt = isoNow();
        await turn.liveCheckpoint.flush().catch(() => { });
        const closed = await this.refreshClosedState(turn.record);
        await this.options.sessionStore.save(turn.record).catch(() => { });
        if (closed) {
            return false;
        }
        return await this.retainPersistentClientAfterTurn({
            record: turn.record,
            client: turn.client,
        });
    }
    async *runTurn(input) {
        const turn = this.startTurn(input);
        yield* turn.events;
        yield legacyTerminalEventFromTurnResult(await turn.result);
    }
    async getStatus(handle) {
        const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
        return {
            summary: statusSummary(record),
            acpxRecordId: record.acpxRecordId,
            backendSessionId: record.acpSessionId,
            agentSessionId: record.agentSessionId,
            ...buildModelsField(record),
            ...buildUsageField(record),
            ...buildAvailableCommandsField(record),
            details: {
                cwd: record.cwd,
                lastUsedAt: record.lastUsedAt,
                closed: record.closed === true,
                ...(record.acpx?.config_options !== undefined
                    ? { configOptions: structuredClone(record.acpx.config_options) }
                    : {}),
            },
        };
    }
    async setMode(handle, mode, sessionMode = "persistent") {
        const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
        const controller = this.activeControllers.get(record.acpxRecordId);
        let targetRecord = record;
        if (controller) {
            await controller.setSessionMode(mode);
        }
        else {
            const result = await this.withRuntimeControlSession(record, sessionMode, async ({ client, sessionId }) => {
                await client.setSessionMode(sessionId, mode);
            });
            targetRecord = result.record;
        }
        setDesiredModeId(targetRecord, mode);
        await this.options.sessionStore.save(targetRecord);
    }
    async setConfigOption(handle, key, value, sessionMode = "persistent") {
        const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
        const controller = this.activeControllers.get(record.acpxRecordId);
        if (controller) {
            const { configId, response } = await controller.setResolvedSessionConfigOption(key, value);
            applyConfigOptionsToRecord(record, response);
            applyDesiredConfigOptionToRecord(record, configId, value);
            await this.options.sessionStore.save(record);
            return;
        }
        const result = await this.withRuntimeControlSession(record, sessionMode, async ({ client, sessionId, record: connectedRecord }) => {
            const configId = resolveSupportedConfigOptionId(connectedRecord, key);
            const response = await client.setSessionConfigOption(sessionId, configId, value);
            applyConfigOptionsToRecord(connectedRecord, response);
            applyDesiredConfigOptionToRecord(connectedRecord, configId, value);
        });
        await this.options.sessionStore.save(result.record);
    }
    async cancel(handle) {
        const controller = this.activeControllers.get(handle.acpxRecordId ?? handle.sessionKey);
        await controller?.requestCancelActivePrompt();
    }
    async close(handle, options = {}) {
        const record = await this.requireRecord(handle.acpxRecordId ?? handle.sessionKey);
        if (this.activeControllers.has(record.acpxRecordId)) {
            this.closingActiveRecords.add(record.acpxRecordId);
        }
        await this.cancel(handle);
        if (options.discardPersistentState) {
            await this.closeBackendSession(record);
            record.acpx = {
                ...record.acpx,
                reset_on_next_ensure: true,
            };
        }
        else {
            await this.closePendingPersistentClient(record.acpxRecordId);
        }
        record.closed = true;
        record.closedAt = isoNow();
        await this.options.sessionStore.save(record);
    }
    async closeBackendSession(record) {
        const pendingClient = await this.readPendingPersistentClient(record, { consume: true });
        const client = pendingClient ??
            this.createClient({
                agentCommand: record.agentCommand,
                agentArgv: record.agentArgv,
                cwd: record.cwd,
                mcpServers: [...(this.options.mcpServers ?? [])],
                permissionMode: this.options.permissionMode,
                nonInteractivePermissions: this.options.nonInteractivePermissions,
                permissionPolicy: this.options.permissionPolicy,
                onPermissionRequest: this.options.onPermissionRequest,
                verbose: this.options.verbose,
            });
        try {
            if (!pendingClient) {
                await withTimeout(client.start(), this.options.timeoutMs);
            }
            if (!client.supportsCloseSession()) {
                throw new AcpRuntimeError("ACP_BACKEND_UNSUPPORTED_CONTROL", `Agent does not support session/close for ${record.acpxRecordId}.`);
            }
            await withTimeout(client.closeSession(record.acpSessionId), this.options.timeoutMs);
        }
        catch (error) {
            if (isUnsupportedSessionCloseError(error)) {
                throw new AcpRuntimeError("ACP_BACKEND_UNSUPPORTED_CONTROL", `Agent does not support session/close for ${record.acpxRecordId}.`, { cause: error });
            }
            if (isAcpResourceNotFoundError(error)) {
                return;
            }
            throw error;
        }
        finally {
            await client.close().catch(() => { });
        }
    }
    async requireRecord(sessionId) {
        const record = await this.options.sessionStore.load(sessionId);
        if (!record) {
            throw new Error(`ACP session not found: ${sessionId}`);
        }
        return record;
    }
}
