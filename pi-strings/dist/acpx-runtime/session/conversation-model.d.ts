import type { SessionNotification } from "@agentclientprotocol/sdk";
import type { ClientOperation, PromptInput, SessionAcpxState, SessionConversation } from "../types.js";
export type LegacyHistoryEntry = {
    role: "user" | "assistant";
    timestamp: string;
    textPreview: string;
};
export declare function createSessionConversation(timestamp?: string): SessionConversation;
export declare function cloneSessionConversation(conversation: SessionConversation | undefined): SessionConversation;
export declare function cloneSessionAcpxState(state: SessionAcpxState | undefined): SessionAcpxState | undefined;
export declare function appendLegacyHistory(conversation: SessionConversation, entries: LegacyHistoryEntry[]): void;
export declare function recordPromptSubmission(conversation: SessionConversation, prompt: PromptInput | string, timestamp?: string): string | undefined;
export declare function hasAgentReplyAfterPrompt(conversation: SessionConversation, promptMessageId: string): boolean;
export declare function recordSessionUpdate(conversation: SessionConversation, state: SessionAcpxState | undefined, notification: SessionNotification, timestamp?: string): SessionAcpxState;
export declare function recordPromptResponseUsage(conversation: SessionConversation, usage: unknown, promptMessageId?: string, timestamp?: string): boolean;
export declare function recordClientOperation(conversation: SessionConversation, state: SessionAcpxState | undefined, operation: ClientOperation, timestamp?: string): SessionAcpxState;
export declare function trimConversationForRuntime(conversation: SessionConversation): void;
