import { AcpClient } from "../../acp/client.js";
import type { AcpRuntimeOptions } from "./contract.js";
export type RuntimeHealthReport = {
    ok: boolean;
    message: string;
    details?: string[];
};
export type ProbeRuntimeDeps = {
    clientFactory?: (options: ConstructorParameters<typeof AcpClient>[0]) => AcpClient;
};
export declare function formatRuntimeDetail(value: unknown): string;
export declare function normalizeRuntimeDetails(details: readonly unknown[] | undefined): string[] | undefined;
export declare function probeRuntime(options: AcpRuntimeOptions, deps?: ProbeRuntimeDeps): Promise<RuntimeHealthReport>;
