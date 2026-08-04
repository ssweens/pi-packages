const DEFAULT_LIVE_CHECKPOINT_INTERVAL_MS = 500;
export class LiveSessionCheckpoint {
    save;
    intervalMs;
    onError;
    dirty = false;
    flushing;
    timer;
    constructor(options) {
        this.save = options.save;
        this.intervalMs = options.intervalMs ?? DEFAULT_LIVE_CHECKPOINT_INTERVAL_MS;
        this.onError = options.onError;
    }
    request() {
        this.dirty = true;
        if (this.timer) {
            return;
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.flush().catch((error) => {
                this.onError?.(error);
            });
        }, this.intervalMs);
        this.timer.unref?.();
    }
    async checkpoint() {
        this.dirty = true;
        await this.flush();
    }
    async flush() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (this.flushing) {
            await this.flushing;
            if (!this.dirty) {
                return;
            }
        }
        this.flushing = this.flushDirty();
        try {
            await this.flushing;
        }
        finally {
            this.flushing = undefined;
        }
    }
    async flushDirty() {
        while (this.dirty) {
            this.dirty = false;
            await this.save();
        }
    }
}
