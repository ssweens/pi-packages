import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Coordinator } from "./orchestration/coordinator.js";

const Params = Type.Object({
  action: Type.Union([Type.Literal("spawn"), Type.Literal("send"), Type.Literal("steer"), Type.Literal("wait"), Type.Literal("result"), Type.Literal("list"), Type.Literal("questions"), Type.Literal("reply"), Type.Literal("cancel"), Type.Literal("close")]),
  name: Type.Optional(Type.String()),
  profile: Type.Optional(Type.String()),
  cwd: Type.Optional(Type.String()),
  resumeSessionId: Type.Optional(Type.String()),
  prompt: Type.Optional(Type.String()),
  answer: Type.Optional(Type.String()),
  questionId: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  requestId: Type.Optional(Type.String()),
  predecessorRequestId: Type.Optional(Type.String()),
  names: Type.Optional(Type.Array(Type.String())),
  all: Type.Optional(Type.Boolean()),
  mode: Type.Optional(Type.Union([Type.Literal("any"), Type.Literal("all")])),
  reason: Type.Optional(Type.String()),
  force: Type.Optional(Type.Boolean()),
  discardPersistentState: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export default function piStrings(pi: ExtensionAPI): void {
  if (process.env.PI_STRINGS_WORKER === "1") return;
  const coordinator = new Coordinator(process.cwd());
  pi.on("session_shutdown", async () => {
    await coordinator.shutdown();
  });
  pi.registerTool({
    name: "strings",
    label: "Strings",
    description: "Coordinate named ACP coding-agent workers. Actions: spawn, send, steer, wait, result, list, questions, reply, cancel, close. Steering and questions require an adapter capability acknowledgement; the parent remains the sole orchestrator.",
    parameters: Params,
    execute: async (_toolCallId, params) => {
      const response = await coordinator.execute(params as Record<string, unknown> & { action: string });
      return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], details: response };
    },
  });
}
