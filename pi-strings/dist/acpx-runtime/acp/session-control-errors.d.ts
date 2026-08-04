export declare function formatSessionControlAcpSummary(acp: {
    code: number;
    message: string;
    data?: unknown;
}): string;
export declare function maybeWrapSessionControlError(method: "session/set_mode" | "session/set_model" | "session/set_config_option", error: unknown, context?: string): unknown;
