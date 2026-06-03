import { describe, expect, it } from "vitest";

import { createCredentialReader } from "../../../src/credentials/reader.js";
import { CamoufoxErrorBox } from "../../../src/errors.js";
import { createFakeCredentialBackend } from "../../helpers/fake-credential-backend.js";

describe("CredentialReader (scoped)", () => {
	it("reads within its namespace", async () => {
		const backend = createFakeCredentialBackend({
			"camoufox-pi:reddit:token": "t1",
		});
		const reader = createCredentialReader(backend, "reddit");
		expect(await reader.get("token")).toBe("t1");
	});

	it("returns null for missing credential (get)", async () => {
		const backend = createFakeCredentialBackend();
		const reader = createCredentialReader(backend, "reddit");
		expect(await reader.get("nope")).toBeNull();
	});

	it("require() throws credential_missing for missing", async () => {
		const backend = createFakeCredentialBackend();
		const reader = createCredentialReader(backend, "reddit");
		await expect(reader.require("nope")).rejects.toBeInstanceOf(CamoufoxErrorBox);
		try {
			await reader.require("nope");
		} catch (err) {
			expect((err as CamoufoxErrorBox).err).toEqual({
				type: "credential_missing",
				source: "reddit",
				credentialKey: "nope",
			});
		}
	});

	it("cannot read cross-namespace credentials", async () => {
		const backend = createFakeCredentialBackend({
			"camoufox-pi:x:cookies": "session",
		});
		const reader = createCredentialReader(backend, "reddit");
		expect(await reader.get("cookies")).toBeNull();
	});

	it("JSON-decodes when kind is cookie_jar and raises credential_invalid on bad JSON", async () => {
		const backend = createFakeCredentialBackend({
			"camoufox-pi:x:cookies": "{not json",
		});
		const reader = createCredentialReader(backend, "x");
		await expect(reader.getJson("cookies")).rejects.toMatchObject({
			err: { type: "credential_invalid", source: "x", credentialKey: "cookies" },
		});
	});
});
