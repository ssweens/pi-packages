import type { SessionRecord } from "../../types.js";
export declare function shouldReuseExistingRecord(record: Pick<SessionRecord, "cwd" | "agentCommand" | "acpSessionId" | "acpx">, params: {
    cwd: string;
    agentCommand: string;
    resumeSessionId?: string;
}): boolean;
