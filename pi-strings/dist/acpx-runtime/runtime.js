import { DEFAULT_AGENT_NAME, listBuiltInAgents, normalizeAgentName, resolveCanonicalAgentName, resolveAgentArgv, resolveAgentCommand, } from "./agent-registry.js";
import { AcpRuntimeManager } from "./runtime/engine/manager.js";
import { AcpRuntimeError } from "./runtime/public/errors.js";
import { createFileSessionStore } from "./runtime/public/file-session-store.js";
import { decodeAcpxRuntimeHandleState, writeHandleState } from "./runtime/public/handle-state.js";
import { normalizeRuntimeDetails, probeRuntime } from "./runtime/public/probe.js";
import { deriveAgentFromSessionKey } from "./runtime/public/shared.js";
export { DEFAULT_AGENT_NAME, createFileSessionStore };
export { AcpRuntimeError, isAcpRuntimeError } from "./runtime/public/errors.js";
export { REQUESTED_MODEL_UNSUPPORTED_ERROR_CODE, REQUESTED_MODEL_UNSUPPORTED_REASONS, isRequestedModelUnsupportedError, RequestedModelUnsupportedError, } from "./acp/model-support.js";
export { decodeAcpxRuntimeHandleState, encodeAcpxRuntimeHandleState, } from "./runtime/public/handle-state.js";
export const ACPX_BACKEND_ID = "acpx";
const ACPX_CAPABILITIES = {
    controls: ["session/set_mode", "session/set_config_option", "session/status"],
};
export function createAgentRegistry(params) {
    const overrides = normalizeRegistryOverrides(params?.overrides);
    return {
        resolve(agentName) {
            const normalizedAgentName = normalizeAgentName(agentName);
            const override = overrides[normalizedAgentName] ?? overrides[resolveCanonicalAgentName(agentName)];
            return override ?? resolveAgentArgv(agentName) ?? resolveAgentCommand(agentName);
        },
        list() {
            return listBuiltInAgents(overrides);
        },
    };
}
function normalizeRegistryOverrides(values) {
    const normalized = {};
    for (const [name, value] of Object.entries(values ?? {})) {
        const normalizedName = normalizeAgentName(name);
        if (!normalizedName) {
            continue;
        }
        const normalizedValue = normalizeRegistryOverride(value);
        if (normalizedValue) {
            normalized[normalizedName] = normalizedValue;
        }
    }
    return normalized;
}
function normalizeRegistryOverride(value) {
    if (typeof value === "string") {
        return value.trim() || undefined;
    }
    return value.length > 0 && value[0]?.length ? [...value] : undefined;
}
export class AcpxRuntime {
    options;
    testOptions;
    healthy = false;
    manager = null;
    managerPromise = null;
    constructor(options, testOptions) {
        this.options = options;
        this.testOptions = testOptions;
    }
    isHealthy() {
        return this.healthy;
    }
    async probeAvailability() {
        const report = await this.runProbe();
        this.healthy = report.ok;
    }
    async doctor() {
        const report = await this.runProbe();
        this.healthy = report.ok;
        return {
            ok: report.ok,
            code: report.ok ? undefined : "ACP_BACKEND_UNAVAILABLE",
            message: report.message,
            details: normalizeRuntimeDetails(report.details),
        };
    }
    async ensureSession(input) {
        const sessionName = input.sessionKey.trim();
        if (!sessionName) {
            throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP session key is required.");
        }
        const agent = input.agent.trim();
        if (!agent) {
            throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "ACP agent id is required.");
        }
        const manager = await this.getManager();
        const record = await manager.ensureSession({
            sessionKey: sessionName,
            agent,
            mode: input.mode,
            cwd: input.cwd ?? this.options.cwd,
            resumeSessionId: input.resumeSessionId,
            sessionOptions: input.sessionOptions,
        });
        const handle = {
            sessionKey: input.sessionKey,
            backend: ACPX_BACKEND_ID,
            runtimeSessionName: "",
            cwd: record.cwd,
            acpxRecordId: record.acpxRecordId,
            backendSessionId: record.acpSessionId,
            agentSessionId: record.agentSessionId,
        };
        writeHandleState(handle, {
            name: sessionName,
            agent,
            cwd: record.cwd,
            mode: input.mode,
            acpxRecordId: record.acpxRecordId,
            backendSessionId: record.acpSessionId,
            agentSessionId: record.agentSessionId,
        });
        return handle;
    }
    startTurn(input) {
        const { handle, state } = this.resolveManagerHandle(input.handle);
        const managerPromise = this.getManager();
        const turnPromise = managerPromise.then((manager) => manager.startTurn({
            handle,
            text: input.text,
            attachments: input.attachments,
            mode: input.mode,
            sessionMode: state.mode,
            requestId: input.requestId,
            timeoutMs: input.timeoutMs,
            signal: input.signal,
        }));
        return {
            requestId: input.requestId,
            events: {
                async *[Symbol.asyncIterator]() {
                    const turn = await turnPromise;
                    yield* turn.events;
                },
            },
            get result() {
                return turnPromise.then((turn) => turn.result);
            },
            cancel(inputArgs) {
                return turnPromise.then((turn) => turn.cancel(inputArgs));
            },
            closeStream(inputArgs) {
                return turnPromise.then((turn) => turn.closeStream(inputArgs));
            },
        };
    }
    async *runTurn(input) {
        const { handle, state } = this.resolveManagerHandle(input.handle);
        const manager = await this.getManager();
        yield* manager.runTurn({
            handle,
            text: input.text,
            attachments: input.attachments,
            mode: input.mode,
            sessionMode: state.mode,
            requestId: input.requestId,
            timeoutMs: input.timeoutMs,
            signal: input.signal,
        });
    }
    async getCapabilities(input) {
        if (!input?.handle) {
            return ACPX_CAPABILITIES;
        }
        const { handle } = this.resolveManagerHandle(input.handle);
        const record = await this.options.sessionStore.load(handle.acpxRecordId ?? handle.sessionKey);
        if (!record?.acpx?.config_options) {
            return ACPX_CAPABILITIES;
        }
        const configOptionKeys = Array.from(new Set(record.acpx.config_options
            .map((option) => option.id)
            .filter((id) => typeof id === "string" && id.trim().length > 0)));
        return {
            ...ACPX_CAPABILITIES,
            ...(configOptionKeys.length > 0 ? { configOptionKeys } : {}),
        };
    }
    async getStatus(input) {
        const { handle } = this.resolveManagerHandle(input.handle);
        const manager = await this.getManager();
        return await manager.getStatus(handle);
    }
    async setMode(input) {
        const { handle, state } = this.resolveManagerHandle(input.handle);
        const manager = await this.getManager();
        await manager.setMode(handle, input.mode, state.mode);
    }
    async setConfigOption(input) {
        const { handle, state } = this.resolveManagerHandle(input.handle);
        const manager = await this.getManager();
        await manager.setConfigOption(handle, input.key, input.value, state.mode);
    }
    async cancel(input) {
        const { handle } = this.resolveManagerHandle(input.handle);
        const manager = await this.getManager();
        await manager.cancel(handle);
    }
    async close(input) {
        const { handle } = this.resolveManagerHandle(input.handle);
        const manager = await this.getManager();
        await manager.close(handle, {
            discardPersistentState: input.discardPersistentState,
        });
    }
    async getManager() {
        if (this.manager) {
            return this.manager;
        }
        if (!this.managerPromise) {
            this.managerPromise = Promise.resolve(this.testOptions?.managerFactory?.(this.options) ?? new AcpRuntimeManager(this.options)).then((manager) => {
                this.manager = manager;
                return manager;
            });
        }
        return await this.managerPromise;
    }
    async runProbe() {
        return await (this.testOptions?.probeRunner?.(this.options) ?? probeRuntime(this.options));
    }
    resolveManagerHandle(handle) {
        const state = this.resolveHandleState(handle);
        return {
            handle: {
                ...handle,
                acpxRecordId: state.acpxRecordId ?? handle.acpxRecordId ?? handle.sessionKey,
            },
            state,
        };
    }
    resolveHandleState(handle) {
        const decoded = decodeAcpxRuntimeHandleState(handle.runtimeSessionName);
        if (decoded) {
            return {
                ...decoded,
                acpxRecordId: decoded.acpxRecordId ?? handle.acpxRecordId,
                backendSessionId: decoded.backendSessionId ?? handle.backendSessionId,
                agentSessionId: decoded.agentSessionId ?? handle.agentSessionId,
            };
        }
        const runtimeSessionName = handle.runtimeSessionName.trim();
        if (!runtimeSessionName) {
            throw new AcpRuntimeError("ACP_SESSION_INIT_FAILED", "Invalid embedded ACP runtime handle: runtimeSessionName is missing.");
        }
        return {
            name: runtimeSessionName,
            agent: deriveAgentFromSessionKey(handle.sessionKey, DEFAULT_AGENT_NAME),
            cwd: handle.cwd ?? this.options.cwd,
            mode: "persistent",
            acpxRecordId: handle.acpxRecordId,
            backendSessionId: handle.backendSessionId,
            agentSessionId: handle.agentSessionId,
        };
    }
}
export function createAcpRuntime(options) {
    return new AcpxRuntime(options);
}
export function createRuntimeStore(options) {
    return createFileSessionStore(options);
}
