import { CamoufoxErrorBox } from "../errors.js";
import type { CredentialBackend } from "./backend.js";
import { makeNamespacedKey } from "./types.js";

export interface CredentialReader {
	get(credentialKey: string): Promise<string | null>;
	require(credentialKey: string): Promise<string>;
	getJson<T = unknown>(credentialKey: string): Promise<T | null>;
	requireJson<T = unknown>(credentialKey: string): Promise<T>;
}

export function createCredentialReader(
	backend: CredentialBackend,
	source: string,
): CredentialReader {
	const toFull = (k: string): string => makeNamespacedKey(source, k);
	const reader: CredentialReader = {
		async get(credentialKey) {
			return backend.get(toFull(credentialKey));
		},
		async require(credentialKey) {
			const value = await backend.get(toFull(credentialKey));
			if (value === null) {
				throw new CamoufoxErrorBox({
					type: "credential_missing",
					source,
					credentialKey,
				});
			}
			return value;
		},
		async getJson(credentialKey) {
			const raw = await backend.get(toFull(credentialKey));
			if (raw === null) return null;
			try {
				return JSON.parse(raw);
			} catch {
				throw new CamoufoxErrorBox({
					type: "credential_invalid",
					source,
					credentialKey,
				});
			}
		},
		async requireJson<T = unknown>(credentialKey: string) {
			const value = await reader.getJson<T>(credentialKey);
			if (value === null) {
				throw new CamoufoxErrorBox({
					type: "credential_missing",
					source,
					credentialKey,
				});
			}
			return value;
		},
	};
	return reader;
}
