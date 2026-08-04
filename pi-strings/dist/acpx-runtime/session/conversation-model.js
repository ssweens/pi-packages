import { randomUUID } from "node:crypto";
import { textPrompt } from "../prompt-content.js";
import { applyConfigOptionsModelState } from "./model-state.js";
const MAX_RUNTIME_MESSAGES = 200;
const MAX_RUNTIME_AGENT_TEXT_CHARS = 8_000;
const MAX_RUNTIME_THINKING_CHARS = 4_000;
const MAX_RUNTIME_TOOL_IO_CHARS = 4_000;
const MAX_RUNTIME_REQUEST_TOKEN_USAGE = 100;
function isoNow() {
    return new Date().toISOString();
}
function deepClone(value) {
    try {
        return structuredClone(value);
    }
    catch {
        return value;
    }
}
function hasOwn(source, key) {
    return Object.prototype.hasOwnProperty.call(source, key);
}
function normalizeAgentName(value) {
    return trimmedString(value);
}
function trimmedString(value) {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function normalizeAvailableCommand(value) {
    const record = asRecord(value);
    if (!record) {
        return undefined;
    }
    const name = trimmedString(record.name);
    if (!name) {
        return undefined;
    }
    const description = trimmedString(record.description);
    return {
        name,
        ...(description ? { description } : {}),
        has_input: record.input != null,
    };
}
function extractText(content) {
    switch (content.type) {
        case "text":
            return content.text;
        case "resource_link":
            return content.title ?? content.name ?? content.uri;
        case "resource":
            return extractResourceText(content);
        case "audio":
            return `[audio] ${content.mimeType}`;
        default:
            return undefined;
    }
}
function extractResourceText(content) {
    return "text" in content.resource && typeof content.resource.text === "string"
        ? content.resource.text
        : content.resource.uri;
}
function contentToUserContent(content) {
    if (content.type === "text") {
        return {
            Text: content.text,
        };
    }
    if (content.type === "resource_link") {
        const value = content.title ?? content.name ?? content.uri;
        return {
            Mention: {
                uri: content.uri,
                content: value,
            },
        };
    }
    if (content.type === "resource") {
        return resourceToUserContent(content);
    }
    if (content.type === "image") {
        return {
            Image: {
                source: content.data,
                size: null,
            },
        };
    }
    if (content.type === "audio") {
        return {
            Audio: {
                source: content.data,
                mime_type: content.mimeType,
            },
        };
    }
    return undefined;
}
function resourceToUserContent(content) {
    if ("text" in content.resource && typeof content.resource.text === "string") {
        return {
            Text: content.resource.text,
        };
    }
    return {
        Mention: {
            uri: content.resource.uri,
            content: content.resource.uri,
        },
    };
}
function nextUserMessageId() {
    return randomUUID();
}
function isUserMessage(message) {
    return typeof message === "object" && message !== null && hasOwn(message, "User");
}
function isAgentMessage(message) {
    return typeof message === "object" && message !== null && hasOwn(message, "Agent");
}
function isAgentTextContent(content) {
    return hasOwn(content, "Text");
}
function isAgentThinkingContent(content) {
    return hasOwn(content, "Thinking");
}
function isAgentToolUseContent(content) {
    return hasOwn(content, "ToolUse");
}
function updateConversationTimestamp(conversation, timestamp) {
    conversation.updated_at = timestamp;
}
function ensureAgentMessage(conversation) {
    const last = conversation.messages.at(-1);
    if (last && isAgentMessage(last)) {
        return last.Agent;
    }
    const created = {
        content: [],
        tool_results: {},
    };
    conversation.messages.push({ Agent: created });
    return created;
}
function appendAgentText(agent, text) {
    if (!text.trim()) {
        return;
    }
    const last = agent.content.at(-1);
    if (last && isAgentTextContent(last)) {
        last.Text = trimRuntimeText(`${last.Text}${text}`, MAX_RUNTIME_AGENT_TEXT_CHARS);
        return;
    }
    const next = {
        Text: text,
    };
    agent.content.push(next);
}
function appendAgentThinking(agent, text) {
    if (!text.trim()) {
        return;
    }
    const last = agent.content.at(-1);
    if (last && isAgentThinkingContent(last)) {
        last.Thinking.text = trimRuntimeText(`${last.Thinking.text}${text}`, MAX_RUNTIME_THINKING_CHARS);
        return;
    }
    const next = {
        Thinking: {
            text,
            signature: null,
        },
    };
    agent.content.push(next);
}
function trimRuntimeText(value, maxChars) {
    if (value.length <= maxChars) {
        return value;
    }
    return `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}
function statusIndicatesComplete(status) {
    if (typeof status !== "string") {
        return false;
    }
    const normalized = status.toLowerCase();
    return (normalized.includes("complete") ||
        normalized.includes("done") ||
        normalized.includes("success") ||
        normalized.includes("failed") ||
        normalized.includes("error") ||
        normalized.includes("cancel"));
}
function statusIndicatesError(status) {
    if (typeof status !== "string") {
        return false;
    }
    const normalized = status.toLowerCase();
    return normalized.includes("fail") || normalized.includes("error");
}
function toToolResultContent(value) {
    if (typeof value === "string") {
        return { Text: trimRuntimeText(value, MAX_RUNTIME_TOOL_IO_CHARS) };
    }
    if (value != null) {
        try {
            return { Text: trimRuntimeText(JSON.stringify(value), MAX_RUNTIME_TOOL_IO_CHARS) };
        }
        catch {
            return { Text: "[Unserializable value]" };
        }
    }
    return { Text: "" };
}
function toRawInput(value) {
    if (typeof value === "string") {
        return trimRuntimeText(value, MAX_RUNTIME_TOOL_IO_CHARS);
    }
    try {
        return trimRuntimeText(JSON.stringify(value ?? {}), MAX_RUNTIME_TOOL_IO_CHARS);
    }
    catch {
        return value == null ? "" : "[Unserializable input]";
    }
}
function ensureToolUseContent(agent, toolCallId) {
    for (const content of agent.content) {
        if (isAgentToolUseContent(content) && content.ToolUse.id === toolCallId) {
            return content.ToolUse;
        }
    }
    const created = {
        id: toolCallId,
        name: "tool_call",
        raw_input: "{}",
        input: {},
        is_input_complete: false,
        thought_signature: null,
    };
    agent.content.push({ ToolUse: created });
    return created;
}
function upsertToolResult(agent, toolCallId, patch) {
    const existing = agent.tool_results[toolCallId];
    const fallback = existingToolResultValues(existing);
    const next = {
        tool_use_id: toolCallId,
        tool_name: patch.tool_name ?? fallback.tool_name,
        is_error: patch.is_error ?? fallback.is_error,
        content: patch.content ?? fallback.content,
        output: patch.output ?? fallback.output,
    };
    agent.tool_results[toolCallId] = next;
}
function existingToolResultValues(existing) {
    if (existing) {
        return existing;
    }
    return {
        tool_use_id: "",
        tool_name: "tool_call",
        is_error: false,
        content: { Text: "" },
        output: undefined,
    };
}
function applyToolCallUpdate(agent, update) {
    const tool = ensureToolUseContent(agent, update.toolCallId);
    applyToolIdentityUpdate(tool, update);
    applyToolInputUpdate(tool, update);
    applyToolStatusUpdate(tool, update);
    applyToolResultUpdate(agent, tool, update);
}
function applyToolIdentityUpdate(tool, update) {
    if (hasOwn(update, "title")) {
        tool.name =
            normalizeAgentName(update.title) ?? tool.name ?? "tool_call";
    }
    if (hasOwn(update, "kind")) {
        const kindName = normalizeAgentName(update.kind);
        if (!tool.name || tool.name === "tool_call") {
            tool.name = kindName ?? tool.name;
        }
    }
}
function applyToolInputUpdate(tool, update) {
    if (!hasOwn(update, "rawInput")) {
        return;
    }
    const rawInput = deepClone(update.rawInput);
    tool.input = rawInput ?? {};
    tool.raw_input = toRawInput(rawInput);
}
function applyToolStatusUpdate(tool, update) {
    if (hasOwn(update, "status")) {
        tool.is_input_complete = statusIndicatesComplete(update.status);
    }
}
function applyToolResultUpdate(agent, tool, update) {
    if (!hasToolResultPatch(update)) {
        return;
    }
    const status = update.status;
    const output = hasOwn(update, "rawOutput")
        ? deepClone(update.rawOutput)
        : undefined;
    upsertToolResult(agent, update.toolCallId, {
        tool_name: tool.name,
        is_error: statusIndicatesError(status),
        content: output === undefined ? undefined : toToolResultContent(output),
        output,
    });
}
function hasToolResultPatch(update) {
    return ["rawOutput", "status", "title", "kind"].some((key) => hasOwn(update, key));
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    return value;
}
function numberField(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
            return value;
        }
    }
    return undefined;
}
function sourceToTokenUsage(source) {
    const usageRecord = asRecord(source);
    if (!usageRecord) {
        return undefined;
    }
    const normalized = {
        input_tokens: numberField(usageRecord, ["input_tokens", "inputTokens"]),
        output_tokens: numberField(usageRecord, ["output_tokens", "outputTokens"]),
        cache_creation_input_tokens: numberField(usageRecord, [
            "cache_creation_input_tokens",
            "cacheCreationInputTokens",
            "cachedWriteTokens",
        ]),
        cache_read_input_tokens: numberField(usageRecord, [
            "cache_read_input_tokens",
            "cacheReadInputTokens",
            "cachedReadTokens",
        ]),
        thought_tokens: numberField(usageRecord, ["thought_tokens", "thoughtTokens"]),
        total_tokens: numberField(usageRecord, ["total_tokens", "totalTokens"]),
    };
    if (!hasTokenUsageValue(normalized)) {
        return undefined;
    }
    return normalized;
}
function usageToTokenUsage(update) {
    const updateRecord = asRecord(update);
    const usageMeta = asRecord(updateRecord?._meta)?.usage;
    const source = asRecord(usageMeta) ?? updateRecord;
    if (!source) {
        return undefined;
    }
    return sourceToTokenUsage(source);
}
function hasTokenUsageValue(usage) {
    return Object.values(usage).some((value) => value !== undefined);
}
function usageCost(update) {
    const cost = asRecord(asRecord(update)?.cost);
    if (!cost) {
        return undefined;
    }
    return buildUsageCost(numberField(cost, ["amount"]), stringField(cost.currency));
}
function stringField(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function buildUsageCost(amount, currency) {
    const cost = {
        ...(amount !== undefined ? { amount } : {}),
        ...(currency !== undefined ? { currency } : {}),
    };
    return Object.keys(cost).length > 0 ? cost : undefined;
}
function ensureAcpxState(state) {
    return state ?? {};
}
function lastUserMessageId(conversation) {
    for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
        const message = conversation.messages[index];
        if (message && isUserMessage(message)) {
            return message.User.id;
        }
    }
    return undefined;
}
export function createSessionConversation(timestamp = isoNow()) {
    return {
        title: null,
        messages: [],
        updated_at: timestamp,
        cumulative_token_usage: {},
        cumulative_cost: undefined,
        request_token_usage: {},
    };
}
export function cloneSessionConversation(conversation) {
    if (!conversation) {
        return createSessionConversation();
    }
    return {
        title: conversation.title,
        messages: deepClone(conversation.messages ?? []),
        updated_at: conversation.updated_at,
        cumulative_token_usage: deepClone(conversation.cumulative_token_usage ?? {}),
        cumulative_cost: cloneUsageCost(conversation.cumulative_cost),
        request_token_usage: deepClone(conversation.request_token_usage ?? {}),
    };
}
function cloneUsageCost(cost) {
    return cost ? { ...cost } : undefined;
}
export function cloneSessionAcpxState(state) {
    if (!state) {
        return undefined;
    }
    return {
        current_mode_id: state.current_mode_id,
        desired_mode_id: state.desired_mode_id,
        desired_config_options: state.desired_config_options
            ? { ...state.desired_config_options }
            : undefined,
        current_model_id: state.current_model_id,
        available_models: state.available_models ? [...state.available_models] : undefined,
        model_control: state.model_control,
        available_commands: state.available_commands
            ? state.available_commands.map((command) => ({ ...command }))
            : undefined,
        config_options: state.config_options ? deepClone(state.config_options) : undefined,
        session_options: cloneSessionOptions(state.session_options),
    };
}
function cloneSessionOptions(options) {
    if (!options) {
        return undefined;
    }
    return {
        model: options.model,
        allowed_tools: options.allowed_tools ? [...options.allowed_tools] : undefined,
        max_turns: options.max_turns,
        ...(options.system_prompt !== undefined
            ? { system_prompt: cloneSystemPromptOption(options.system_prompt) }
            : {}),
        ...(options.env !== undefined ? { env: { ...options.env } } : {}),
    };
}
function cloneSystemPromptOption(option) {
    return typeof option === "string" ? option : { append: option.append };
}
export function appendLegacyHistory(conversation, entries) {
    for (const entry of entries) {
        const text = entry.textPreview?.trim();
        if (!text) {
            continue;
        }
        if (entry.role === "user") {
            conversation.messages.push({
                User: {
                    id: nextUserMessageId(),
                    content: [{ Text: text }],
                },
            });
        }
        else {
            conversation.messages.push({
                Agent: {
                    content: [{ Text: text }],
                    tool_results: {},
                },
            });
        }
        updateConversationTimestamp(conversation, entry.timestamp || conversation.updated_at);
    }
}
export function recordPromptSubmission(conversation, prompt, timestamp = isoNow()) {
    const normalizedPrompt = typeof prompt === "string" ? textPrompt(prompt) : prompt;
    const userContent = normalizedPrompt
        .map((content) => contentToUserContent(content))
        .filter((content) => content !== undefined);
    if (userContent.length === 0) {
        return undefined;
    }
    const promptMessageId = nextUserMessageId();
    conversation.messages.push({
        User: {
            id: promptMessageId,
            content: userContent.map((content) => {
                if ("Text" in content) {
                    return {
                        Text: trimRuntimeText(content.Text, MAX_RUNTIME_AGENT_TEXT_CHARS),
                    };
                }
                return content;
            }),
        },
    });
    updateConversationTimestamp(conversation, timestamp);
    trimConversationForRuntime(conversation);
    return promptMessageId;
}
function agentMessageHasObservedReply(message) {
    return message.content.length > 0 || Object.keys(message.tool_results).length > 0;
}
export function hasAgentReplyAfterPrompt(conversation, promptMessageId) {
    let sawPrompt = false;
    for (const message of conversation.messages) {
        if (!sawPrompt) {
            if (isUserMessage(message) && message.User.id === promptMessageId) {
                sawPrompt = true;
            }
            continue;
        }
        if (isAgentMessage(message) && agentMessageHasObservedReply(message.Agent)) {
            return true;
        }
    }
    return false;
}
export function recordSessionUpdate(conversation, state, notification, timestamp = isoNow()) {
    const acpx = ensureAcpxState(state);
    const update = notification.update;
    applySessionUpdate(conversation, acpx, update);
    updateConversationTimestamp(conversation, timestamp);
    trimConversationForRuntime(conversation);
    return acpx;
}
export function recordPromptResponseUsage(conversation, usage, promptMessageId, timestamp = isoNow()) {
    const tokenUsage = sourceToTokenUsage(usage);
    if (!tokenUsage) {
        return false;
    }
    applyTokenUsage(conversation, tokenUsage, promptMessageId);
    updateConversationTimestamp(conversation, timestamp);
    trimConversationForRuntime(conversation);
    return true;
}
function applySessionUpdate(conversation, acpx, update) {
    const handler = SESSION_UPDATE_HANDLERS[update.sessionUpdate];
    handler?.(conversation, acpx, update);
}
const SESSION_UPDATE_HANDLERS = {
    user_message_chunk: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "user_message_chunk") {
            appendUserMessageChunk(conversation, update.content);
        }
    },
    agent_message_chunk: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "agent_message_chunk") {
            appendAgentMessageChunk(conversation, update.content, appendAgentText);
        }
    },
    agent_thought_chunk: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "agent_thought_chunk") {
            appendAgentMessageChunk(conversation, update.content, appendAgentThinking);
        }
    },
    tool_call: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
            applyToolCallUpdate(ensureAgentMessage(conversation), update);
        }
    },
    tool_call_update: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
            applyToolCallUpdate(ensureAgentMessage(conversation), update);
        }
    },
    usage_update: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "usage_update") {
            applyUsageUpdate(conversation, update);
        }
    },
    session_info_update: (conversation, _acpx, update) => {
        if (update.sessionUpdate === "session_info_update") {
            applySessionInfoUpdate(conversation, update);
        }
    },
    available_commands_update: (_conversation, acpx, update) => {
        if (update.sessionUpdate === "available_commands_update") {
            acpx.available_commands = update.availableCommands
                .map((entry) => normalizeAvailableCommand(entry))
                .filter((entry) => entry !== undefined);
        }
    },
    current_mode_update: (_conversation, acpx, update) => {
        if (update.sessionUpdate === "current_mode_update") {
            acpx.current_mode_id = update.currentModeId;
        }
    },
    config_option_update: (_conversation, acpx, update) => {
        if (update.sessionUpdate === "config_option_update") {
            const configOptions = deepClone(update.configOptions);
            applyConfigOptionsModelState(acpx, configOptions);
        }
    },
};
function appendUserMessageChunk(conversation, content) {
    const userContent = contentToUserContent(content);
    if (!userContent) {
        return;
    }
    conversation.messages.push({
        User: {
            id: nextUserMessageId(),
            content: [userContent],
        },
    });
}
function appendAgentMessageChunk(conversation, content, append) {
    const text = extractText(content);
    if (text) {
        append(ensureAgentMessage(conversation), text);
    }
}
function applyUsageUpdate(conversation, update) {
    const usage = usageToTokenUsage(update);
    const cost = usageCost(update);
    if (!usage && !cost) {
        return;
    }
    if (usage) {
        applyTokenUsage(conversation, usage);
    }
    if (cost) {
        conversation.cumulative_cost = cost;
    }
}
function applyTokenUsage(conversation, usage, promptMessageId) {
    conversation.cumulative_token_usage = usage;
    const userId = promptMessageId ?? lastUserMessageId(conversation);
    if (userId) {
        conversation.request_token_usage[userId] = usage;
    }
}
function applySessionInfoUpdate(conversation, update) {
    if (hasOwn(update, "title")) {
        conversation.title = update.title ?? null;
    }
    if (hasOwn(update, "updatedAt")) {
        conversation.updated_at = update.updatedAt ?? conversation.updated_at;
    }
}
export function recordClientOperation(conversation, state, operation, timestamp = isoNow()) {
    const acpx = ensureAcpxState(state);
    updateConversationTimestamp(conversation, timestamp);
    trimConversationForRuntime(conversation);
    return acpx;
}
export function trimConversationForRuntime(conversation) {
    if (conversation.messages.length > MAX_RUNTIME_MESSAGES) {
        conversation.messages = conversation.messages.slice(-MAX_RUNTIME_MESSAGES);
    }
    for (const message of conversation.messages) {
        trimRuntimeMessage(message);
    }
    const requestUsageEntries = Object.entries(conversation.request_token_usage);
    if (requestUsageEntries.length > MAX_RUNTIME_REQUEST_TOKEN_USAGE) {
        conversation.request_token_usage = Object.fromEntries(requestUsageEntries.slice(-MAX_RUNTIME_REQUEST_TOKEN_USAGE));
    }
}
function trimRuntimeMessage(message) {
    if (isUserMessage(message)) {
        trimRuntimeUserMessage(message.User);
        return;
    }
    if (isAgentMessage(message)) {
        trimRuntimeAgentMessage(message.Agent);
    }
}
function trimRuntimeUserMessage(message) {
    message.content = message.content.map((content) => {
        if ("Text" in content) {
            return {
                Text: trimRuntimeText(content.Text, MAX_RUNTIME_AGENT_TEXT_CHARS),
            };
        }
        return content;
    });
}
function trimRuntimeAgentMessage(message) {
    for (const content of message.content) {
        trimRuntimeAgentContent(content);
    }
    for (const result of Object.values(message.tool_results)) {
        trimRuntimeToolResult(result);
    }
}
function trimRuntimeAgentContent(content) {
    if ("Text" in content) {
        content.Text = trimRuntimeText(content.Text, MAX_RUNTIME_AGENT_TEXT_CHARS);
    }
    else if ("Thinking" in content) {
        content.Thinking.text = trimRuntimeText(content.Thinking.text, MAX_RUNTIME_THINKING_CHARS);
    }
    else if ("ToolUse" in content) {
        content.ToolUse.raw_input = trimRuntimeText(content.ToolUse.raw_input, MAX_RUNTIME_TOOL_IO_CHARS);
    }
}
function trimRuntimeToolResult(result) {
    if ("Text" in result.content) {
        result.content.Text = trimRuntimeText(result.content.Text, MAX_RUNTIME_TOOL_IO_CHARS);
    }
    if (typeof result.output === "string") {
        result.output = trimRuntimeText(result.output, MAX_RUNTIME_TOOL_IO_CHARS);
    }
}
