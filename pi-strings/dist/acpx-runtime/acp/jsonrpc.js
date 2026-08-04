function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value;
}
export function isAcpMessageObject(value) {
    return asRecord(value) !== null;
}
function hasValidId(value) {
    return (value === null ||
        typeof value === "string" ||
        (typeof value === "number" && Number.isFinite(value)));
}
function isErrorObject(value) {
    const record = asRecord(value);
    return (!!record &&
        typeof record.code === "number" &&
        Number.isFinite(record.code) &&
        typeof record.message === "string");
}
function hasResultOrError(value) {
    const hasResult = Object.hasOwn(value, "result");
    const hasError = Object.hasOwn(value, "error");
    if (hasResult && hasError) {
        return false;
    }
    if (!hasResult && !hasError) {
        return false;
    }
    if (hasError && !isErrorObject(value.error)) {
        return false;
    }
    return true;
}
function hasMethod(value) {
    return typeof value.method === "string" && value.method.length > 0;
}
function isJsonRpcRequest(value) {
    return hasMethod(value) && Object.hasOwn(value, "id") && hasValidId(value.id);
}
function isJsonRpcNotificationRecord(value) {
    return hasMethod(value) && !Object.hasOwn(value, "id");
}
function isJsonRpcResponse(value) {
    if (hasMethod(value) || !Object.hasOwn(value, "id") || !hasValidId(value.id)) {
        return false;
    }
    return hasResultOrError(value);
}
export function isAcpJsonRpcMessage(value) {
    const record = asRecord(value);
    if (!record || record.jsonrpc !== "2.0") {
        return false;
    }
    return (isJsonRpcNotificationRecord(record) || isJsonRpcRequest(record) || isJsonRpcResponse(record));
}
export function isJsonRpcNotification(message) {
    return (Object.hasOwn(message, "method") &&
        typeof message.method === "string" &&
        !Object.hasOwn(message, "id"));
}
export function isSessionUpdateNotification(message) {
    return (isJsonRpcNotification(message) && message.method === "session/update");
}
export function extractSessionUpdateNotification(message) {
    if (!isSessionUpdateNotification(message)) {
        return undefined;
    }
    const params = asRecord(message.params);
    if (!params) {
        return undefined;
    }
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    if (!sessionId) {
        return undefined;
    }
    const update = asRecord(params.update);
    if (!update || typeof update.sessionUpdate !== "string") {
        return undefined;
    }
    return {
        sessionId,
        update: update,
    };
}
export function parsePromptStopReason(message) {
    if (!Object.hasOwn(message, "id") || !Object.hasOwn(message, "result")) {
        return undefined;
    }
    const record = asRecord(message.result);
    if (!record) {
        return undefined;
    }
    return typeof record.stopReason === "string" ? record.stopReason : undefined;
}
export function parseJsonRpcErrorMessage(message) {
    if (!Object.hasOwn(message, "error")) {
        return undefined;
    }
    const errorRecord = asRecord(message.error);
    if (!errorRecord || typeof errorRecord.message !== "string") {
        return undefined;
    }
    return errorRecord.message;
}
