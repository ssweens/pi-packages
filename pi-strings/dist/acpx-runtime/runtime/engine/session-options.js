export function mergeSessionOptions(preferred, fallback) {
    const merged = { ...fallback };
    assignDefinedOption(merged, "model", preferred?.model);
    assignDefinedOption(merged, "allowedTools", preferred?.allowedTools);
    assignDefinedOption(merged, "maxTurns", preferred?.maxTurns);
    assignDefinedOption(merged, "systemPrompt", preferred?.systemPrompt);
    assignDefinedOption(merged, "env", mergeEnvRecords(fallback?.env, preferred?.env));
    return Object.keys(merged).length > 0 ? merged : undefined;
}
function mergeEnvRecords(fallback, preferred) {
    if (!fallback && !preferred) {
        return undefined;
    }
    return { ...fallback, ...preferred };
}
function assignDefinedOption(target, key, value) {
    if (value !== undefined) {
        target[key] = value;
    }
}
export function persistSessionOptions(record, options) {
    const next = options === undefined ? undefined : persistedSessionOptions(options);
    if (next !== undefined) {
        record.acpx = {
            ...record.acpx,
            session_options: next,
        };
        return;
    }
    if (!record.acpx) {
        return;
    }
    delete record.acpx.session_options;
}
export function sessionOptionsFromRecord(record) {
    const stored = record.acpx?.session_options;
    if (!stored) {
        return undefined;
    }
    const sessionOptions = {};
    assignStoredOption(sessionOptions, "model", nonEmptyString(stored.model));
    assignStoredOption(sessionOptions, "allowedTools", storedAllowedTools(stored.allowed_tools));
    assignStoredOption(sessionOptions, "maxTurns", storedMaxTurns(stored.max_turns));
    assignStoredOption(sessionOptions, "systemPrompt", storedSystemPromptOption(stored.system_prompt));
    assignStoredOption(sessionOptions, "env", storedEnvRecord(stored.env));
    return Object.keys(sessionOptions).length > 0 ? sessionOptions : undefined;
}
function persistedSessionOptions(options) {
    const next = {
        model: nonEmptyString(options.model),
        allowed_tools: Array.isArray(options.allowedTools) ? [...options.allowedTools] : undefined,
        max_turns: typeof options.maxTurns === "number" ? options.maxTurns : undefined,
        system_prompt: normalizeSystemPromptOption(options.systemPrompt),
        env: storedEnvRecord(options.env),
    };
    return hasPersistedSessionOptions(next) ? next : undefined;
}
function hasPersistedSessionOptions(options) {
    return (options.model !== undefined ||
        options.allowed_tools !== undefined ||
        options.max_turns !== undefined ||
        options.system_prompt !== undefined ||
        options.env !== undefined);
}
function storedEnvRecord(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const entries = Object.entries(value);
    const result = {};
    for (const [key, raw] of entries) {
        if (typeof raw !== "string") {
            continue;
        }
        result[key] = raw;
    }
    return Object.keys(result).length > 0 ? result : undefined;
}
function normalizeSystemPromptOption(value) {
    const prompt = nonEmptyString(value);
    if (prompt !== undefined) {
        return prompt;
    }
    const append = appendedSystemPrompt(value);
    return append === undefined ? undefined : { append };
}
function appendedSystemPrompt(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return undefined;
    }
    return nonEmptyString(value.append);
}
function assignStoredOption(target, key, value) {
    assignDefinedOption(target, key, value);
}
function storedAllowedTools(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
        ? [...value]
        : undefined;
}
function storedMaxTurns(value) {
    return typeof value === "number" ? value : undefined;
}
function storedSystemPromptOption(value) {
    return normalizeSystemPromptOption(value);
}
function nonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
