// Launcher interface. The ONE place that may import camoufox-js.
// RealLauncher lands in a later task; tests use a fake via tests/helpers/fake-launcher.
// Spec: §2, §4.3, §8.

import { isAbsolute } from "node:path";
import { launchOptions as camoufoxLaunchOptions } from "camoufox-js";
import { type Browser, type BrowserContext, firefox } from "playwright-core";

import { CamoufoxErrorBox } from "../errors.js";
import type { BinaryDownloadProgressEvent } from "./events.js";

export interface LaunchedBrowser {
	readonly browser: Browser;
	readonly context: BrowserContext;
	readonly version: string;
}

export interface LaunchOpts {
	readonly onProgress?: (e: BinaryDownloadProgressEvent) => void;
}

export interface Launcher {
	/**
	 * Launch the browser. Cancellation of an in-flight launch is not
	 * supported in this slice — `ensureReady()` awaits the launch
	 * regardless. If this becomes needed, thread an AbortSignal through.
	 */
	launch(opts?: LaunchOpts): Promise<LaunchedBrowser>;
}

export interface RealLauncherOptions {
	/** Headless? Default: true. Override for local debugging. */
	readonly headless?: boolean;
	/** Override the Camoufox binary path. */
	readonly binaryPath?: string;
}

/**
 * Real launcher: calls camoufox-js for fingerprint + binary-aware
 * launch options, then drives playwright-core's firefox.launch.
 * This is the ONLY file in the codebase that may import camoufox-js.
 * Spec: §2, §8.
 *
 * Note on onProgress: camoufox-js v0.9 does not expose a download progress
 * hook on launchOptions(). Rather than introduce a fragile partial-file
 * polling fallback now, we accept the opts for interface uniformity and
 * simply never fire onProgress. The fake launcher fires synthetic events so
 * the client-side plumbing is exercised end-to-end. When a future
 * camoufox-js version exposes a hook, this is the only file that needs to
 * change.
 */
export class RealLauncher implements Launcher {
	private readonly headless: boolean;
	private readonly binaryPath: string | undefined;

	constructor(opts: RealLauncherOptions = {}) {
		this.headless = opts.headless ?? true;
		if (opts.binaryPath !== undefined && !isAbsolute(opts.binaryPath)) {
			throw new CamoufoxErrorBox({
				type: "config_invalid",
				field: "binaryPath",
				reason: `must be an absolute path, got: ${opts.binaryPath}`,
			});
		}
		this.binaryPath = opts.binaryPath;
	}

	async launch(_opts: LaunchOpts = {}): Promise<LaunchedBrowser> {
		const launchOpts = (await camoufoxLaunchOptions({
			headless: this.headless,
			...(this.binaryPath !== undefined ? { executablePath: this.binaryPath } : {}),
		})) as Parameters<typeof firefox.launch>[0];
		const browser = await firefox.launch(launchOpts);
		const context = await browser.newContext();
		const version = browser.version();
		return { browser, context, version };
	}
}
