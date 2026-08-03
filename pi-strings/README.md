# pi-strings

Reliable multi-agent orchestration for [Pi](https://github.com/earendil-works/pi), using ACP rather than terminal scraping.

`pi-strings` keeps the current Pi session in control while named workers run through the exact-pinned `acpx/runtime` API. Pi workers use a vendored, hardened ACP adapter. Claude Code, Codex, OpenCode, and other configured ACP agents use the same coordinator contract.

## Design promises

- The main Pi is the only orchestrator. Workers cannot recursively launch workers.
- Worker identity and turn identity are separate. Every turn has an explicit request ID and terminal result.
- One worker has at most one active turn; different workers may run concurrently.
- Enforced read-only workers currently use Pi with only `read`, `grep`, `find`, and `ls`. Writers must start in an already isolated linked git worktree.
- ACP is transport, not a sandbox. Tool restrictions are applied at worker startup; Codex writers additionally run under macOS `sandbox-exec` with writes confined to the assigned worktree and provider state/temp paths.
- Cancellation, timeout, provider failure, and transport failure are never reported as success.
- tmux is optional for humans. Automation never uses `send-keys`, pane scraping, or prompt detection.

## Agent tool

The extension registers one `strings` tool with these actions:

- `spawn` — create or restore a named worker from a profile
- `send` — start a normal turn
- `steer` — deliver a correlated in-flight message to active Pi workers over the same ACP connection; generic acpx 0.13.0 agents remain unsupported unless their runtime advertises a genuine steering operation
- `wait` — wait for one, the first (`mode: "any"`), or all (`mode: "all"`) selected active turns using a fixed snapshot
- `result` — inspect retained terminal output without waiting
- `list` — inspect workers, active requests, and diagnostics
- `cancel` — cooperatively cancel an active turn
- `close` — stop the worker and optionally discard persistent session state
- `questions` / `reply` — inspect and answer correlated child questions when the runtime advertises support; Pi and the documented external ACP permission-question bridge are supported

Requests expose attempt lineage for cancel-and-reassign flows. Run `bun run test:integration` for explicit prerequisite skips, or `bun run test:e2e` with configured credentials and models for real Pi/Codex/OpenCode adapter gates. The external ACP question fixture proves the bridge contract; provider-specific claims remain limited to the hosted adapters actually tested.

See [`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) for tool examples and orchestration recipes. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for state machines, policy boundaries, persistence, and recovery. The progressive product contract, promotion gates, and 20-case acceptance matrix are in [`docs/2026-08-02-COORDINATION_LAYERS.md`](docs/2026-08-02-COORDINATION_LAYERS.md).

## Configuration

Project configuration is loaded from `.pi/pi-strings.json`; user configuration is loaded from `~/.pi/agent/pi-strings.json`. Project values override user values by profile name.

```json
{
  "profiles": {
    "pi-reviewer": {
      "agent": "pi",
      "role": "read-only",
      "model": "anthropic/claude-sonnet-4-6",
      "thinking": "high",
      "tools": ["read", "grep", "find", "ls"],
      "timeoutMs": 900000
    },
    "pi-writer": {
      "agent": "pi",
      "role": "writer",
      "tools": ["read", "grep", "find", "ls", "bash", "edit", "write"]
    }
  }
}
```

Writer profiles must use `role: "writer"`; `spawn` must then provide `cwd` pointing to a linked worktree distinct from the orchestrator checkout.

## Installation

```bash
pi install @ssweens/pi-strings
```

The package builds its vendored adapter before publication. Local development requires running `npm run build` after dependencies are installed.

## Documentation

- [Agent guide](docs/AGENT_GUIDE.md)
- [Architecture and operational contract](docs/ARCHITECTURE.md)
- [Coordination capability layers and acceptance matrix](docs/2026-08-02-COORDINATION_LAYERS.md)
- [Current test coverage](TEST_COVERAGE.md)
- [Third-party notices](NOTICE.md)
