import type { CredentialBackend } from "../credentials/backend.js";

export interface CredentialsConfig {
	readonly backend?: "keyring" | "custom";
	readonly customBackend?: CredentialBackend;
}
