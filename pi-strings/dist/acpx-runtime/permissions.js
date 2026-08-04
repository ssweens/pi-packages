import { PermissionPromptUnavailableError } from "./errors.js";
import { promptForPermission } from "./permission-prompt.js";
const PERMISSION_MODE_RANK = {
    "deny-all": 0,
    "approve-reads": 1,
    "approve-all": 2,
};
function selected(optionId) {
    return { outcome: { outcome: "selected", optionId } };
}
function cancelled() {
    return { outcome: { outcome: "cancelled" } };
}
function withEscalationMetadata(response, event) {
    return {
        ...response,
        _meta: {
            ...response._meta,
            acpx: {
                ...(response._meta?.acpx &&
                    typeof response._meta.acpx === "object" &&
                    !Array.isArray(response._meta.acpx)
                    ? response._meta.acpx
                    : {}),
                permissionEscalation: event,
            },
        },
    };
}
function pickOption(options, kinds) {
    for (const kind of kinds) {
        const match = options.find((option) => option.kind === kind);
        if (match) {
            return match;
        }
    }
    return undefined;
}
const TOOL_KIND_TITLE_MATCHERS = [
    { kind: "read", needles: ["read", "cat"] },
    { kind: "search", needles: ["search", "find", "grep"] },
    { kind: "edit", needles: ["write", "edit", "patch"] },
    { kind: "delete", needles: ["delete", "remove"] },
    { kind: "move", needles: ["move", "rename"] },
    { kind: "execute", needles: ["run", "execute", "bash"] },
    { kind: "fetch", needles: ["fetch", "http", "url"] },
    { kind: "think", needles: ["think"] },
];
export function inferToolKind(params) {
    if (params.toolCall.kind) {
        return params.toolCall.kind;
    }
    const title = params.toolCall.title?.trim().toLowerCase();
    if (!title) {
        return undefined;
    }
    const head = title.split(":", 1)[0]?.trim();
    if (!head) {
        return undefined;
    }
    return titleHeadToolKind(head) ?? "other";
}
function titleHeadToolKind(head) {
    return TOOL_KIND_TITLE_MATCHERS.find(({ needles }) => needles.some((needle) => head.includes(needle)))?.kind;
}
function isAutoApprovedReadKind(kind) {
    return kind === "read" || kind === "search";
}
async function promptForToolPermission(params) {
    const toolName = params.toolCall.title ?? "tool";
    const toolKind = inferToolKind(params) ?? "other";
    return await promptForPermission({
        prompt: `\n[permission] Allow ${toolName} [${toolKind}]? (y/N) `,
    });
}
function canPromptForPermission() {
    return process.stdin.isTTY && process.stderr.isTTY;
}
function readStringProperty(value, keys) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const record = value;
    for (const key of keys) {
        const entry = record[key];
        if (typeof entry === "string" && entry.trim().length > 0) {
            return entry.trim();
        }
    }
    return undefined;
}
function readToolName(params) {
    const rawInputName = readStringProperty(params.toolCall.rawInput, ["name", "tool", "toolName"]);
    if (rawInputName) {
        return rawInputName;
    }
    const title = params.toolCall.title?.trim();
    const head = title?.split(/[:\s]/, 1)[0]?.trim();
    return head && head.length > 0 ? head : undefined;
}
function normalizeMatcher(value) {
    return value.trim().toLowerCase();
}
function permissionMatchTokens(params) {
    const tokens = new Set();
    const kind = inferToolKind(params);
    const rawKind = params.toolCall.kind;
    const title = params.toolCall.title?.trim();
    const toolName = readToolName(params);
    for (const value of [kind, rawKind, title, toolName]) {
        if (typeof value === "string" && value.trim().length > 0) {
            tokens.add(normalizeMatcher(value));
        }
    }
    if (title) {
        const head = title.split(/[:\s]/, 1)[0]?.trim();
        if (head) {
            tokens.add(normalizeMatcher(head));
        }
    }
    return [...tokens];
}
function findPolicyRule(rules, params) {
    if (!rules || rules.length === 0) {
        return undefined;
    }
    const tokens = permissionMatchTokens(params);
    for (const rule of rules) {
        const normalized = normalizeMatcher(rule);
        if (normalized === "*" || tokens.includes(normalized)) {
            return rule;
        }
    }
    return undefined;
}
function matchPermissionPolicy(params, policy) {
    if (!policy) {
        return undefined;
    }
    const denyRule = findPolicyRule(policy.autoDeny, params);
    if (denyRule) {
        return { action: "deny", matchedRule: denyRule };
    }
    const approveRule = findPolicyRule(policy.autoApprove, params);
    if (approveRule) {
        return { action: "approve", matchedRule: approveRule };
    }
    const escalateRule = findPolicyRule(policy.escalate, params);
    if (escalateRule) {
        return { action: "escalate", matchedRule: escalateRule };
    }
    return policy.defaultAction ? { action: policy.defaultAction } : undefined;
}
function buildEscalationEvent(params, matchedRule) {
    const toolKind = inferToolKind(params);
    const toolTitle = params.toolCall.title?.trim() || "tool";
    const toolName = readToolName(params);
    return {
        type: "permission_escalation",
        sessionId: params.sessionId,
        toolCallId: params.toolCall.toolCallId,
        ...(toolName ? { toolName } : {}),
        toolTitle,
        ...(params.toolCall.rawInput !== undefined ? { toolInput: params.toolCall.rawInput } : {}),
        ...(toolKind ? { toolKind } : {}),
        action: "escalate",
        ...(matchedRule ? { matchedRule } : {}),
        message: `Permission escalation required for ${toolTitle}`,
        timestamp: new Date().toISOString(),
    };
}
function selectedOrFirst(options, allowOption) {
    return { response: selected((allowOption ?? options[0]).optionId) };
}
function selectedOrCancelled(option) {
    return { response: option ? selected(option.optionId) : cancelled() };
}
async function resolveEscalatingPermissionRequest(params, policyMatch, allowOption, rejectOption) {
    if (canPromptForPermission()) {
        return resolveInteractivePromptResult(params, allowOption, rejectOption);
    }
    const escalation = buildEscalationEvent(params, policyMatch.matchedRule);
    const response = rejectOption ? selected(rejectOption.optionId) : cancelled();
    return {
        response: withEscalationMetadata(response, escalation),
        escalation,
    };
}
async function resolveInteractivePromptResult(params, allowOption, rejectOption) {
    const approved = await promptForToolPermission(params);
    if (approved && allowOption) {
        return { response: selected(allowOption.optionId) };
    }
    if (!approved && rejectOption) {
        return { response: selected(rejectOption.optionId) };
    }
    return { response: cancelled() };
}
function resolvePolicyMatch(params, policyMatch, options, allowOption, rejectOption) {
    if (policyMatch?.action === "approve") {
        return selectedOrFirst(options, allowOption);
    }
    if (policyMatch?.action === "deny") {
        return selectedOrCancelled(rejectOption);
    }
    if (policyMatch?.action === "escalate") {
        return resolveEscalatingPermissionRequest(params, policyMatch, allowOption, rejectOption);
    }
    return undefined;
}
function resolveModeMatch(options, mode, allowOption, rejectOption) {
    if (mode === "approve-all") {
        return selectedOrFirst(options, allowOption);
    }
    if (mode === "deny-all") {
        return selectedOrCancelled(rejectOption);
    }
    return undefined;
}
function resolveNonInteractivePermission(nonInteractivePolicy, rejectOption) {
    if (nonInteractivePolicy === "fail") {
        throw new PermissionPromptUnavailableError();
    }
    return selectedOrCancelled(rejectOption);
}
async function resolveReadOrPromptPermission(params, nonInteractivePolicy, allowOption, rejectOption) {
    const kind = inferToolKind(params);
    if (isAutoApprovedReadKind(kind) && allowOption) {
        return { response: selected(allowOption.optionId) };
    }
    if (!canPromptForPermission()) {
        return resolveNonInteractivePermission(nonInteractivePolicy, rejectOption);
    }
    return resolveInteractivePromptResult(params, allowOption, rejectOption);
}
export function permissionModeSatisfies(actual, required) {
    return PERMISSION_MODE_RANK[actual] >= PERMISSION_MODE_RANK[required];
}
export async function resolvePermissionRequest(params, mode, nonInteractivePolicy = "deny", policy) {
    const result = await resolvePermissionRequestWithDetails(params, mode, nonInteractivePolicy, policy);
    return result.response;
}
export async function resolvePermissionRequestWithDetails(params, mode, nonInteractivePolicy = "deny", policy) {
    const options = params.options ?? [];
    if (options.length === 0) {
        return { response: cancelled() };
    }
    const allowOption = pickOption(options, ["allow_once", "allow_always"]);
    const rejectOption = pickOption(options, ["reject_once", "reject_always"]);
    const policyMatch = matchPermissionPolicy(params, policy);
    const resolvedByPolicy = await resolvePolicyMatch(params, policyMatch, options, allowOption, rejectOption);
    if (resolvedByPolicy) {
        return resolvedByPolicy;
    }
    const resolvedByMode = resolveModeMatch(options, mode, allowOption, rejectOption);
    if (resolvedByMode) {
        return resolvedByMode;
    }
    return resolveReadOrPromptPermission(params, nonInteractivePolicy, allowOption, rejectOption);
}
const DECISION_FALLBACK_ORDER = {
    allow_once: ["allow_once", "allow_always"],
    allow_always: ["allow_always", "allow_once"],
    reject_once: ["reject_once", "reject_always"],
    reject_always: ["reject_always", "reject_once"],
};
export function decisionToResponse(params, decision) {
    if (decision.outcome === "cancel") {
        return cancelled();
    }
    const matched = pickOption(params.options ?? [], DECISION_FALLBACK_ORDER[decision.outcome]);
    return matched ? selected(matched.optionId) : cancelled();
}
export function classifyPermissionDecision(params, response) {
    if (response.outcome.outcome !== "selected") {
        return "cancelled";
    }
    const selectedOptionId = response.outcome.optionId;
    const selectedOption = params.options.find((option) => option.optionId === selectedOptionId);
    if (!selectedOption) {
        return "cancelled";
    }
    if (selectedOption.kind === "allow_once" || selectedOption.kind === "allow_always") {
        return "approved";
    }
    return "denied";
}
