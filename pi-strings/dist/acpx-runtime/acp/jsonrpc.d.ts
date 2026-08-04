import type { AnyMessage, SessionNotification } from "@agentclientprotocol/sdk";
export declare function isAcpMessageObject(value: unknown): value is AnyMessage;
export declare function isAcpJsonRpcMessage(value: unknown): value is AnyMessage;
export declare function isJsonRpcNotification(message: AnyMessage): boolean;
export declare function isSessionUpdateNotification(message: AnyMessage): boolean;
export declare function extractSessionUpdateNotification(message: AnyMessage): SessionNotification | undefined;
export declare function parsePromptStopReason(message: AnyMessage): string | undefined;
export declare function parseJsonRpcErrorMessage(message: AnyMessage): string | undefined;
