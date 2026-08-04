import type { AgentCapabilities, ContentBlock } from "@agentclientprotocol/sdk";
export type PromptInput = ContentBlock[];
export declare class PromptInputValidationError extends Error {
    constructor(message: string);
}
export declare function isPromptInput(value: unknown): value is PromptInput;
export declare function getUnsupportedPromptContentMessage(prompt: PromptInput, agentCapabilities: AgentCapabilities | undefined): string | undefined;
export declare function textPrompt(text: string): PromptInput;
export declare function parsePromptSource(source: string): PromptInput;
export declare function mergePromptSourceWithText(source: string, suffixText: string): PromptInput;
export declare function promptToDisplayText(prompt: PromptInput): string;
