import type { LookupAddress } from "node:dns";
import { promises as dns } from "node:dns";
import { isIPv6 } from "node:net";

// Private / loopback / link-local ranges for IPv4, expressed as [prefixInt, maskBits].
const IPV4_PRIVATE_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x7f000000, 8], // 127.0.0.0/8 loopback
	[0x0a000000, 8], // 10.0.0.0/8
	[0xac100000, 12], // 172.16.0.0/12
	[0xc0a80000, 16], // 192.168.0.0/16
	[0xa9fe0000, 16], // 169.254.0.0/16 link-local + AWS/GCP metadata
	[0x00000000, 8], // 0.0.0.0/8 unspecified
	[0x64400000, 10], // 100.64.0.0/10 CGNAT
	[0xf0000000, 4], // 240.0.0.0/4 reserved (future-use) — fail-safe
	[0xe0000000, 4], // 224.0.0.0/4 multicast
];

export function isPrivateIPv4Int(ip: number): boolean {
	const u = ip >>> 0;
	for (const [prefix, bits] of IPV4_PRIVATE_RANGES) {
		const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
		if ((u & mask) === (prefix & mask)) return true;
	}
	return false;
}

// Parse an IPv4 literal per WHATWG / Node rules: accepts alt encodings.
//   "127.0.0.1"          → 4-part decimal
//   "0x7f.0.0.1"         → hex octet
//   "0177.0.0.1"         → octal octet
//   "127.1"              → 2-part (last part absorbs trailing zeros)
//   "2130706433"         → single 32-bit integer
//   "0x7f000001"         → single hex integer
// Returns a 32-bit unsigned integer, or null if not a valid IPv4 literal.
export function parseIPv4(input: string): number | null {
	if (input.length === 0 || /[^0-9a-fA-Fx.oO]/.test(input)) return null;
	const parts = input.split(".");
	if (parts.length === 0 || parts.length > 4) return null;
	const nums: number[] = [];
	for (const raw of parts) {
		if (raw.length === 0) return null;
		let n: number;
		if (raw === "0") {
			n = 0;
		} else if (raw.startsWith("0x") || raw.startsWith("0X")) {
			const body = raw.slice(2);
			if (body.length === 0 || !/^[0-9a-fA-F]+$/.test(body)) return null;
			n = Number.parseInt(body, 16);
		} else if (raw.startsWith("0")) {
			const body = raw.slice(1);
			if (!/^[0-7]+$/.test(body)) return null;
			n = Number.parseInt(body, 8);
		} else {
			if (!/^[0-9]+$/.test(raw)) return null;
			n = Number.parseInt(raw, 10);
		}
		if (!Number.isFinite(n) || n < 0) return null;
		nums.push(n);
	}
	// Last part absorbs overflow into the lower bytes (WHATWG rule).
	const last = nums[nums.length - 1] ?? 0;
	const head = nums.slice(0, -1);
	// Each non-last part must fit in one octet.
	for (const n of head) {
		if (n > 0xff) return null;
	}
	// Last part must fit in the remaining byte width.
	const remainingBits = 32 - head.length * 8;
	if (remainingBits < 0 || remainingBits > 32) return null;
	const maxLast = remainingBits === 32 ? 0xffffffff : (1 << remainingBits) - 1;
	if (last > maxLast) return null;
	let ip = 0;
	for (const n of head) {
		ip = ((ip << 8) | (n & 0xff)) >>> 0;
	}
	ip = ((ip << remainingBits) | last) >>> 0;
	return ip;
}

// Parse an IPv6 literal (any valid form incl. ::, ::ffff:a.b.c.d) to 16 bytes.
// Returns null if not a valid IPv6 literal. Uses node:net.isIPv6 for validation,
// then expands compressed form manually.
export function parseIPv6(input: string): Uint8Array | null {
	if (!isIPv6(input)) return null;
	const s = input.toLowerCase();
	// Split on "::" (at most one occurrence by IPv6 rules).
	const doubleColon = s.indexOf("::");
	let headParts: string[];
	let tailParts: string[];
	if (doubleColon === -1) {
		headParts = s.split(":");
		tailParts = [];
	} else {
		const head = s.slice(0, doubleColon);
		const tail = s.slice(doubleColon + 2);
		headParts = head.length > 0 ? head.split(":") : [];
		tailParts = tail.length > 0 ? tail.split(":") : [];
	}
	// Detect trailing IPv4 in the last group of either head or tail.
	const expandIPv4Tail = (parts: string[]): string[] => {
		if (parts.length === 0) return parts;
		const last = parts[parts.length - 1] ?? "";
		if (!last.includes(".")) return parts;
		const v4 = parseIPv4(last);
		if (v4 === null) return parts;
		const hi = ((v4 >>> 16) & 0xffff).toString(16);
		const lo = (v4 & 0xffff).toString(16);
		return [...parts.slice(0, -1), hi, lo];
	};
	headParts = expandIPv4Tail(headParts);
	tailParts = expandIPv4Tail(tailParts);
	const groupCount = headParts.length + tailParts.length;
	if (groupCount > 8) return null;
	const fillCount = 8 - groupCount;
	const zeros = Array<string>(fillCount).fill("0");
	const allGroups = doubleColon === -1 ? headParts : [...headParts, ...zeros, ...tailParts];
	if (allGroups.length !== 8) return null;
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 8; i++) {
		const g = allGroups[i] ?? "0";
		if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
		const n = Number.parseInt(g, 16);
		bytes[i * 2] = (n >>> 8) & 0xff;
		bytes[i * 2 + 1] = n & 0xff;
	}
	return bytes;
}

function allZero(bytes: Uint8Array, start: number, end: number): boolean {
	for (let i = start; i < end; i++) {
		if ((bytes[i] ?? 0) !== 0) return false;
	}
	return true;
}

export function isPrivateIPv6Bytes(bytes: Uint8Array): boolean {
	// :: (unspecified) and ::1 (loopback)
	if (allZero(bytes, 0, 15)) {
		const last = bytes[15] ?? 0;
		if (last === 0 || last === 1) return true;
	}
	// fe80::/10 link-local
	if ((bytes[0] ?? 0) === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return true;
	// fc00::/7 unique-local
	if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return true;
	// ::ffff:0:0/96 IPv4-mapped
	if (allZero(bytes, 0, 10) && (bytes[10] ?? 0) === 0xff && (bytes[11] ?? 0) === 0xff) {
		const v4 =
			(((bytes[12] ?? 0) << 24) |
				((bytes[13] ?? 0) << 16) |
				((bytes[14] ?? 0) << 8) |
				(bytes[15] ?? 0)) >>>
			0;
		return isPrivateIPv4Int(v4);
	}
	// ::a.b.c.d (IPv4-compatible, deprecated) — treat as private when lower 32 bits are private
	if (allZero(bytes, 0, 12) && !allZero(bytes, 12, 16)) {
		const v4 =
			(((bytes[12] ?? 0) << 24) |
				((bytes[13] ?? 0) << 16) |
				((bytes[14] ?? 0) << 8) |
				(bytes[15] ?? 0)) >>>
			0;
		return isPrivateIPv4Int(v4);
	}
	// 64:ff9b::/96 NAT64 — check the embedded IPv4
	if (
		(bytes[0] ?? 0) === 0x00 &&
		(bytes[1] ?? 0) === 0x64 &&
		(bytes[2] ?? 0) === 0xff &&
		(bytes[3] ?? 0) === 0x9b &&
		allZero(bytes, 4, 12)
	) {
		const v4 =
			(((bytes[12] ?? 0) << 24) |
				((bytes[13] ?? 0) << 16) |
				((bytes[14] ?? 0) << 8) |
				(bytes[15] ?? 0)) >>>
			0;
		return isPrivateIPv4Int(v4);
	}
	return false;
}

export function isPrivateIPv4(ip: string): boolean {
	const n = parseIPv4(ip);
	if (n === null) return true; // malformed = fail-safe
	return isPrivateIPv4Int(n);
}

export function isPrivateIPv6(ip: string): boolean {
	const bytes = parseIPv6(ip);
	if (bytes === null) return true; // malformed = fail-safe
	return isPrivateIPv6Bytes(bytes);
}

export type LookupFn = typeof dns.lookup;

export async function assertSafeTarget(
	url: string,
	opts: { lookup?: LookupFn } = {},
): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error("SSRF: invalid URL");
	}
	// Scheme allowlist — defense-in-depth over the tool-layer TypeBox check.
	// file:, javascript:, data:, blob:, ws(s):, about:, chrome:, etc. are rejected.
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`SSRF: scheme ${parsed.protocol} is not allowed`);
	}
	// Node/WHATWG may or may not strip brackets on .hostname depending on
	// version — strip defensively so downstream parsers don't see "[::1]".
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
	// IPv6 literal
	if (isIPv6(hostname)) {
		if (isPrivateIPv6(hostname)) {
			throw new Error("SSRF: target is a private IPv6");
		}
		return;
	}
	// IPv4 literal (incl. alt-encodings via parseIPv4)
	const ipv4 = parseIPv4(hostname);
	if (ipv4 !== null) {
		if (isPrivateIPv4Int(ipv4)) {
			throw new Error("SSRF: target is a private IPv4");
		}
		return;
	}
	// Hostname — DNS-resolve every address and check each.
	const lookup = opts.lookup ?? dns.lookup;
	let addrs: LookupAddress[];
	try {
		const result = (await lookup(hostname, {
			all: true,
			verbatim: true,
		})) as LookupAddress[];
		addrs = result;
	} catch (err) {
		throw new Error(
			`SSRF: cannot resolve target: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
	for (const { address, family } of addrs) {
		if (family === 4) {
			const n = parseIPv4(address);
			if (n !== null && isPrivateIPv4Int(n)) {
				// Intentionally drop the resolved address from the message to
				// avoid topology disclosure. The hostname is caller-supplied
				// and not sensitive; the resolved IP can reveal internal network
				// layout if it ends up in logs.
				throw new Error("SSRF: hostname resolves to a private address");
			}
		}
		if (family === 6 && isPrivateIPv6(address)) {
			throw new Error("SSRF: hostname resolves to a private address");
		}
	}
}

// --- Cloud-metadata endpoint policy (sub-resource tier) -----------------------
// Sub-resource requests (images, scripts, XHR, WS, beacon) are not fully
// validated against all private ranges (that would both add DNS cost to every
// asset and produce a stealth-detectable abort pattern for internal-network
// assets). Instead, only the well-known cloud-metadata endpoints are blocked
// on sub-resources. These are the highest-value blind-SSRF targets.
const METADATA_HOSTNAMES: ReadonlySet<string> = new Set([
	"metadata.google.internal",
	"metadata", // GCP short alias
]);
// Each entry is a 32-bit int for IPv4 metadata literals.
const METADATA_IPV4_INTS: ReadonlySet<number> = new Set([
	0xa9fea9fe, // 169.254.169.254 AWS / GCP / Azure (IMDS)
	0x64646464, // 100.100.100.100 Alibaba (obsolete but still hit)
	0x6464c8c8, // 100.100.200.200 Alibaba
]);
// IPv6 metadata literals as expanded-form canonical strings
// (matches the output of canonicalIPv6).
const METADATA_IPV6_CANON: ReadonlySet<string> = new Set([
	"fd00:ec2:0:0:0:0:0:254", // AWS IMDS v2 over IPv6
]);

function canonicalIPv6(bytes: Uint8Array): string {
	const groups: string[] = [];
	for (let i = 0; i < 16; i += 2) {
		const n = ((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0);
		groups.push(n.toString(16));
	}
	return groups.join(":");
}

// Returns true if the URL targets a known cloud-metadata endpoint.
// Handles alt-encoded IPv4 and canonicalized IPv6. Designed for the guard's
// sub-resource tier — does NOT check general private ranges.
export function isMetadataEndpoint(url: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
	const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (METADATA_HOSTNAMES.has(host)) return true;
	if (isIPv6(host)) {
		const bytes = parseIPv6(host);
		if (!bytes) return false;
		const canon = canonicalIPv6(bytes);
		if (METADATA_IPV6_CANON.has(canon)) return true;
		// Also check IPv4-mapped metadata (e.g. ::ffff:169.254.169.254)
		if (allZero(bytes, 0, 10) && (bytes[10] ?? 0) === 0xff && (bytes[11] ?? 0) === 0xff) {
			const v4 =
				(((bytes[12] ?? 0) << 24) |
					((bytes[13] ?? 0) << 16) |
					((bytes[14] ?? 0) << 8) |
					(bytes[15] ?? 0)) >>>
				0;
			if (METADATA_IPV4_INTS.has(v4)) return true;
		}
		return false;
	}
	const v4 = parseIPv4(host);
	if (v4 !== null && METADATA_IPV4_INTS.has(v4)) return true;
	return false;
}
