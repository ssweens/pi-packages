import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import { Coordinator } from "./orchestration/coordinator.js";

const NAME_PATTERN = "^[a-z][a-z0-9-]{0,47}$";

interface ToolRegistration {
  name: string;
  label: string;
  description: string;
  parameters: TSchema;
  action: string;
}

export default function piStrings(pi: ExtensionAPI): void {
  if (process.env.PI_STRINGS_WORKER === "1") return;
  const coordinator = new Coordinator(process.cwd());
  pi.on("session_shutdown", async () => {
    await coordinator.shutdown();
  });
  const register = ({ name, label, description, parameters, action }: ToolRegistration) => {
    pi.registerTool({
      name,
      label,
      description,
      parameters,
      execute: async (_toolCallId, params) => {
        const response = await coordinator.execute({ action, ...(params as Record<string, unknown>) } as Record<string, unknown> & { action: string });
        return { content: [{ type: "text", text: JSON.stringify(response, null, 2) }], details: response };
      },
    });
  };

  register({
    name: "op_spawn",
    label: "Spawn worker",
    description: `Create or restore a named worker directly from an ACP agent (agent defaults to pi) or from an optional reusable profile. The name must match ${NAME_PATTERN}; one live writer per canonical cwd is enforced; worktree profiles must target a linked worktree via cwd; resumeSessionId restores only when agent, role, profile, and cwd match the original session. Direct workers default to safe read-only tools; optional model is validated against live ACPX discovery before admission.`,
    parameters: Type.Object({
      name: Type.String(),
      profile: Type.Optional(Type.String()),
      agent: Type.Optional(Type.String()),
      role: Type.Optional(Type.Union([Type.Literal("read-only"), Type.Literal("writer")])),
      tools: Type.Optional(Type.Array(Type.String())),
      cwd: Type.Optional(Type.String()),
      resumeSessionId: Type.Optional(Type.String()),
      model: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    action: "spawn",
  });
  register({
    name: "op_status",
    label: "Worker model status",
    description: "Discover the current and available model IDs for a live worker through ACPX getStatus. Discovery must be advertised by the runtime; unsupported discovery is an explicit error.",
    parameters: Type.Object({
      name: Type.String(),
    }, { additionalProperties: false }),
    action: "status",
  });
  register({
    name: "op_send",
    label: "Send turn",
    description: `Start one turn on a worker. The prompt is decorated with the worker's role and acceptance contracts; the appended decoration is returned as decoratedPromptSuffix. An optional model is discovered and selected before this turn; unavailable or unsupported models fail explicitly. Returns status "running" plus a requestId; do not send again until the request is terminal (use op_wait). requestTimeoutMs bounds the entire request (default: the profile's timeoutMs). predecessorRequestId reassigns from a cancelled, failed, or timed-out request whose worker has been closed.`,
    parameters: Type.Object({
      name: Type.String(),
      prompt: Type.String(),
      model: Type.Optional(Type.String()),
      requestTimeoutMs: Type.Optional(Type.Number()),
      predecessorRequestId: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    action: "send",
  });
  register({
    name: "op_wait",
    label: "Wait for turns",
    description: "Wait on a fixed snapshot; select exactly one of requestId, names, or all=true. mode \"any\" resolves on the first terminal request and returns only the terminal requests; mode \"all\" (default) waits for all selected requests. waitTimeoutMs bounds the call (default 300000); a timeout returns timedOut:true and never cancels work.",
    parameters: Type.Object({
      requestId: Type.Optional(Type.String()),
      names: Type.Optional(Type.Array(Type.String())),
      all: Type.Optional(Type.Boolean()),
      mode: Type.Optional(Type.Union([Type.Literal("any"), Type.Literal("all")])),
      waitTimeoutMs: Type.Optional(Type.Number()),
    }, { additionalProperties: false }),
    action: "wait",
  });
  register({
    name: "op_result",
    label: "Get request result",
    description: "Get the authoritative record for a request. Output is capped at the profile's maxOutputBytes with a truncated flag when the bound was hit.",
    parameters: Type.Object({
      requestId: Type.String(),
    }, { additionalProperties: false }),
    action: "result",
  });
  register({
    name: "op_list",
    label: "List workers and requests",
    description: "List live workers and their requests. The optional names projection narrows the result to specific live workers; unknown names are an error.",
    parameters: Type.Object({
      names: Type.Optional(Type.Array(Type.String())),
    }, { additionalProperties: false }),
    action: "list",
  });
  register({
    name: "op_cancel",
    label: "Cancel turn",
    description: "Cooperatively cancel a worker's active turn, passing reason to the worker. If the cancellation grace expires, the runtime is closed and the request is terminalized as cancelled.",
    parameters: Type.Object({
      name: Type.String(),
      reason: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    action: "cancel",
  });
  register({
    name: "op_close",
    label: "Close worker",
    description: "Close a worker and its session. discardPersistentState:true prevents later resume; force:true closes an active worker; a failed close leaves a persisted failed worker so cleanup can be retried.",
    parameters: Type.Object({
      name: Type.String(),
      force: Type.Optional(Type.Boolean()),
      discardPersistentState: Type.Optional(Type.Boolean()),
    }, { additionalProperties: false }),
    action: "close",
  });
}
