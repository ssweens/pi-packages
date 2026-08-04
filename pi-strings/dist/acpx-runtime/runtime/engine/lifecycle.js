import { normalizeRuntimeSessionId } from "../../session/runtime-session-id.js";
export function applyLifecycleSnapshotToRecord(record, snapshot) {
    if (!snapshot) {
        return;
    }
    record.pid = snapshot.running ? snapshot.pid : undefined;
    record.agentStartedAt = snapshot.startedAt;
    if (snapshot.lastExit) {
        record.lastAgentExitCode = snapshot.lastExit.exitCode;
        record.lastAgentExitSignal = snapshot.lastExit.signal;
        record.lastAgentExitAt = snapshot.lastExit.exitedAt;
        record.lastAgentDisconnectReason = snapshot.lastExit.reason;
        return;
    }
    record.lastAgentExitCode = undefined;
    record.lastAgentExitSignal = undefined;
    record.lastAgentExitAt = undefined;
    record.lastAgentDisconnectReason = undefined;
}
export function reconcileAgentSessionId(record, agentSessionId) {
    const normalized = normalizeRuntimeSessionId(agentSessionId);
    if (!normalized) {
        return;
    }
    record.agentSessionId = normalized;
}
export function sessionHasAgentMessages(recordOrConversation) {
    return recordOrConversation.messages.some((message) => typeof message === "object" && message !== null && "Agent" in message);
}
export function applyConversation(record, conversation) {
    record.title = conversation.title;
    record.updated_at = conversation.updated_at;
    record.messages = conversation.messages;
    record.cumulative_token_usage = conversation.cumulative_token_usage;
    record.cumulative_cost = conversation.cumulative_cost;
    record.request_token_usage = conversation.request_token_usage;
}
