import type { AgentLifecycleSnapshot } from "../../acp/client.js";
import type { SessionConversation, SessionRecord } from "../../types.js";
export declare function applyLifecycleSnapshotToRecord(record: SessionRecord, snapshot: AgentLifecycleSnapshot | undefined): void;
export declare function reconcileAgentSessionId(record: SessionRecord, agentSessionId: string | undefined): void;
export declare function sessionHasAgentMessages(recordOrConversation: Pick<SessionRecord, "messages"> | SessionConversation): boolean;
export declare function applyConversation(record: SessionRecord, conversation: SessionConversation): void;
