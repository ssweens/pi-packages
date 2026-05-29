# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run typecheck   # TypeScript type checking (no emit)
npm run test        # Run all tests with vitest
npx vitest run src/utils/accounts.test.ts  # Run a single test file
```

To test the extension locally without installing:

```bash
npm install
pi -e ./src/extension.ts
```

## Architecture

This is a **Pi extension** — a plugin for the Pi coding agent (`@earendil-works/pi-coding-agent`) that adds multi-account/API-key management.

### Entry Points

- `src/extension.ts` — Pi's actual entry point. Uses `jiti` for runtime TypeScript transpilation with the `@` path alias, then delegates to `src/index.ts`.
- `src/index.ts` — Wires up the runtime and registers event listeners (`session_start`, `model_select`) and all commands.

### Layered Architecture

```
Commands (src/commands/)
    ↓ use
Runtime / AccountSwitcher interface (src/runtime/)
    ↓ delegates to
Services (src/services/)
    ↓ use
Storage (src/storage/)  →  JSON files on disk (~/.pi/account-switcher/)
```

**Runtime** — `AccountSwitcherRuntime` implements the `AccountSwitcher` interface and is the single facade that commands talk to. It coordinates across services.

**Services** — Three main services, each with a factory function (`useXxxService`):

- `AccountService` — loads/saves accounts, manages active selection, applies env vars.
- `ProviderService` — loads/saves custom providers, registers them with Pi via `pi.registerProvider()`.
- `ModelService` — applies model switches via `pi.setModel()`.
- `PiAuthService` — reads Pi's own `~/.pi/agent/auth.json` for OAuth credential import.

**Storage** — JSON file stores at `~/.pi/account-switcher/` (`accounts.json`, `providers.json`, `state.json`). Schemas are validated with Zod in `src/schemas/`.

**Commands** — Each command group (`accounts`, `providers`, `models`, `system`) exports a `useXxxCommands(pi, runtime)` factory. Individual commands extend `BaseCommand`, which wraps `pi.registerCommand()` and provides `pick()` / `pickGrouped()` helpers backed by `@earendil-works/pi-tui`.

### Path Alias

`@/` maps to `src/` everywhere — in TypeScript (via `tsconfig.json` `paths`), in tests (via `vitest.config.ts` alias), and at runtime (via `jiti` alias in `extension.ts`).

### Key Types

- `AccountConfig` — an account entry (id, label, provider, env map, optional piAuth/providerApiKey fields).
- `ProviderConfig` — a custom provider definition mirroring Pi's provider fields plus metadata (`envKeys`, `aliases`, `piAuthProvider`).
- `AccountSwitcherContext` — extends Pi's session context; passed to every command handler with `ui`, `model`, and `modelRegistry`.

### Secret Resolution

`src/utils/accounts.ts` (`resolveSecret`) handles all credential types: `literal`, `env`, `file`, `command`, `op`. Called at account activation time, not at load time.

### No Build Step

The project ships TypeScript source directly (see `"files"` in `package.json`). There is no compile/bundle step; `jiti` handles transpilation at runtime inside Pi.
