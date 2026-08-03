# Changelog

## Unreleased

- Add deterministic acceptance coverage for session continuity/reconnect, restart loss, cancel-and-reassign lineage, capability-negotiated steering and terminal races, resume identity checks, permission boundaries, and correlated child questions.
- Add versioned runtime capabilities, correlated Pi question/reply operations, and native acknowledged Pi steering over a dedicated ACP connection; generic acpx steering remains explicitly unsupported.
- Add real-process crash recovery, timeout cancellation before successor work, and bounded SIGTERM-to-SIGKILL cleanup.
- Physically confine writer edits against live, dangling, and intermediate symlink escapes, including OpenCode `write` tool-name normalization.
- Add opt-in prerequisite-gated Pi, Codex, and OpenCode integration/E2E commands; confine Codex writers with macOS `sandbox-exec` and add hosted parent-kill, writer-resume, writer-reassignment, and external ACP question/reply coverage.

## 0.1.0

- Add a Pi-native multi-agent coordinator over the public `acpx/runtime` API.
- Add named, persistent workers with explicit turn IDs, reusable names after close, and lifecycle controls.
- Reject unsafe in-flight steering explicitly until the pinned acpx runtime supports it without opening a second client on the active session.
- Vendor and harden the Pi ACP adapter for bounded RPC, strict framing, durable private state, and honest failure reporting.
- Enforce read-only versus writer isolation policy at worker startup and apply role-correct ACP permission handling.
- Add an operator guide and Pi skill with orchestration recipes and recovery procedures.
