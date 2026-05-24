# Test Coverage

## Current Gates

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `NODE_OPTIONS=--experimental-strip-types npm test`

## SSH Git Repository Support

Covered by:

- `tests/domain/source.test.ts` — accepts GitHub SSH forms (`git@github.com:owner/repo.git`, `ssh://git@github.com/owner/repo.git`) and rejects non-GitHub SSH URLs.
- `tests/orchestrators/marketplace/add.test.ts` — verifies SSH marketplace sources clone using the SSH clone URL and preserve `#ref` as the checkout ref.
- `tests/architecture/no-shell-out.test.ts` — confines native `git` shell-out to `platform/git.ts`, where SSH transport fallback lives.

## Notes

The package test script runs TypeScript test files directly. In this environment, the full suite requires Node's type stripping flag via `NODE_OPTIONS=--experimental-strip-types npm test`.
