import type { OutputErrorAcpPayload } from "../types.js";
export declare function toAcpErrorPayload(value: unknown): OutputErrorAcpPayload | undefined;
export declare function formatUnknownErrorMessage(error: unknown): string;
export declare function extractAcpError(error: unknown): OutputErrorAcpPayload | undefined;
export declare function isAcpResourceNotFoundError(error: unknown): boolean;
