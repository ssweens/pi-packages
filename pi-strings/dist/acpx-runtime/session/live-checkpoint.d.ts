export type LiveSessionCheckpointOptions = {
    save: () => Promise<void>;
    intervalMs?: number;
    onError?: (error: unknown) => void;
};
export declare class LiveSessionCheckpoint {
    private readonly save;
    private readonly intervalMs;
    private readonly onError;
    private dirty;
    private flushing;
    private timer;
    constructor(options: LiveSessionCheckpointOptions);
    request(): void;
    checkpoint(): Promise<void>;
    flush(): Promise<void>;
    private flushDirty;
}
