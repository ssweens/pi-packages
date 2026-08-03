# pi-strings

Reliable multi-agent orchestration for [Pi](https://github.com/earendil-works/pi), using ACP rather than terminal scraping.

`pi-strings` keeps the current Pi session in control while named workers run through the exact-pinned `acpx/runtime` API. Every agent, including Pi, uses the same `AcpxRuntimePort`; Pi is exposed through the vendored ACP adapter command.

## Design promises

- The main Pi is the only orchestrator. Workers cannot recursively launch workers.
- One persistent worker session has at most one active turn; different workers may run concurrently.
- A normal `send` starts a turn. After terminal completion, another ordinary `send` continues the same persistent session. There is no in-flight steering, question, or reply product surface.
- **Shared checkout is the default for writers.** One live writer per canonical cwd; a second writer in the same cwd is rejected. Worktree isolation is an opt-in compatibility mode (`isolation: "worktree"`), not a requirement. Future stronger isolation may use CoW temp copies.
- Read-only workers use the configured read-only profile. Writers use the writer profile with `approve-reads` permissions; read-only profiles use `deny-all`.
- ACPX is the only production runtime port. Non-interactive permissions use `deny`.
- The coordinator owns request deadlines. A timed-out request is terminalized as `timed_out`, cleaned up within bounded grace, and leaves its worker unusable until explicit close/replacement.
- Cancellation, timeout, provider failure, and transport failure are never reported as success.
- tmux is optional for humans. Automation never uses `send-keys`, pane scraping, or prompt detection.

## Agent tools

The extension registers seven `op_*` tools with strict per-tool schemas:

- `op_spawn` — create or restore a named worker from a profile
- `op_send` — start an ordinary turn (`requestTimeoutMs` bounds the entire request; default is the profile `timeoutMs`)
- `op_wait` — wait for one, the first (`mode: "any"`), or all (`mode: "all"`) selected turns using a fixed snapshot (`waitTimeoutMs` bounds the call, default 300000)
- `op_result` — inspect retained output and terminal status
- `op_list` — inspect workers and requests (optional `names` projection)
- `op_cancel` — cooperatively cancel an active turn, with bounded escalation
- `op_close` — stop a worker and optionally discard persistent session state

Requests expose attempt lineage for cancel-and-reassign flows. Run `npm run test:integration` for explicit prerequisite skips, or `npm run test:e2e` with configured credentials and models for real provider gates.

See [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) for operating recipes, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for lifecycle and policy boundaries, and [`TEST_COVERAGE.md`](TEST_COVERAGE.md) for the current acceptance ledger.

## Configuration

Project configuration is loaded from `.pi/pi-strings.json`; user configuration is loaded from `~/.pi/agent/pi-strings.json`. Project values override user values by profile name.

```json
{
  "profiles": {
    "pi-reviewer": {
      "agent": "pi",
      "role": "read-only",
      "kind": "free",
      "model": "anthropic/claude-sonnet-4-6",
      "thinking": "high",
      "tools": ["read", "grep", "find", "ls"],
      "timeoutMs": 900000
    },
    "pi-writer": {
      "agent": "pi",
      "role": "writer",
      "kind": "worker",
      "isolation": "shared",
      "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"]
    },
    "pi-oracle": {
      "agent": "pi",
      "role": "read-only",
      "kind": "oracle",
      "model": "openai/o3",
      "tools": ["read", "grep", "find", "ls"]
    },
    "pi-finder": {
      "agent": "pi",
      "role": "read-only",
      "kind": "finder",
      "maxTurns": 12,
      "tools": ["read", "grep", "find", "ls"]
    }
  }
}
```

### Role specialization (`kind`)

Each profile has a `kind` that controls prompt decoration and acceptance contracts:

| Kind | Default profile | Contract |
|------|----------------|----------|
| `oracle` | `pi-oracle` | Read-only advisor. Must produce a fenced `acceptance-report` block. |
| `finder` | `pi-finder` | Read-only scout with a turn budget (`maxTurns`). Must produce an acceptance report. |
| `worker` | `pi-writer` | Writer. Must produce an acceptance report describing changed files. |
| `free` | `pi-reviewer` | Read-only reviewer. No acceptance report required. |

### Isolation

- `isolation: "shared"` (default) — the writer runs in the given cwd. One live writer per canonical cwd.
- `isolation: "worktree"` — the writer must run in a linked git worktree distinct from the parent checkout. This is opt-in compatibility mode, not the default.

### Bounded retry and model fallback

Profiles may configure `fallbackModels` and `maxAttempts` for bounded retry on retryable provider failures:

```json
{
  "pi-oracle": {
    "model": "openai/o3",
    "fallbackModels": ["anthropic/claude-sonnet-4-6"],
    "maxAttempts": 2
  }
}
```

Retries stay on the same persistent session, switch the model via `setConfigOption`, and preserve the public request ID. Non-retryable failures, cancellations, and policy violations are never retried.

### Usage and cost telemetry

Terminal results carry `usage` (token breakdown and cost) sourced from ACP `usage_update` events. Usage is merged across retry attempts.

## Installation

```bash
pi install @ssweens/pi-strings
```

The package builds its vendored adapter before publication. Local development requires running `npm run build` after dependencies are installed.

## Documentation

- [Agent guide](docs/AGENT_GUIDE.md)
- [Architecture and operational contract](docs/ARCHITECTURE.md)
- [Current test coverage](TEST_COVERAGE.md)
- [Third-party notices](NOTICE.md)
