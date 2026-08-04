import type { PromptInput, RunPromptResult, SessionConversation } from "../../types.js";
type PromptTurnClient = {
    prompt: (sessionId: string, prompt: PromptInput | string) => Promise<{
        stopReason: RunPromptResult["stopReason"];
        usage?: unknown;
    }>;
    waitForSessionUpdatesIdle?: (options?: {
        idleMs?: number;
        timeoutMs?: number;
    }) => Promise<void>;
};
export declare function runPromptTurn(params: {
    client: PromptTurnClient;
    sessionId: string;
    prompt: PromptInput | string;
    timeoutMs?: number;
    conversation: SessionConversation;
    promptMessageId?: string;
    onPromptStarted?: () => Promise<void> | void;
}): Promise<{
    stopReason: RunPromptResult["stopReason"];
    source: "rpc" | "session";
}>;
export {};
