// Helpers for CamoufoxClient.fetchUrl — wait-strategy resolution, selector
// waits, DOM slicing, HTML→markdown, screenshot capture. Split out so fetchUrl
// reads as a recipe and htmlToMarkdown can be tested without a browser.
// Spec: docs/superpowers/specs/2026-04-13-fetch-url-features-design.md §3.1.

import type { Page } from "playwright-core";
import TurndownService from "turndown";

import { CamoufoxErrorBox, sanitizeReason } from "../errors.js";

export type RenderMode = "static" | "render" | "render-and-wait";
export type Format = "html" | "markdown";

// Hard ceiling on the HTML string fed to turndown. Prevents a pathologically
// large page (e.g. 500 MiB of inline script/svg) from OOMing the process
// during markdown conversion. Independent of the caller's max_bytes, which
// caps the *returned* body.
export const MAX_MARKDOWN_INPUT_BYTES = 16 * 1024 * 1024;

// Cap on raw screenshot bytes returned to the caller.
export const SCREENSHOT_MAX_BYTES = 10 * 1024 * 1024;

// Per-axis and total-pixel ceilings for `full_page` screenshots. Measured via
// page.evaluate before capture so we reject tall/wide pages without rendering
// the whole canvas in memory.
export const MAX_SCREENSHOT_DIMENSION_PX = 16_384;
export const MAX_SCREENSHOT_PIXELS = 50_000_000;

export interface FetchUrlOpts {
	signal: AbortSignal;
	timeoutMs?: number;
	maxBytes?: number;
	isolate?: boolean;
	renderMode?: RenderMode;
	waitForSelector?: string;
	selector?: string;
	format?: Format;
	screenshot?: ScreenshotOpts;
}

export interface ValidatedFetchUrlOpts {
	renderMode: RenderMode;
	format: Format;
}

// Validates every option combination fetchUrl accepts; throws CamoufoxErrorBox
// on any violation. Keeps fetchUrl's body focused on the pipeline itself.
// Returns resolved `renderMode` / `format` since both have defaults and are
// referenced in multiple places downstream.
export function validateFetchUrlOpts(opts: FetchUrlOpts): ValidatedFetchUrlOpts {
	if (
		opts.timeoutMs !== undefined &&
		(!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1_000 || opts.timeoutMs > 120_000)
	) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "timeoutMs",
			reason: `must be integer in [1000, 120000], got ${opts.timeoutMs}`,
		});
	}
	if (
		opts.maxBytes !== undefined &&
		(!Number.isInteger(opts.maxBytes) || opts.maxBytes < 1_024 || opts.maxBytes > 52_428_800)
	) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "maxBytes",
			reason: `must be integer in [1024, 52428800], got ${opts.maxBytes}`,
		});
	}
	if (
		opts.renderMode !== undefined &&
		opts.renderMode !== "static" &&
		opts.renderMode !== "render" &&
		opts.renderMode !== "render-and-wait"
	) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "renderMode",
			reason: `must be one of static|render|render-and-wait, got ${String(opts.renderMode)}`,
		});
	}
	const renderMode: RenderMode = opts.renderMode ?? "render";
	if (opts.waitForSelector !== undefined && renderMode !== "render-and-wait") {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "waitForSelector",
			reason: "only valid with renderMode: render-and-wait",
		});
	}
	if (
		opts.waitForSelector !== undefined &&
		(typeof opts.waitForSelector !== "string" || opts.waitForSelector.length === 0)
	) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "waitForSelector",
			reason: "must be a non-empty string",
		});
	}
	if (opts.selector !== undefined) {
		if (typeof opts.selector !== "string" || opts.selector.length === 0) {
			throw new CamoufoxErrorBox({
				type: "config_invalid",
				field: "selector",
				reason: "must be a non-empty string",
			});
		}
		if (opts.selector.length > 512) {
			throw new CamoufoxErrorBox({
				type: "config_invalid",
				field: "selector",
				reason: "exceeds 512-char cap",
			});
		}
	}
	const format: Format = opts.format ?? "html";
	if (format !== "html" && format !== "markdown") {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "format",
			reason: `must be html or markdown, got ${String(format)}`,
		});
	}
	if (opts.screenshot !== undefined) {
		const s = opts.screenshot;
		if (s.format !== undefined && s.format !== "png" && s.format !== "jpeg") {
			throw new CamoufoxErrorBox({
				type: "config_invalid",
				field: "screenshot.format",
				reason: `must be png or jpeg, got ${String(s.format)}`,
			});
		}
		if (s.quality !== undefined) {
			if ((s.format ?? "png") !== "jpeg") {
				throw new CamoufoxErrorBox({
					type: "config_invalid",
					field: "screenshot.quality",
					reason: "only valid when format: jpeg",
				});
			}
			if (!Number.isInteger(s.quality) || s.quality < 1 || s.quality > 100) {
				throw new CamoufoxErrorBox({
					type: "config_invalid",
					field: "screenshot.quality",
					reason: `must be integer in [1, 100], got ${s.quality}`,
				});
			}
		}
	}
	return { renderMode, format };
}

export function resolveWaitUntil(mode: RenderMode): "domcontentloaded" | "load" | "networkidle" {
	switch (mode) {
		case "static":
			return "domcontentloaded";
		case "render":
			return "load";
		case "render-and-wait":
			return "networkidle";
	}
}

// Pre-strips elements that should never appear in a markdown extraction:
// scripts, styles, noscript, svg, iframes, HTML comments. Regex-based so it
// works on raw HTML strings without needing a DOM parser roundtrip.
//
// Known limitations (acceptable for this use): a malformed attribute such as
// `<script foo=">"...>` can confuse the attribute-body match; a comment-like
// sequence inside a CDATA block may be trimmed. Turndown runs afterward on a
// real parser, so any leftover tags get sanitized there.
function stripDangerousBlocks(html: string): string {
	return html
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<(script|style|noscript|svg|iframe)\b[^>]*\/>/gi, "");
}

// Turndown does not resolve relative URLs. We do it on the raw HTML before
// converting so every [text](url) and ![alt](url) in the output is absolute
// against the page's final URL.
//
// Known limitations: srcset, poster, action, cite, and data-* attributes are
// NOT absolutized. Turndown discards most of them; callers needing absolute
// srcset must post-process.
function absolutizeUrls(html: string, baseUrl: string): string {
	return html.replace(
		/(\s(?:href|src))\s*=\s*(["'])([^"']*)\2/gi,
		(match, attr: string, quote: string, value: string) => {
			try {
				const abs = new URL(value, baseUrl).href;
				return `${attr}=${quote}${abs}${quote}`;
			} catch {
				return match;
			}
		},
	);
}

export function htmlToMarkdown(html: string, baseUrl: string): string {
	if (html === "") return "";
	// Hard input cap — prevents OOM on pathologically large HTML regardless of
	// the caller's max_bytes (which caps the *returned* body).
	let input = html;
	if (Buffer.byteLength(input, "utf8") > MAX_MARKDOWN_INPUT_BYTES) {
		input = Buffer.from(input, "utf8").subarray(0, MAX_MARKDOWN_INPUT_BYTES).toString("utf8");
	}
	const cleaned = absolutizeUrls(stripDangerousBlocks(input), baseUrl);
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});
	// Intentionally unguarded: the outer wrapper in fetchUrl maps a throw
	// here to config_invalid { field: "markdown" } per spec §5.
	return td.turndown(cleaned);
}

export async function extractSlice(
	page: Page,
	selector: string | undefined,
): Promise<{ html: string }> {
	if (selector === undefined) {
		return { html: await page.content() };
	}
	const loc = page.locator(selector).first();
	let count: number;
	try {
		count = await loc.count();
	} catch (err) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "selector",
			reason: sanitizeReason(err instanceof Error ? err.message : String(err)),
		});
	}
	if (count === 0) {
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "selector",
			reason: "no element matched",
		});
	}
	const outerHTML = await loc.evaluate((el: { outerHTML: string }) => el.outerHTML);
	return { html: outerHTML };
}

export async function waitForSelectorOrThrow(
	page: Page,
	selector: string,
	timeoutMs: number,
): Promise<void> {
	if (timeoutMs <= 0) {
		throw new CamoufoxErrorBox({
			type: "timeout",
			phase: "wait_for_selector",
			elapsedMs: 0,
		});
	}
	try {
		await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
	} catch (err) {
		if (err instanceof Error && err.name === "TimeoutError") {
			throw new CamoufoxErrorBox({
				type: "timeout",
				phase: "wait_for_selector",
				elapsedMs: timeoutMs,
			});
		}
		throw new CamoufoxErrorBox({
			type: "config_invalid",
			field: "waitForSelector",
			reason: sanitizeReason(err instanceof Error ? err.message : String(err)),
		});
	}
}

export interface ScreenshotOpts {
	fullPage?: boolean;
	format?: "png" | "jpeg";
	quality?: number;
}

export interface ScreenshotResult {
	data: string;
	bytes: number;
	mimeType: "image/png" | "image/jpeg";
}

export async function capturePageScreenshot(
	page: Page,
	opts: ScreenshotOpts,
): Promise<ScreenshotResult> {
	// For full_page, measure before capturing — Playwright renders the entire
	// canvas into memory before compressing, so an unbounded page (e.g. an
	// infinite-scroll feed with 100k rows) can OOM the process. Rejecting
	// based on scroll dimensions stops this before any render.
	if (opts.fullPage) {
		const dims = await page.evaluate((): { width: number; height: number } => {
			const d = (
				globalThis as unknown as {
					document: {
						documentElement: { scrollWidth: number; scrollHeight: number };
					};
				}
			).document;
			return {
				width: d.documentElement.scrollWidth,
				height: d.documentElement.scrollHeight,
			};
		});
		if (
			dims.width > MAX_SCREENSHOT_DIMENSION_PX ||
			dims.height > MAX_SCREENSHOT_DIMENSION_PX ||
			dims.width * dims.height > MAX_SCREENSHOT_PIXELS
		) {
			throw new CamoufoxErrorBox({
				type: "config_invalid",
				field: "screenshot",
				reason:
					`full_page dimensions ${dims.width}x${dims.height} exceed caps ` +
					`(${MAX_SCREENSHOT_DIMENSION_PX}px/axis, ${MAX_SCREENSHOT_PIXELS}px total)`,
			});
		}
	}
	const type: "png" | "jpeg" = opts.format ?? "png";
	const pwOpts: { fullPage?: boolean; type: "png" | "jpeg"; quality?: number } = {
		type,
	};
	if (opts.fullPage) pwOpts.fullPage = true;
	if (type === "jpeg" && opts.quality !== undefined) pwOpts.quality = opts.quality;
	const buf = await page.screenshot(pwOpts);
	return {
		data: buf.toString("base64"),
		bytes: buf.byteLength,
		mimeType: type === "png" ? "image/png" : "image/jpeg",
	};
}
