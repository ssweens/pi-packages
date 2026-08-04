import type { AcpRuntimeHandle } from "./contract.js";
import type { AcpxHandleState } from "./shared.js";
export declare function encodeAcpxRuntimeHandleState(state: AcpxHandleState): string;
export declare function decodeAcpxRuntimeHandleState(runtimeSessionName: string): AcpxHandleState | null;
export declare function writeHandleState(handle: AcpRuntimeHandle, state: AcpxHandleState): void;
