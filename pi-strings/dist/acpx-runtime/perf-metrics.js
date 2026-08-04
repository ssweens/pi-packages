const counters = new Map();
const gauges = new Map();
const timings = new Map();
function hrNow() {
    return process.hrtime.bigint();
}
function durationMs(start) {
    return Number(process.hrtime.bigint() - start) / 1_000_000;
}
function roundMetric(value) {
    return Number(value.toFixed(3));
}
export function incrementPerfCounter(name, delta = 1) {
    counters.set(name, (counters.get(name) ?? 0) + delta);
}
export function setPerfGauge(name, value) {
    gauges.set(name, value);
}
export function recordPerfDuration(name, durationMsValue) {
    const next = timings.get(name) ?? {
        count: 0,
        totalMs: 0,
        maxMs: 0,
    };
    next.count += 1;
    next.totalMs += durationMsValue;
    next.maxMs = Math.max(next.maxMs, durationMsValue);
    timings.set(name, next);
}
export async function measurePerf(name, run) {
    const startedAt = hrNow();
    try {
        return await run();
    }
    finally {
        recordPerfDuration(name, durationMs(startedAt));
    }
}
export function startPerfTimer(name) {
    const startedAt = hrNow();
    return () => {
        const elapsedMs = durationMs(startedAt);
        recordPerfDuration(name, elapsedMs);
        return elapsedMs;
    };
}
export function getPerfMetricsSnapshot() {
    return {
        counters: Object.fromEntries(counters.entries()),
        gauges: Object.fromEntries(gauges.entries()),
        timings: Object.fromEntries([...timings.entries()].map(([name, bucket]) => [
            name,
            {
                count: bucket.count,
                totalMs: roundMetric(bucket.totalMs),
                maxMs: roundMetric(bucket.maxMs),
            },
        ])),
    };
}
export function resetPerfMetrics() {
    counters.clear();
    gauges.clear();
    timings.clear();
}
export function formatPerfMetric(name, durationMsValue) {
    return `${name}=${roundMetric(durationMsValue)}ms`;
}
