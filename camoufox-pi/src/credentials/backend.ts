export interface CredentialBackend {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<boolean>;
	/** Returns keys matching the `camoufox-pi:` prefix only. */
	list(): Promise<string[]>;
}
