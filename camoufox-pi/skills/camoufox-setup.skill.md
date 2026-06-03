---
name: camoufox-setup
description: Audit and configure camoufox-pi source-adapter credentials. Invokes the packaged CLI to walk through missing credentials interactively. Use when a camoufox-pi source reports credential_missing or when the user types "/camoufox setup".
---

# camoufox-setup

Runs `bunx camoufox-pi setup` in the current workspace. The CLI walks through:

1. Audit: enumerates registered source adapters and reports each credential as ok / missing / invalid.
2. Fix: for each missing credential, prompts the user for the value and stores it in the OS keychain.
3. Final audit: prints the post-fix state and returns nonzero if any required credential is still missing.

## Usage

```bash
bunx camoufox-pi setup          # interactive
bunx camoufox-pi setup --check  # audit-only, nonzero exit if anything missing
```

## Notes

- Credentials are stored in the OS keychain under service name `camoufox-pi`.
- Cookie-jar capture for Tier 2 sources (X, LinkedIn) is not yet implemented — lands in the next milestone.
