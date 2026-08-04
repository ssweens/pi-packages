# Vendored ACPX runtime

This directory contains the ACPX source snapshot used by pi-strings.

- Upstream: https://github.com/openclaw/acpx
- Snapshot: `e91cc50439e7ed58845fca82e23c72dcaaf7fd8a`
- Based on: ACPX `0.13.0`
- Adopted change: PR #468, exposing `permissionPolicy` through embedded runtime options
- License: [`LICENSE`](./LICENSE)

Only `src/runtime.ts` and its local dependency graph are imported by pi-strings. The
remaining source is retained to keep the vendor snapshot auditable and to preserve
upstream module boundaries. The runtime continues to use this package's direct
`@agentclientprotocol/sdk` dependency.

When ACPX releases the equivalent change, replace this snapshot with the released
source and re-run the ACPX contract tests before removing the vendor copy.
