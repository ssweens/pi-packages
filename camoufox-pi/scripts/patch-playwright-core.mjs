#!/usr/bin/env node
/**
 * @ssweens/camoufox-pi — postinstall patch
 *
 * Patches playwright-core to fix a crash in FFBrowserContext when a
 * JavaScript page error fires on a React/Next.js SPA after the browser
 * context has already been partially torn down.
 *
 * Root cause:
 *   FFPage._onUncaughtError receives a CDP pageError event where
 *   `params.location` is undefined (race condition on page close).
 *   The event bubbles to FFBrowserContext which calls _dispatchEvent,
 *   which runs schema validation requiring location.url to be a string.
 *   Getting `undefined` instead throws a ValidationError that becomes
 *   an uncaughtException and kills the host process (pi).
 *
 * Fixes applied (two sites in coreBundle.js):
 *   1. _onUncaughtError — wrap in try/catch, guard params.stack with `|| ""`
 *   2. FFBrowserContext pageError listener — use `?.` + `?? ""` defaults
 *      so the schema validator always receives a valid string.
 *
 * This script is intentionally idempotent: re-running it on an already-patched
 * file is a no-op (the `?.` and `?? ""` patterns won't match the original).
 *
 * Tracked upstream: playwright-core@1.60.0 (latest as of 2026-06-02).
 * Remove this script once a playwright release fixes the issue natively.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findCoreBundle() {
	// When installed as a dep, playwright-core lives alongside us in node_modules.
	// Walk up from __dirname (scripts/) → package root → node_modules → playwright-core.
	const candidates = [
		// Installed as npm dep: node_modules/@the-forge-flow/camoufox-pi/scripts/
		resolve(__dirname, "../../../playwright-core/lib/coreBundle.js"),
		// Hoisted install (flat node_modules):
		resolve(__dirname, "../../../../playwright-core/lib/coreBundle.js"),
		// Local dev (package root has its own node_modules):
		resolve(__dirname, "../node_modules/playwright-core/lib/coreBundle.js"),
	];
	for (const p of candidates) {
		try {
			readFileSync(p, { encoding: "utf8", flag: "r" });
			return p;
		} catch {
			// not here, try next
		}
	}
	return null;
}

const bundlePath = findCoreBundle();
if (!bundlePath) {
	console.warn(
		"[camoufox-pi] patch-playwright-core: playwright-core/lib/coreBundle.js not found — skipping patch.",
	);
	process.exit(0);
}

let src = readFileSync(bundlePath, "utf8");
let changed = false;

// ─── Patch 1: _onUncaughtError — guard params.stack and wrap in try/catch ───
// Sentinel that uniquely identifies an already-patched _onUncaughtError.
// We look for `(params2.stack || "")` — the guarded stack access we inject.
const P1_ALREADY_PATCHED = '(params2.stack || "").split';
const P1_NEEDLE = "params2.stack.split";
const P1_REPLACEMENT = '(params2.stack || "").split';
// Also guard missing try-catch: inject try/catch around the body.
const P1_BODY_NEEDLE =
	'_onUncaughtError(params2) {\n        const { name, message } = splitErrorMessage';
const P1_BODY_REPLACEMENT =
	'_onUncaughtError(params2) {\n        try {\n          const { name, message } = splitErrorMessage';
const P1_TAIL_NEEDLE = "this._page.addPageError(error, params2.location);\n      }";
const P1_TAIL_REPLACEMENT =
	"this._page.addPageError(error, params2.location);\n        } catch (e) { /* location undefined race — suppressed by camoufox-pi patch */ }\n      }";

if (src.includes(P1_ALREADY_PATCHED)) {
	console.log("[camoufox-pi] patch-playwright-core: Patch 1 already applied — skipping");
} else if (src.includes(P1_NEEDLE)) {
	let patched = src.replace(P1_NEEDLE, P1_REPLACEMENT);
	if (src.includes(P1_BODY_NEEDLE)) {
		patched = patched
			.replace(P1_BODY_NEEDLE, P1_BODY_REPLACEMENT)
			.replace(P1_TAIL_NEEDLE, P1_TAIL_REPLACEMENT);
	}
	src = patched;
	changed = true;
	console.log("[camoufox-pi] patch-playwright-core: applied Patch 1 (_onUncaughtError guard)");
} else {
	console.warn(
		"[camoufox-pi] patch-playwright-core: Patch 1 needle not found — playwright-core may have changed layout. Skipping.",
	);
}

// ─── Patch 2: FFBrowserContext pageError listener — default url/line/col ────
// Match the two occurrences: dispatcher path and trace-logger path.
// Use a global replace so both hits are covered in one pass.
const P2_FIND_URL = /url: pageError(?:\?\.|\.)location\.url,/g;
const P2_FIND_LINE = /line: pageError(?:\?\.|\.)location\.lineNumber,/g;
const P2_FIND_COL = /column: pageError(?:\?\.|\.)location\.columnNumber/g;

const P2_REPLACE_URL = 'url: pageError?.location?.url ?? "",';
const P2_REPLACE_LINE = "line: pageError?.location?.lineNumber ?? 0,";
const P2_REPLACE_COL = "column: pageError?.location?.columnNumber ?? 0";

const beforeP2 = src;
src = src
	.replace(P2_FIND_URL, P2_REPLACE_URL)
	.replace(P2_FIND_LINE, P2_REPLACE_LINE)
	.replace(P2_FIND_COL, P2_REPLACE_COL);

if (src !== beforeP2) {
	changed = true;
	console.log(
		"[camoufox-pi] patch-playwright-core: applied Patch 2 (pageError location defaults)",
	);
} else {
	console.log(
		"[camoufox-pi] patch-playwright-core: Patch 2 already applied or needle not found — skipping",
	);
}

if (changed) {
	writeFileSync(bundlePath, src, "utf8");
	console.log(`[camoufox-pi] patch-playwright-core: wrote patched file → ${bundlePath}`);
} else {
	console.log("[camoufox-pi] patch-playwright-core: no changes needed.");
}
