# Lessons

- After changing extension code, reload Pi before validating through the extension's live tools. A fresh-process integration test does not prove that the current session's already-loaded tool instance uses the fix.
- Do not conflate a pi-strings role/profile preset with model selection. Verify and expose ACPX model discovery and per-operation model choice instead of treating an internal profile as the user-facing model control.
- When the user asks for a “subagent,” distinguish pi-subagents from pi-strings workers. If they specify pi-subagents, use the `subagent` tool rather than `op_*`.
- pi-strings presets must not be required to spawn an ACP agent. The public `op_spawn` API should accept an optional agent directly, defaulting to `pi`; presets are optional reusable policy bundles, not mandatory constructors.
- A read-only worker contract means reads are allowed and mutations are denied. Verify ACPX's native `approve-reads` behavior before adding policy code.
- pi-strings is a proxy, not an adapter-specific policy engine. Do not add provider-specific permission callbacks or emulate downstream agent policy; pass through ACPX's native controls and keep the proxy thin.
- Before changing ACPX permission behavior, read the authoritative `openclaw/acpx` permissions documentation, including permission modes, JSON policy precedence, matching syntax, escalation, and non-interactive behavior. Do not infer the contract from type declarations or CLI help alone.
