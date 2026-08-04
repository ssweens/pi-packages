import { resolveAgentArgvForCommand } from "../../acp/builtin-command-migration.js";
import { SESSION_RECORD_SCHEMA } from "../../types.js";
import { defaultSessionEventLog } from "../event-log.js";
import { normalizeRuntimeSessionId } from "../runtime-session-id.js";
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function parseOptionalAgentArgv(value) {
    return isStringArray(value) && value.length > 0 && value[0]?.length > 0 ? value : undefined;
}
function parsePersistedAgentArgv(record) {
    return (parseOptionalAgentArgv(record.agent_argv) ??
        (typeof record.agent_command === "string"
            ? resolveAgentArgvForCommand(record.agent_command)
            : undefined));
}
function hasModelConfigOption(options) {
    if (!Array.isArray(options)) {
        return false;
    }
    return options.some((entry) => {
        const option = asRecord(entry);
        return option?.category === "model" || option?.id === "model";
    });
}
function parseConfigOptions(raw) {
    if (!Array.isArray(raw) || !raw.every((entry) => asRecord(entry) !== undefined)) {
        return undefined;
    }
    return raw;
}
function parseAvailableCommand(raw) {
    if (typeof raw === "string") {
        const name = raw.trim();
        return name ? { name } : undefined;
    }
    const record = asRecord(raw);
    if (!record) {
        return undefined;
    }
    const name = parseNonEmptyString(record.name);
    if (!name) {
        return undefined;
    }
    const description = parseNonEmptyString(record.description);
    return {
        name,
        ...(description ? { description } : {}),
        ...(typeof record.has_input === "boolean" ? { has_input: record.has_input } : {}),
    };
}
function parseAvailableCommands(raw) {
    if (!Array.isArray(raw)) {
        return undefined;
    }
    const commands = raw
        .map((entry) => parseAvailableCommand(entry))
        .filter((entry) => entry !== undefined);
    return commands.length > 0 ? commands : undefined;
}
function parseNonEmptyString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
}
function parseTokenUsage(raw) {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    const record = asRecord(raw);
    if (!record) {
        return null;
    }
    const usage = {};
    const fields = [
        "input_tokens",
        "output_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "thought_tokens",
        "total_tokens",
    ];
    for (const field of fields) {
        const value = record[field];
        if (value === undefined) {
            continue;
        }
        if (!isNonNegativeFiniteNumber(value)) {
            return null;
        }
        usage[field] = value;
    }
    return usage;
}
function isNonNegativeFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
function parseUsageCost(raw) {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    const record = asRecord(raw);
    if (!record) {
        return null;
    }
    return parseUsageCostRecord(record);
}
function parseUsageCostRecord(record) {
    const amount = parseCostAmount(record.amount);
    const currency = parseCostCurrency(record.currency);
    if (amount === null || currency === null) {
        return null;
    }
    const cost = {
        ...(amount !== undefined ? { amount } : {}),
        ...(currency !== undefined ? { currency } : {}),
    };
    return Object.keys(cost).length > 0 ? cost : undefined;
}
function parseCostAmount(value) {
    if (value === undefined) {
        return undefined;
    }
    return isNonNegativeFiniteNumber(value) ? value : null;
}
function parseCostCurrency(value) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== "string") {
        return null;
    }
    const currency = value.trim();
    return currency.length > 0 ? currency : undefined;
}
function parseRequestTokenUsage(raw) {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    const record = asRecord(raw);
    if (!record) {
        return null;
    }
    const usage = {};
    for (const [key, value] of Object.entries(record)) {
        const parsed = parseTokenUsage(value);
        if (parsed == null) {
            return null;
        }
        usage[key] = parsed;
    }
    return usage;
}
function isSessionMessageImage(raw) {
    const record = asRecord(raw);
    if (!record || typeof record.source !== "string") {
        return false;
    }
    if (record.size === undefined || record.size === null) {
        return true;
    }
    const size = asRecord(record.size);
    return !!size && isFiniteNumber(size.width) && isFiniteNumber(size.height);
}
function isSessionMessageAudio(raw) {
    const record = asRecord(raw);
    return !!record && typeof record.source === "string" && typeof record.mime_type === "string";
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isUserContent(raw) {
    const record = asRecord(raw);
    if (!record) {
        return false;
    }
    if (typeof record.Text === "string") {
        return true;
    }
    if (record.Mention !== undefined) {
        const mention = asRecord(record.Mention);
        return !!mention && typeof mention.uri === "string" && typeof mention.content === "string";
    }
    if (record.Image !== undefined) {
        return isSessionMessageImage(record.Image);
    }
    if (record.Audio !== undefined) {
        return isSessionMessageAudio(record.Audio);
    }
    return false;
}
function isToolUse(raw) {
    const record = asRecord(raw);
    return (!!record &&
        hasStringFields(record, ["id", "name", "raw_input"]) &&
        hasOwn(record, "input") &&
        typeof record.is_input_complete === "boolean" &&
        isOptionalString(record.thought_signature));
}
function hasStringFields(record, keys) {
    return keys.every((key) => typeof record[key] === "string");
}
function isOptionalString(value) {
    return value === undefined || value === null || typeof value === "string";
}
function isToolResultContent(raw) {
    const record = asRecord(raw);
    if (!record) {
        return false;
    }
    if (typeof record.Text === "string") {
        return true;
    }
    if (record.Image !== undefined) {
        return isSessionMessageImage(record.Image);
    }
    return false;
}
function isToolResult(raw) {
    const record = asRecord(raw);
    return (!!record &&
        typeof record.tool_use_id === "string" &&
        typeof record.tool_name === "string" &&
        typeof record.is_error === "boolean" &&
        isToolResultContent(record.content));
}
function isAgentContent(raw) {
    const record = asRecord(raw);
    if (!record) {
        return false;
    }
    if (typeof record.Text === "string") {
        return true;
    }
    if (record.Thinking !== undefined) {
        return isThinkingContent(record.Thinking);
    }
    if (typeof record.RedactedThinking === "string") {
        return true;
    }
    if (record.ToolUse !== undefined) {
        return isToolUse(record.ToolUse);
    }
    return false;
}
function isThinkingContent(raw) {
    const thinking = asRecord(raw);
    return !!thinking && typeof thinking.text === "string" && isOptionalString(thinking.signature);
}
function isUserMessage(raw) {
    const record = asRecord(raw);
    if (!record || record.User === undefined) {
        return false;
    }
    const user = asRecord(record.User);
    return (!!user &&
        typeof user.id === "string" &&
        Array.isArray(user.content) &&
        user.content.every((entry) => isUserContent(entry)));
}
function isAgentMessage(raw) {
    const record = asRecord(raw);
    if (!record || record.Agent === undefined) {
        return false;
    }
    const agent = asRecord(record.Agent);
    if (!agent || !Array.isArray(agent.content) || !agent.content.every(isAgentContent)) {
        return false;
    }
    const toolResults = asRecord(agent.tool_results);
    if (!toolResults) {
        return false;
    }
    return Object.values(toolResults).every(isToolResult);
}
function isConversationMessage(raw) {
    return raw === "Resume" || isUserMessage(raw) || isAgentMessage(raw);
}
function parseConversationRecord(record) {
    if (!hasValidConversationCore(record)) {
        return undefined;
    }
    const title = parseConversationTitle(record.title);
    if (title === INVALID_VALUE) {
        return undefined;
    }
    const cumulativeTokenUsage = parseTokenUsage(record.cumulative_token_usage);
    const cumulativeCost = parseUsageCost(record.cumulative_cost);
    const requestTokenUsage = parseRequestTokenUsage(record.request_token_usage);
    if (cumulativeTokenUsage === null || cumulativeCost === null || requestTokenUsage === null) {
        return undefined;
    }
    return {
        title,
        messages: record.messages,
        updated_at: record.updated_at,
        cumulative_token_usage: cumulativeTokenUsage ?? {},
        cumulative_cost: cumulativeCost,
        request_token_usage: requestTokenUsage ?? {},
    };
}
const INVALID_VALUE = Symbol("invalid");
function parseConversationTitle(value) {
    if (value === undefined || value === null || typeof value === "string") {
        return value;
    }
    return INVALID_VALUE;
}
function hasValidConversationCore(record) {
    return (Array.isArray(record.messages) &&
        record.messages.every(isConversationMessage) &&
        typeof record.updated_at === "string");
}
function parseAcpxState(raw) {
    const record = asRecord(raw);
    if (!record) {
        return undefined;
    }
    const state = {};
    assignBooleanTrue(state, "reset_on_next_ensure", record.reset_on_next_ensure);
    assignStringState(state, "current_mode_id", record.current_mode_id);
    assignStringState(state, "desired_mode_id", record.desired_mode_id);
    assignDesiredConfigOptions(state, record.desired_config_options);
    assignParsedModelState(state, record);
    const availableCommands = parseAvailableCommands(record.available_commands);
    if (availableCommands) {
        state.available_commands = availableCommands;
    }
    assignParsedSessionOptions(state, record.session_options);
    return state;
}
function assignParsedModelState(state, record) {
    assignStringState(state, "current_model_id", record.current_model_id);
    if (isStringArray(record.available_models)) {
        state.available_models = [...record.available_models];
    }
    if (record.model_control === "config_option" || record.model_control === "legacy_set_model") {
        state.model_control = record.model_control;
    }
    const configOptions = parseConfigOptions(record.config_options);
    if (configOptions) {
        state.config_options = configOptions;
    }
    if (state.model_control === undefined && state.available_models !== undefined) {
        state.model_control = hasModelConfigOption(state.config_options)
            ? "config_option"
            : "legacy_set_model";
    }
}
function assignBooleanTrue(state, key, value) {
    if (value === true) {
        state[key] = true;
    }
}
function assignStringState(state, key, value) {
    if (typeof value === "string") {
        state[key] = value;
    }
}
function assignDesiredConfigOptions(state, raw) {
    const desiredConfigOptions = asRecord(raw);
    if (!desiredConfigOptions) {
        return;
    }
    const parsed = Object.fromEntries(Object.entries(desiredConfigOptions).filter((entry) => {
        const [, value] = entry;
        return typeof value === "string";
    }));
    if (Object.keys(parsed).length > 0) {
        state.desired_config_options = parsed;
    }
}
function assignParsedSessionOptions(state, raw) {
    const sessionOptions = asRecord(raw);
    if (!sessionOptions) {
        return;
    }
    const parsedSessionOptions = {};
    assignSessionOptionModel(parsedSessionOptions, sessionOptions.model);
    assignSessionOptionAllowedTools(parsedSessionOptions, sessionOptions.allowed_tools);
    assignSessionOptionMaxTurns(parsedSessionOptions, sessionOptions.max_turns);
    assignSessionOptionSystemPrompt(parsedSessionOptions, sessionOptions.system_prompt);
    assignSessionOptionEnv(parsedSessionOptions, sessionOptions.env);
    if (Object.keys(parsedSessionOptions).length > 0) {
        state.session_options = parsedSessionOptions;
    }
}
function assignSessionOptionModel(options, value) {
    if (typeof value === "string") {
        options.model = value;
    }
}
function assignSessionOptionAllowedTools(options, value) {
    if (isStringArray(value)) {
        options.allowed_tools = [...value];
    }
}
function assignSessionOptionMaxTurns(options, value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0) {
        options.max_turns = value;
    }
}
function assignSessionOptionSystemPrompt(options, value) {
    if (typeof value === "string" && value.length > 0) {
        options.system_prompt = value;
        return;
    }
    const appendRecord = asRecord(value);
    if (appendRecord && typeof appendRecord.append === "string" && appendRecord.append.length > 0) {
        options.system_prompt = { append: appendRecord.append };
    }
}
function assignSessionOptionEnv(options, value) {
    const env = asRecord(value);
    if (!env) {
        return;
    }
    const parsed = Object.fromEntries(Object.entries(env).filter((entry) => {
        const [, raw] = entry;
        return typeof raw === "string";
    }));
    if (Object.keys(parsed).length > 0) {
        options.env = parsed;
    }
}
function parseEventLog(raw, sessionId) {
    const record = asRecord(raw);
    if (!record || !hasValidEventLogCore(record)) {
        return defaultSessionEventLog(sessionId);
    }
    return {
        active_path: record.active_path,
        segment_count: record.segment_count,
        max_segment_bytes: record.max_segment_bytes,
        max_segments: record.max_segments,
        last_write_at: typeof record.last_write_at === "string" ? record.last_write_at : undefined,
        last_write_error: record.last_write_error == null || typeof record.last_write_error === "string"
            ? record.last_write_error
            : null,
    };
}
function hasValidEventLogCore(record) {
    return (typeof record.active_path === "string" &&
        isPositiveInteger(record.segment_count) &&
        isPositiveInteger(record.max_segment_bytes) &&
        isPositiveInteger(record.max_segments));
}
function isPositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
}
function parseImportedFrom(raw) {
    if (raw == null) {
        return undefined;
    }
    const record = asRecord(raw);
    if (!record ||
        typeof record.record_id !== "string" ||
        typeof record.cwd_original !== "string" ||
        typeof record.exported_by !== "string" ||
        typeof record.exported_at !== "string") {
        return null;
    }
    return {
        recordId: record.record_id,
        cwdOriginal: record.cwd_original,
        exportedBy: record.exported_by,
        exportedAt: record.exported_at,
    };
}
function parseSessionRecordMetadata(record) {
    const lastRequestId = normalizeOptionalString(record.last_request_id);
    if (lastRequestId === null) {
        return null;
    }
    const importedFrom = parseImportedFrom(record.imported_from);
    if (importedFrom === null) {
        return null;
    }
    return { lastRequestId, importedFrom };
}
function normalizeOptionalName(value) {
    if (value == null) {
        return undefined;
    }
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function normalizeOptionalPid(value) {
    if (value == null) {
        return undefined;
    }
    if (!Number.isInteger(value) || value <= 0) {
        return null;
    }
    return value;
}
function normalizeOptionalBoolean(value, fallback = false) {
    if (value == null) {
        return fallback;
    }
    return typeof value === "boolean" ? value : null;
}
function normalizeOptionalString(value) {
    if (value == null) {
        return undefined;
    }
    return typeof value === "string" ? value : null;
}
function normalizeOptionalExitCode(value) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (Number.isInteger(value)) {
        return value;
    }
    return Symbol("invalid");
}
function normalizeOptionalSignal(value) {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        return value;
    }
    return Symbol("invalid");
}
export function parseSessionRecord(raw) {
    const record = asRecord(raw);
    if (!record) {
        return null;
    }
    if (record.schema !== SESSION_RECORD_SCHEMA) {
        return null;
    }
    const name = normalizeOptionalName(record.name);
    const pid = normalizeOptionalPid(record.pid);
    const closed = normalizeOptionalBoolean(record.closed, false);
    const closedAt = normalizeOptionalString(record.closed_at);
    const agentStartedAt = normalizeOptionalString(record.agent_started_at);
    const lastPromptAt = normalizeOptionalString(record.last_prompt_at);
    const lastAgentExitCode = normalizeOptionalExitCode(record.last_agent_exit_code);
    const lastAgentExitSignal = normalizeOptionalSignal(record.last_agent_exit_signal);
    const lastAgentExitAt = normalizeOptionalString(record.last_agent_exit_at);
    const lastAgentDisconnectReason = normalizeOptionalString(record.last_agent_disconnect_reason);
    const optionals = validSessionOptionals({
        name,
        pid,
        closed,
        closedAt,
        agentStartedAt,
        lastPromptAt,
        lastAgentExitCode,
        lastAgentExitSignal,
        lastAgentExitAt,
        lastAgentDisconnectReason,
    });
    if (!hasValidSessionRecordCore(record) || !optionals) {
        return null;
    }
    const conversation = parseConversationRecord(record);
    if (!conversation) {
        return null;
    }
    const eventLog = parseEventLog(record.event_log, record.acpx_record_id);
    const metadata = parseSessionRecordMetadata(record);
    if (!metadata) {
        return null;
    }
    return {
        schema: SESSION_RECORD_SCHEMA,
        acpxRecordId: record.acpx_record_id,
        acpSessionId: record.acp_session_id,
        agentSessionId: normalizeRuntimeSessionId(record.agent_session_id),
        agentCommand: record.agent_command,
        agentArgv: parsePersistedAgentArgv(record),
        cwd: record.cwd,
        name: optionals.name,
        createdAt: record.created_at,
        lastUsedAt: record.last_used_at,
        lastSeq: record.last_seq,
        lastRequestId: metadata.lastRequestId,
        eventLog,
        closed: optionals.closed,
        closedAt: optionals.closedAt,
        pid: optionals.pid,
        agentStartedAt: optionals.agentStartedAt,
        lastPromptAt: optionals.lastPromptAt,
        lastAgentExitCode: optionals.lastAgentExitCode,
        lastAgentExitSignal: optionals.lastAgentExitSignal,
        lastAgentExitAt: optionals.lastAgentExitAt,
        lastAgentDisconnectReason: optionals.lastAgentDisconnectReason,
        protocolVersion: typeof record.protocol_version === "number" ? record.protocol_version : undefined,
        agentCapabilities: asRecord(record.agent_capabilities),
        title: conversation.title,
        messages: conversation.messages,
        updated_at: conversation.updated_at,
        cumulative_token_usage: conversation.cumulative_token_usage,
        cumulative_cost: conversation.cumulative_cost,
        request_token_usage: conversation.request_token_usage,
        acpx: parseAcpxState(record.acpx),
        importedFrom: metadata.importedFrom,
    };
}
function hasValidSessionRecordCore(record) {
    return (hasStringFields(record, [
        "acpx_record_id",
        "acp_session_id",
        "agent_command",
        "cwd",
        "created_at",
        "last_used_at",
    ]) &&
        typeof record.last_seq === "number" &&
        Number.isInteger(record.last_seq) &&
        record.last_seq >= 0);
}
function validSessionOptionals(options) {
    if (hasNullOptionalSessionFields(options) || hasInvalidExitStatus(options)) {
        return null;
    }
    return options;
}
function hasNullOptionalSessionFields(options) {
    return [
        options.name,
        options.pid,
        options.closed,
        options.closedAt,
        options.agentStartedAt,
        options.lastPromptAt,
        options.lastAgentExitAt,
        options.lastAgentDisconnectReason,
    ].some((value) => value === null);
}
function hasInvalidExitStatus(options) {
    return (typeof options.lastAgentExitCode === "symbol" || typeof options.lastAgentExitSignal === "symbol");
}
