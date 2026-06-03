export const CREDENTIAL_SERVICE_NAME = "camoufox-pi";

export type CredentialKind = "api_key" | "bearer_token" | "app_password" | "cookie_jar";

export interface CredentialSpec {
	readonly kind: CredentialKind;
	/** Short identifier within the adapter's namespace. Colon-safe. */
	readonly key: string;
	readonly description: string;
	/** URL the user visits to acquire this credential. For cookie_jar this is the site's login URL. */
	readonly obtainUrl?: string;
	readonly loginUrl?: string;
}

export function makeNamespacedKey(source: string, key: string): string {
	if (source.includes(":") || key.includes(":")) {
		throw new Error(`credential key parts cannot contain ':' (got source=${source}, key=${key})`);
	}
	return `${CREDENTIAL_SERVICE_NAME}:${source}:${key}`;
}

export function parseNamespacedKey(full: string): { source: string; key: string } | null {
	const parts = full.split(":");
	if (parts.length !== 3) return null;
	if (parts[0] !== CREDENTIAL_SERVICE_NAME) return null;
	return { source: parts[1] ?? "", key: parts[2] ?? "" };
}
