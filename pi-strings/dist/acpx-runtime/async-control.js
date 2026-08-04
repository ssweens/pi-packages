export class TimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Timed out after ${timeoutMs}ms`);
        this.name = "TimeoutError";
    }
}
export class InterruptedError extends Error {
    constructor() {
        super("Interrupted");
        this.name = "InterruptedError";
    }
}
export async function withTimeout(promise, timeoutMs) {
    if (timeoutMs == null || timeoutMs <= 0) {
        return await promise;
    }
    let timer;
    const timeoutPromise = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new TimeoutError(timeoutMs));
        }, timeoutMs);
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    }
    finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
}
export async function withInterrupt(run, onInterrupt) {
    return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (cb) => {
            if (settled) {
                return;
            }
            settled = true;
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigterm);
            process.off("SIGHUP", onSighup);
            cb();
        };
        const rejectInterrupted = () => {
            void onInterrupt().finally(() => {
                finish(() => reject(new InterruptedError()));
            });
        };
        const onSigint = () => {
            rejectInterrupted();
        };
        const onSigterm = () => {
            rejectInterrupted();
        };
        const onSighup = () => {
            rejectInterrupted();
        };
        process.once("SIGINT", onSigint);
        process.once("SIGTERM", onSigterm);
        process.once("SIGHUP", onSighup);
        void run().then((result) => finish(() => resolve(result)), (error) => finish(() => reject(error)));
    });
}
