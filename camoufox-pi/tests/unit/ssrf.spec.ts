import { describe, expect, it } from "vitest";

import {
	type LookupFn,
	assertSafeTarget,
	isMetadataEndpoint,
	isPrivateIPv4,
	isPrivateIPv6,
	parseIPv4,
	parseIPv6,
} from "../../src/security/ssrf.js";

describe("assertSafeTarget — scheme allowlist (C1)", () => {
	it("rejects file:", async () => {
		await expect(assertSafeTarget("file:///etc/passwd")).rejects.toThrow(/scheme/);
	});
	it("rejects javascript:", async () => {
		await expect(assertSafeTarget("javascript:alert(1)")).rejects.toThrow(/scheme/);
	});
	it("rejects data:", async () => {
		await expect(assertSafeTarget("data:text/html,<script>")).rejects.toThrow(/scheme/);
	});
	it("rejects about:", async () => {
		await expect(assertSafeTarget("about:blank")).rejects.toThrow(/scheme/);
	});
	it("rejects ws:", async () => {
		await expect(assertSafeTarget("ws://example.com/")).rejects.toThrow(/scheme/);
	});
	it("rejects blob: and chrome:", async () => {
		await expect(assertSafeTarget("blob:https://example.com/x")).rejects.toThrow(/scheme/);
		await expect(assertSafeTarget("chrome://settings")).rejects.toThrow(/scheme/);
	});
});

describe("assertSafeTarget — literal IPs", () => {
	it("allows public IPv4 literals", async () => {
		await expect(assertSafeTarget("https://1.1.1.1/")).resolves.toBeUndefined();
		await expect(assertSafeTarget("https://8.8.8.8/")).resolves.toBeUndefined();
	});

	it("allows public IPv6 literals", async () => {
		await expect(assertSafeTarget("https://[2001:4860:4860::8888]/")).resolves.toBeUndefined();
	});

	it("rejects IPv4 loopback", async () => {
		await expect(assertSafeTarget("http://127.0.0.1/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects IPv4 RFC1918", async () => {
		await expect(assertSafeTarget("http://10.0.0.1/")).rejects.toThrow(/private IPv4/);
		await expect(assertSafeTarget("http://192.168.1.1/")).rejects.toThrow(/private IPv4/);
		await expect(assertSafeTarget("http://172.16.0.1/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects AWS/GCP metadata endpoint", async () => {
		await expect(assertSafeTarget("http://169.254.169.254/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects 0.0.0.0/8", async () => {
		await expect(assertSafeTarget("http://0.0.0.0/")).rejects.toThrow(/private IPv4/);
	});

	it("rejects IPv6 loopback", async () => {
		await expect(assertSafeTarget("http://[::1]/")).rejects.toThrow(/private IPv6/);
	});

	it("rejects IPv6 link-local", async () => {
		await expect(assertSafeTarget("http://[fe80::1]/")).rejects.toThrow(/private IPv6/);
	});

	it("rejects IPv6 unique-local", async () => {
		await expect(assertSafeTarget("http://[fc00::1]/")).rejects.toThrow(/private IPv6/);
	});
});

describe("assertSafeTarget — DNS lookup", () => {
	it("allows hostnames that resolve to public IPv4", async () => {
		const lookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://example.com/", { lookup })).resolves.toBeUndefined();
	});

	it("rejects hostnames that resolve to private IPv4", async () => {
		const lookup = (async () => [{ address: "127.0.0.1", family: 4 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://localhost-alias.test/", { lookup })).rejects.toThrow(
			/private address/,
		);
	});

	it("rejects hostnames that resolve to private IPv6", async () => {
		const lookup = (async () => [{ address: "::1", family: 6 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://localhost6-alias.test/", { lookup })).rejects.toThrow(
			/private address/,
		);
	});

	it("rejects if DNS resolution fails", async () => {
		const lookup = (async () => {
			throw new Error("ENOTFOUND");
		}) as unknown as LookupFn;
		await expect(assertSafeTarget("https://doesnotexist.invalid/", { lookup })).rejects.toThrow(
			/cannot resolve/,
		);
	});

	it("rejects if ANY resolved address is private (multi-address)", async () => {
		const lookup = (async () => [
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.1", family: 4 },
		]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://mixed.test/", { lookup })).rejects.toThrow(
			/private address/,
		);
	});

	it("does NOT leak the resolved IP in the error message (topology hiding)", async () => {
		const lookup = (async () => [{ address: "10.1.2.3", family: 4 }]) as unknown as LookupFn;
		await expect(assertSafeTarget("https://alias.test/", { lookup })).rejects.toThrow(
			/private address/,
		);
		// Negative check: ensure the internal IP is NOT surfaced.
		await expect(assertSafeTarget("https://alias.test/", { lookup })).rejects.not.toThrow(
			/10\.1\.2\.3/,
		);
	});
});

describe("parseIPv4 — WHATWG-style encodings (C2)", () => {
	it("parses dotted decimal", () => {
		expect(parseIPv4("127.0.0.1")).toBe(0x7f000001);
		expect(parseIPv4("8.8.8.8")).toBe(0x08080808);
	});
	it("parses 1-part decimal", () => {
		expect(parseIPv4("2130706433")).toBe(0x7f000001); // 127.0.0.1
	});
	it("parses 2-part short form", () => {
		expect(parseIPv4("127.1")).toBe(0x7f000001); // 127.0.0.1
	});
	it("parses hex octets (C2 bypass)", () => {
		expect(parseIPv4("0x7f.0.0.1")).toBe(0x7f000001);
		expect(parseIPv4("0x7F000001")).toBe(0x7f000001);
	});
	it("parses octal octets (C2 bypass)", () => {
		expect(parseIPv4("0177.0.0.1")).toBe(0x7f000001);
	});
	it("rejects malformed inputs", () => {
		expect(parseIPv4("")).toBeNull();
		expect(parseIPv4("a.b.c.d")).toBeNull();
		expect(parseIPv4("256.0.0.1")).toBeNull();
		expect(parseIPv4("1.2.3.4.5")).toBeNull();
		expect(parseIPv4("0xgg")).toBeNull();
		expect(parseIPv4("089")).toBeNull(); // 8/9 not valid octal
	});
});

describe("assertSafeTarget — IPv4 alt-encodings (C2)", () => {
	it("rejects hex-encoded loopback", async () => {
		await expect(assertSafeTarget("http://0x7f.0.0.1/")).rejects.toThrow(/private IPv4/);
	});
	it("rejects decimal-integer loopback", async () => {
		await expect(assertSafeTarget("http://2130706433/")).rejects.toThrow(/private IPv4/);
	});
	it("rejects octal loopback", async () => {
		await expect(assertSafeTarget("http://0177.0.0.1/")).rejects.toThrow(/private IPv4/);
	});
	it("rejects 2-part short-form loopback", async () => {
		await expect(assertSafeTarget("http://127.1/")).rejects.toThrow(/private IPv4/);
	});
	it("rejects hex-encoded AWS metadata", async () => {
		await expect(assertSafeTarget("http://0xa9fea9fe/")).rejects.toThrow(/private IPv4/);
	});
});

describe("parseIPv6 (C3)", () => {
	it("parses full form", () => {
		const b = parseIPv6("2001:0db8:0000:0000:0000:0000:0000:0001");
		expect(b?.[0]).toBe(0x20);
		expect(b?.[15]).toBe(0x01);
	});
	it("parses compressed ::", () => {
		const b = parseIPv6("::1");
		expect(b).not.toBeNull();
		expect(b?.[15]).toBe(0x01);
	});
	it("parses IPv4-mapped ::ffff:a.b.c.d", () => {
		const b = parseIPv6("::ffff:127.0.0.1");
		expect(b?.[10]).toBe(0xff);
		expect(b?.[11]).toBe(0xff);
		expect(b?.[12]).toBe(127);
		expect(b?.[15]).toBe(1);
	});
	it("rejects invalid", () => {
		expect(parseIPv6("not:ipv6")).toBeNull();
		expect(parseIPv6("1.2.3.4")).toBeNull();
	});
});

describe("assertSafeTarget — IPv6 edge cases (C3)", () => {
	it("rejects IPv4-mapped loopback ::ffff:7f00:1", async () => {
		await expect(assertSafeTarget("http://[::ffff:7f00:1]/")).rejects.toThrow(/private IPv6/);
	});
	it("rejects IPv4-mapped loopback dotted form ::ffff:127.0.0.1", async () => {
		await expect(assertSafeTarget("http://[::ffff:127.0.0.1]/")).rejects.toThrow(/private IPv6/);
	});
	it("rejects IPv4-compatible ::127.0.0.1", async () => {
		await expect(assertSafeTarget("http://[::127.0.0.1]/")).rejects.toThrow(/private IPv6/);
	});
	it("rejects unspecified ::", async () => {
		await expect(assertSafeTarget("http://[::]/")).rejects.toThrow(/private IPv6/);
	});
	it("rejects NAT64 embedding a private IPv4", async () => {
		// 64:ff9b::169.254.169.254
		await expect(assertSafeTarget("http://[64:ff9b::a9fe:a9fe]/")).rejects.toThrow(/private IPv6/);
	});
});

describe("isPrivateIPv4 / isPrivateIPv6 — helpers", () => {
	it("isPrivateIPv4 fails safe on malformed", () => {
		expect(isPrivateIPv4("not-an-ip")).toBe(true);
	});
	it("isPrivateIPv6 fails safe on malformed", () => {
		expect(isPrivateIPv6("not-an-ip")).toBe(true);
	});
});

describe("isMetadataEndpoint — tiered sub-resource policy", () => {
	it("recognizes AWS/GCP/Azure IMDS literal", () => {
		expect(isMetadataEndpoint("http://169.254.169.254/latest/")).toBe(true);
	});
	it("recognizes IMDS via hex encoding", () => {
		expect(isMetadataEndpoint("http://0xa9fea9fe/")).toBe(true);
	});
	it("recognizes GCP metadata hostname", () => {
		expect(isMetadataEndpoint("http://metadata.google.internal/")).toBe(true);
	});
	it("recognizes AWS IPv6 IMDS", () => {
		expect(isMetadataEndpoint("http://[fd00:ec2::254]/")).toBe(true);
	});
	it("recognizes IPv4-mapped IMDS", () => {
		expect(isMetadataEndpoint("http://[::ffff:a9fe:a9fe]/")).toBe(true);
	});
	it("ignores other private IPs (not metadata)", () => {
		expect(isMetadataEndpoint("http://10.0.0.1/")).toBe(false);
		expect(isMetadataEndpoint("http://127.0.0.1/")).toBe(false);
	});
	it("ignores public IPs and hostnames", () => {
		expect(isMetadataEndpoint("https://example.com/")).toBe(false);
		expect(isMetadataEndpoint("https://1.1.1.1/")).toBe(false);
	});
	it("ignores non-http(s) schemes", () => {
		expect(isMetadataEndpoint("data:text/plain,169.254.169.254")).toBe(false);
	});
});
