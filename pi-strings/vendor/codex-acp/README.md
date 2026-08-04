# Vendored codex-acp (planned)

> **Status: NOT yet vendored.** pi-strings currently uses the upstream
> `@agentclientprotocol/codex-acp@^1.1.4` package (resolves to `1.1.9`) via
> ACPX's agent registry (`npx -y @agentclientprotocol/codex-acp@^1.1.4`).
> This README records (a) the concrete provider bug that would motivate vendoring and
> (b) the exact procedure to vendor it later. When we vendor, this directory becomes
> the snapshot home, mirroring how `vendor/acpx/` is handled.

## Why we may need to vendor

Reproduced deterministically on a live Codex `writer` worker (worktree cwd):

- A writer with session `cwd` = the worktree is asked to write a single file at an
  absolute path **outside** the worktree (the parent checkout).
- Outcome: **the file is created.** pi-strings' ACPX `permissionPolicy`, the ACP
  `session/request_permission` channel, and ACPX's `--cwd` are all correctly
  forwarded/honored, yet the write still lands outside the worktree.

### Root cause (upstream `codex-acp` 1.1.9)

`codex-acp` unconditionally marks every session root as **trusted**:

- `src/CodexAcpClient.ts:498` (`createSessionConfig`) hardcodes
  `projects.<root>.trust_level = "trusted"` for the session `cwd` **and** every
  additional directory. Nothing in the ACP/ACPX layer can override it.

Because Codex treats the session project as trusted, its provider-native **Guardian
Review** auto-approves an `apply_patch` that expands *outside* the workspace-write
root, judging it low-risk and honoring the prompt's explicit instruction
(`Status: Approved`, `Authorization: high`). The per-turn
`sandboxPolicy: { type: "workspaceWrite" }` is correctly sent
(`CodexAcpClient.ts:706-707`), but it does **not** stop the Guardian escalation.

Consequences for pi-strings:

- No ACPX parameter can redirect/trap this: the write is approved inside Codex and
  never surfaces `session/request_permission`.
- The only write-allowing mode that cannot escalate is none; `read-only` blocks all
  writes (breaking writers). Launching with `--sandbox workspace-write` is the same
  policy that is already active, so it changes nothing.
- `INITIAL_AGENT_MODE` / `CODEX_CONFIG` levers exist but do not fix it
  (`createSessionConfig` rebuilds `projects` with `trusted`, overriding injected
  config).

### Verification evidence

- Reproduced with `codex-acp@1.1.9` (resolves via the registry `^1.1.4`;
  also the current `main` of https://github.com/agentclientprotocol/codex-acp at
  commit `efa3789c3909838590f2f7cf24682ec4a0e987e4`).
- Transcript (from `real Codex writer permission boundary`, live E2E):
  ```
  [tool] Guardian Review (in_progress): Action: apply_patch touching /Users/.../pi-strings-checkout/.pi-strings-forbidden-codex-<ts>.txt
  [tool] tool call (completed): Status: Approved — Authorization: high — Risk: low
    Rationale: The user explicitly authorized a single, narrowly scoped local file creation...
  ```

## How to vendor it ("no shortcuts" fix path)

Mirror the existing ACPX vendor flow (`tsconfig.acpx.json`, `build:acpx`,
`dist/acpx-runtime`). The package is a self-contained stdio ACP server built from
`src/index.ts` (it has its own dependencies).

Where the pieces slot in:

1. **Snapshot** the upstream source at a pinned commit into this directory
   (`android` `vendor/codex-acp/`), with provenance: upstream URL, pinned commit,
   license (Apache-2.0), adopted patches, and a release-handoff note — same shape
   as `vendor/acpx/README.md`.
2. **Build boundary**: add a `tsconfig.vendor-codex-acp.json` (upstream-compatible
   strictness) that emits runtime + declarations into `dist/codex-acp`, and a
   `build:codex-acp` script wired into `build`/`typecheck` (mirror
   `tsconfig.acpx.json` + `build:acpx`).
3. **Point the registry at the local build** instead of `npx … @^1.1.4`:
   - In `extensions/pi-strings/runtime/acpx-runtime.ts`, the `constructor`
     passes `createAgentRegistry({ overrides: { pi: piAdapterArgv } })`. Add a
     `codex` override authoring the vendored entry, e.g.
     `overrides: { pi: piAdapterArgv, codex: [process.execPath, resolve(packageRoot, "dist/codex-acp/index.js")] }`.
   - The default is in `vendor/acpx/src/agent-registry.ts:66`
     (`codex: ["npx", "-y", "@agentclientprotocol/codex-acp@^1.1.4"]`); a
     runtime override is preferred so upstream `agent-registry.ts` stays unmodified.
4. **Apply the actual fix** to the vendored copy of `src/CodexAcpClient.ts`:
   - Stop hardcoding `trust_level: "trusted"` for every session root (line 498) —
     default to/read project trust from Codex's real config instead, and/or make the
     ACP client able to control trust per session.
   - Ideally: route **Guardian Review's out-of-root approval through the ACP
     `session/request_permission`** channel so the host's `permissionPolicy`
     (pi-strings writer allow/deny) is consulted before the patch expands the root.
5. **Verify** with the live E2E:
   `PI_STRINGS_E2E=1 PI_STRINGS_TEST_CODEX_MODEL=… PI_STRINGS_TEST_PI_MODEL=deepseek/deepseek-v4-flash PI_STRINGS_E2E_WRITER_WORKTREE=<worktree> npm run test:e2e`
   and specifically `--test-name-pattern="Codex writer permission"`. The forbidden
   write must now be rejected (no file created outside the worktree).
6. Keep upstream source unmodified except the adopted patch; record the diff in this
   README. When upstream ships the equivalent change, replace the snapshot and drop the
   override.

### Open decision

Vendoring makes pi-strings carry a fork of a provider adapter — a deliberate step
against the "thin proxy" boundary. Confirm scope before doing it (either the trust fix,
the ACP-routed Guardian approval, or both). Until then the out-of-worktree write by a
native-approval agent (`codex-acp` Guardian) remains a documented limitation.

## Related: Claude Code confinement needs (note only)

Claude is a *different* case from Codex/Amp — its `Write`/`Edit` route through ACP
`session/request_permission` (claude-agent-acp `canUseTool` → `requestPermissionFromClient`),
so a **path-scoped ACP permission decision** (approve writes only within the worker `cwd`)
would confine it *without* forking the provider. Recorded in `docs/ARCHITECTURE.md` §4.

Planned ("do B down the road", not now): a scoped `pre_tool_use` hook / `permissions`
forwarded to the claude worker, or the ACPX host path-scope hook; post-turn reconcile is
the universal backstop that also covers Codex/Amp. See `tasks/todo.md`.
