export declare class TimeoutError extends Error {
    constructor(timeoutMs: number);
}
export declare class InterruptedError extends Error {
    constructor();
}
export declare function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T>;
export declare function withInterrupt<T>(run: () => Promise<T>, onInterrupt: () => Promise<void>): Promise<T>;
