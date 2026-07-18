export interface AuthStorageFacade {
	hasAuth(provider: string): boolean;
	get(provider: string): unknown;
	logout(provider: string): Promise<boolean>;
}

interface LegacyAuthStorage {
	hasAuth(provider: string): boolean;
	get(provider: string): unknown;
	logout(provider: string): void | Promise<void>;
}

interface ModernModelRegistry {
	getProviderAuthStatus(provider: string): { configured: boolean };
}

interface ModelRuntimeWithLogout {
	logout(provider: string): Promise<void>;
}

type CompatibleModelRegistry = ModernModelRegistry & {
	authStorage?: LegacyAuthStorage;
	/** Pi 0.80.8+ keeps this runtime private in TypeScript but present at runtime. */
	runtime?: ModelRuntimeWithLogout;
};

function isLegacyAuthStorage(value: unknown): value is LegacyAuthStorage {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as LegacyAuthStorage).hasAuth === "function" &&
		typeof (value as LegacyAuthStorage).get === "function" &&
		typeof (value as LegacyAuthStorage).logout === "function"
	);
}

/**
 * Bridges Pi's pre-0.80.8 AuthStorage API and its current ModelRuntime API.
 *
 * Current Pi exposes credential status through ModelRegistry but keeps the
 * canonical ModelRuntime (and its safe, lock-aware logout) behind the
 * registry facade. Do not replace this with direct auth.json writes: that
 * leaves the running runtime authenticated and can race token refreshes.
 */
export function createAuthStorageFacade(
	modelRegistry: CompatibleModelRegistry,
	readStoredCredential: (provider: string) => unknown,
): AuthStorageFacade {
	const legacy = modelRegistry.authStorage;
	if (isLegacyAuthStorage(legacy)) {
		return {
			hasAuth: (provider) => legacy.hasAuth(provider),
			get: (provider) => legacy.get(provider),
			async logout(provider) {
				if (!legacy.hasAuth(provider)) return false;
				await legacy.logout(provider);
				return true;
			},
		};
	}

	const runtime = modelRegistry.runtime;
	if (!runtime || typeof runtime.logout !== "function") {
		throw new Error(
			"pi-multi-pass requires Pi's ModelRuntime logout bridge. Update Pi or use a Pi version that exposes ModelRegistry.authStorage.",
		);
	}

	return {
		hasAuth: (provider) => modelRegistry.getProviderAuthStatus(provider).configured,
		get: (provider) => readStoredCredential(provider),
		async logout(provider) {
			// Environment, runtime, and models.json credentials are configured but
			// cannot be revoked by an OAuth logout. Do not claim that they were.
			if (!readStoredCredential(provider)) return false;
			await runtime.logout(provider);
			return true;
		},
	};
}
