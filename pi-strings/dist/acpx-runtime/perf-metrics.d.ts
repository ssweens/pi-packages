import type { PerfMetricsSnapshot } from "./types.js";
export declare function incrementPerfCounter(name: string, delta?: number): void;
export declare function setPerfGauge(name: string, value: number): void;
export declare function recordPerfDuration(name: string, durationMsValue: number): void;
export declare function measurePerf<T>(name: string, run: () => Promise<T>): Promise<T>;
export declare function startPerfTimer(name: string): () => number;
export declare function getPerfMetricsSnapshot(): PerfMetricsSnapshot;
export declare function resetPerfMetrics(): void;
export declare function formatPerfMetric(name: string, durationMsValue: number): string;
