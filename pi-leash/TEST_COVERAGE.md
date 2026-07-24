# Test coverage

## Permission gate

`src/hooks/permission-gate.test.ts` verifies:

- five-minute dangerous-command trust applies only to its granted reason;
- a command that matches multiple reasons still requires every reason to be trusted;
- the registered Pi `tool_call` hook routes the five-minute selection through the RPC fallback, bypasses a later same-reason command, and prompts for a different or additional reason;
- the real inline dialog component renders the concrete reason label (for example, `w: allow recursive force delete for 5 min`);
- timed grants expire after five minutes, and explicitly clearing trust revokes session grants;
- dangerous command parsing, cwd scope detection, and inline-dialog height helpers continue to work.

## Validation

Run from `pi-leash/`:

```bash
pnpm test
pnpm typecheck
pnpm lint
```
