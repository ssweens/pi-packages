import { describe, expect, it } from "vitest";

import { makeNamespacedKey, parseNamespacedKey } from "../../../src/credentials/types.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";

describe("fake credential backend", () => {
	it("stores and retrieves values", async () => {
		const b = createFakeCredentialBackend();
		await b.set("camoufox-pi:reddit:token", "t1");
		expect(await b.get("camoufox-pi:reddit:token")).toBe("t1");
	});

	it("delete returns true if key existed, false otherwise", async () => {
		const b = createFakeCredentialBackend({ "camoufox-pi:a:b": "x" });
		expect(await b.delete("camoufox-pi:a:b")).toBe(true);
		expect(await b.delete("camoufox-pi:a:b")).toBe(false);
	});

	it("list returns only camoufox-pi:* keys", async () => {
		const b = createFakeCredentialBackend({
			"camoufox-pi:reddit:token": "t1",
			"other-service:foo": "x",
			"camoufox-pi:x:cookies": "c",
		});
		const keys = await b.list();
		expect(keys.sort()).toEqual(["camoufox-pi:reddit:token", "camoufox-pi:x:cookies"]);
	});
});

describe("namespaced keys", () => {
	it("composes and parses round-trip", () => {
		const full = makeNamespacedKey("reddit", "oauth_token");
		expect(full).toBe("camoufox-pi:reddit:oauth_token");
		expect(parseNamespacedKey(full)).toEqual({ source: "reddit", key: "oauth_token" });
	});

	it("rejects ':' in source or key", () => {
		expect(() => makeNamespacedKey("a:b", "k")).toThrow();
		expect(() => makeNamespacedKey("a", "k:v")).toThrow();
	});

	it("parse returns null for malformed", () => {
		expect(parseNamespacedKey("foo:bar")).toBeNull();
		expect(parseNamespacedKey("other:a:b")).toBeNull();
	});
});
