import { describe, expect, it } from "vitest";

import { CamoufoxErrorBox, mapPlaywrightError } from "../../src/errors.js";

describe("CamoufoxErrorBox", () => {
	it("wraps a CamoufoxError and is throwable", () => {
		const box = new CamoufoxErrorBox({ type: "aborted" });
		expect(box).toBeInstanceOf(Error);
		expect(box.name).toBe("CamoufoxError");
		expect(box.err).toEqual({ type: "aborted" });
		expect(box.message).toContain("aborted");
	});

	it("redacts query strings from .message but preserves them in .err", () => {
		const box = new CamoufoxErrorBox({
			type: "http",
			status: 500,
			url: "https://x.test/path?token=secret&u=bob",
		});
		// message is sanitized — no query string
		expect(box.message).not.toContain("secret");
		expect(box.message).not.toContain("token");
		expect(box.message).toContain("https://x.test/path");
		// .err retains the full payload for programmatic callers
		expect((box.err as { url: string }).url).toBe("https://x.test/path?token=secret&u=bob");
	});

	it("truncates long stderr in .message", () => {
		const long = "a".repeat(1000);
		const box = new CamoufoxErrorBox({ type: "browser_launch_failed", stderr: long });
		expect(box.message.length).toBeLessThan(1000);
		expect(box.message).toContain("…[1000 bytes]");
		// .err keeps full stderr
		expect((box.err as { stderr: string }).stderr).toBe(long);
	});

	it("wraps ssrf_blocked and is throwable", () => {
		const box = new CamoufoxErrorBox({
			type: "ssrf_blocked",
			hop: "redirect",
			url: "http://169.254.169.254/latest/meta-data/",
			reason: "resolves to private IPv4 169.254.169.254",
		});
		expect(box).toBeInstanceOf(Error);
		expect(box.name).toBe("CamoufoxError");
		expect(box.err).toEqual({
			type: "ssrf_blocked",
			hop: "redirect",
			url: "http://169.254.169.254/latest/meta-data/",
			reason: "resolves to private IPv4 169.254.169.254",
		});
		expect(box.message).toContain("ssrf_blocked");
	});

	it("ssrf_blocked message redacts URL query strings", () => {
		const box = new CamoufoxErrorBox({
			type: "ssrf_blocked",
			hop: "redirect",
			url: "http://10.0.0.1/admin?token=secret",
			reason: "resolves to private IPv4 10.0.0.1",
		});
		expect(box.message).not.toContain("secret");
		expect(box.message).toContain("http://10.0.0.1/admin");
		expect((box.err as { url: string }).url).toBe("http://10.0.0.1/admin?token=secret");
	});
});

describe("mapPlaywrightError", () => {
	it("maps AbortError to aborted", () => {
		const err = Object.assign(new Error("aborted"), { name: "AbortError" });
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "aborted",
		});
	});

	it("maps aborted signal to aborted", () => {
		const signal = AbortSignal.abort();
		expect(mapPlaywrightError(new Error("anything"), { url: "https://x.test", signal })).toEqual({
			type: "aborted",
		});
	});

	it("maps Playwright TimeoutError to timeout", () => {
		const err = Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" });
		expect(
			mapPlaywrightError(err, { url: "https://x.test", phase: "nav", elapsedMs: 30_000 }),
		).toEqual({ type: "timeout", phase: "nav", elapsedMs: 30_000 });
	});

	it("classifies TimeoutError as timeout even when signal.aborted is true", () => {
		// Combined-signal scenario: internal timeout fires, both abort AND
		// TimeoutError are seen. TimeoutError must win.
		const err = Object.assign(new Error("Timeout 30000ms exceeded"), { name: "TimeoutError" });
		const signal = AbortSignal.abort();
		expect(
			mapPlaywrightError(err, { url: "https://x.test", phase: "nav", elapsedMs: 30_000, signal }),
		).toEqual({ type: "timeout", phase: "nav", elapsedMs: 30_000 });
	});

	it("maps net::ERR_* to network", () => {
		const err = new Error("net::ERR_NAME_NOT_RESOLVED at https://x.test");
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "network",
			cause: "net::ERR_NAME_NOT_RESOLVED at https://x.test",
			url: "https://x.test",
		});
	});

	it("maps NS_ERROR_NET_* to network", () => {
		const err = new Error("NS_ERROR_NET_RESET");
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "network",
			cause: "NS_ERROR_NET_RESET",
			url: "https://x.test",
		});
	});

	it("maps getaddrinfo errors to network", () => {
		const err = new Error("getaddrinfo ENOTFOUND nowhere.test");
		expect(mapPlaywrightError(err, { url: "https://nowhere.test", phase: "nav" })).toEqual({
			type: "network",
			cause: "getaddrinfo ENOTFOUND nowhere.test",
			url: "https://nowhere.test",
		});
	});

	it("classifies unknown Errors as browser_launch_failed", () => {
		const err = new Error("totally unexpected");
		expect(mapPlaywrightError(err, { url: "https://x.test", phase: "nav" })).toEqual({
			type: "browser_launch_failed",
			stderr: "totally unexpected",
		});
	});

	it("wraps non-Error throwables as browser_launch_failed", () => {
		expect(mapPlaywrightError("string error", { url: "https://x.test", phase: "nav" })).toEqual({
			type: "browser_launch_failed",
			stderr: "string error",
		});
	});

	it("returns timeout with phase: wait_for_selector", () => {
		const err = Object.assign(new Error("Timeout 100ms"), { name: "TimeoutError" });
		const mapped = mapPlaywrightError(err, { phase: "wait_for_selector", elapsedMs: 100 });
		expect(mapped).toEqual({ type: "timeout", phase: "wait_for_selector", elapsedMs: 100 });
	});

	it("returns timeout with phase: screenshot", () => {
		const err = Object.assign(new Error("Timeout 50ms"), { name: "TimeoutError" });
		const mapped = mapPlaywrightError(err, { phase: "screenshot", elapsedMs: 50 });
		expect(mapped).toEqual({ type: "timeout", phase: "screenshot", elapsedMs: 50 });
	});
});

describe("source error variants", () => {
	it("credential_missing serializes source and key without leaking secret", () => {
		const box = new CamoufoxErrorBox({
			type: "credential_missing",
			source: "x",
			credentialKey: "cookies",
		});
		expect(box.err).toEqual({
			type: "credential_missing",
			source: "x",
			credentialKey: "cookies",
		});
		expect(box.message).toContain("credential_missing");
		expect(box.message).toContain('"source":"x"');
	});

	it("source_rate_limited carries retryAfterSec when set", () => {
		const box = new CamoufoxErrorBox({
			type: "source_rate_limited",
			source: "reddit",
			retryAfterSec: 60,
		});
		expect((box.err as { retryAfterSec?: number }).retryAfterSec).toBe(60);
	});

	it("all_sources_failed nests per-source errors", () => {
		const box = new CamoufoxErrorBox({
			type: "all_sources_failed",
			errors: [
				{ source: "reddit", error: { type: "source_unavailable", source: "reddit" } },
				{ source: "hn", error: { type: "source_rate_limited", source: "hn" } },
			],
		});
		expect((box.err as { errors: unknown[] }).errors).toHaveLength(2);
	});

	it("credential_backend_unavailable carries backend identifier", () => {
		const box = new CamoufoxErrorBox({
			type: "credential_backend_unavailable",
			backend: "keyring",
			reason: "libsecret not installed",
		});
		expect(box.message).toContain("keyring");
	});

	it("credential_invalid serializes source and credentialKey", () => {
		const box = new CamoufoxErrorBox({
			type: "credential_invalid",
			source: "reddit",
			credentialKey: "session_cookie",
		});
		expect(box.err).toEqual({
			type: "credential_invalid",
			source: "reddit",
			credentialKey: "session_cookie",
		});
		expect(box.message).toContain("credential_invalid");
		expect(box.message).toContain('"source":"reddit"');
	});

	it("source_unavailable with cause appears in message", () => {
		const box = new CamoufoxErrorBox({
			type: "source_unavailable",
			source: "hn",
			cause: "connection refused",
		});
		expect(box.err).toEqual({
			type: "source_unavailable",
			source: "hn",
			cause: "connection refused",
		});
		expect(box.message).toContain("connection refused");
	});

	it("source_unavailable redacts sensitive cause", () => {
		const box = new CamoufoxErrorBox({
			type: "source_unavailable",
			source: "hn",
			cause: "ENOENT: /Users/alice/secrets.json",
		});
		expect(box.message).not.toContain("/Users/alice/secrets.json");
		expect(box.message).toContain("<redacted>");
	});

	it("all_sources_failed redacts sensitive cause nested inside errors[]", () => {
		const box = new CamoufoxErrorBox({
			type: "all_sources_failed",
			errors: [
				{
					source: "hn",
					error: {
						type: "source_unavailable",
						source: "hn",
						cause: "ENOENT: /Users/alice/secret",
					},
				},
			],
		});
		expect(box.message).not.toContain("/Users/alice/secret");
		expect(box.message).toContain("<redacted>");
	});

	it("source_rate_limited with retryAfterSec omitted has no retryAfterSec field", () => {
		const box = new CamoufoxErrorBox({
			type: "source_rate_limited",
			source: "reddit",
		});
		expect((box.err as { retryAfterSec?: number }).retryAfterSec).toBeUndefined();
	});
});
