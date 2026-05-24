import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSION_ROOT = path.join(REPO_ROOT, "extensions/pi-claude-marketplace");

/**
 * Shell-out boundary defense. Most Git operations use `isomorphic-git`, but
 * SSH GitHub remotes require OpenSSH transport that isomorphic-git does not
 * implement. Native `git` is therefore allowed only in `platform/git.ts`; no
 * other extension file may import `node:child_process`, `child_process`, or
 * its named members.
 *
 * Mirrors the no-telemetry-deps test's structure -- read every .ts under the
 * extension tree, refuse if a forbidden import is detected.
 *
 * Forbidden patterns (regex on the source text):
 *   - `from "node:child_process"`
 *   - `from "child_process"`
 *   - `require("child_process")`
 *   - `require("node:child_process")`
 */

async function* walkTsFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTsFiles(full);
    } else if (entry.isFile() && full.endsWith(".ts")) {
      yield full;
    }
  }
}

const FORBIDDEN_PATTERNS: ReadonlyArray<RegExp> = [
  /from\s+["']node:child_process["']/,
  /from\s+["']child_process["']/,
  /require\(\s*["']child_process["']\s*\)/,
  /require\(\s*["']node:child_process["']\s*\)/,
];

test("child_process imports are confined to platform/git.ts for SSH git transport", async () => {
  const offenders: string[] = [];
  for await (const file of walkTsFiles(EXTENSION_ROOT)) {
    const source = await readFile(file, "utf8");
    for (const pat of FORBIDDEN_PATTERNS) {
      if (
        pat.test(source) &&
        path.relative(EXTENSION_ROOT, file) !== path.join("platform", "git.ts")
      ) {
        offenders.push(`${path.relative(REPO_ROOT, file)} matches ${String(pat)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `child_process import detected outside platform/git.ts:\n  ${offenders.join("\n  ")}\n  (SSH GitHub remotes may use native git only behind the platform/git.ts boundary)`,
  );
});
