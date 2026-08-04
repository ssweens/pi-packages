import { normalizeAgentCommandInput } from "../../acp/client-process.js";
import { AcpClient } from "../../acp/client.js";
import { DEFAULT_AGENT_NAME } from "../../agent-registry.js";
function isPrimitiveDetail(value) {
    return (value == null ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint" ||
        typeof value === "symbol");
}
function formatFunctionDetail(value) {
    return value.name ? `[Function ${value.name}]` : "[Function]";
}
function serializeRuntimeDetail(value) {
    const seen = new WeakSet();
    const serialized = JSON.stringify(value, (_key, nested) => {
        if (nested instanceof Error) {
            return nested.message || nested.name;
        }
        if (nested && typeof nested === "object") {
            if (seen.has(nested)) {
                return "[Circular]";
            }
            seen.add(nested);
        }
        return nested;
    });
    return serialized ?? "undefined";
}
export function formatRuntimeDetail(value) {
    if (value instanceof Error) {
        return value.message || value.name;
    }
    if (typeof value === "string") {
        return value;
    }
    if (isPrimitiveDetail(value)) {
        return String(value);
    }
    if (typeof value === "function") {
        return formatFunctionDetail(value);
    }
    try {
        return serializeRuntimeDetail(value);
    }
    catch {
        return "unserializable object";
    }
}
export function normalizeRuntimeDetails(details) {
    return details?.map((detail) => formatRuntimeDetail(detail));
}
export async function probeRuntime(options, deps = {}) {
    const agentName = options.probeAgent?.trim() || DEFAULT_AGENT_NAME;
    const agentCommand = normalizeAgentCommandInput(options.agentRegistry.resolve(agentName));
    const client = createProbeClient(options, agentCommand, deps);
    try {
        await client.start();
        return {
            ok: true,
            message: "embedded ACP runtime ready",
            details: [
                `agent=${agentName}`,
                `command=${agentCommand.agentCommand}`,
                `cwd=${options.cwd}`,
                ...(client.initializeResult?.protocolVersion
                    ? [`protocolVersion=${client.initializeResult.protocolVersion}`]
                    : []),
            ],
        };
    }
    catch (error) {
        return {
            ok: false,
            message: "embedded ACP runtime probe failed",
            details: [
                `agent=${agentName}`,
                `command=${agentCommand.agentCommand}`,
                `cwd=${options.cwd}`,
                formatRuntimeDetail(error),
            ],
        };
    }
    finally {
        await client.close().catch(() => { });
    }
}
function createProbeClient(options, agentCommand, deps) {
    const clientOptions = {
        ...agentCommand,
        cwd: options.cwd,
        mcpServers: [...(options.mcpServers ?? [])],
        permissionMode: options.permissionMode,
        nonInteractivePermissions: options.nonInteractivePermissions,
        permissionPolicy: options.permissionPolicy,
        verbose: options.verbose,
    };
    return deps.clientFactory?.(clientOptions) ?? new AcpClient(clientOptions);
}
