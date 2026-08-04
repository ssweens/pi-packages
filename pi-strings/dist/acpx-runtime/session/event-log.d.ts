import type { SessionEventLog } from "../types.js";
export declare const DEFAULT_EVENT_SEGMENT_MAX_BYTES: number;
export declare const DEFAULT_EVENT_MAX_SEGMENTS = 5;
export declare function sessionBaseDir(): string;
export declare function safeSessionId(sessionId: string): string;
export declare function sessionEventActivePath(sessionId: string): string;
export declare function sessionEventSegmentPath(sessionId: string, segment: number): string;
export declare function sessionEventLockPath(sessionId: string): string;
export declare function defaultSessionEventLog(sessionId: string): SessionEventLog;
