import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

export interface LegacyOAuthProvider {
	name: string;
	login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
	refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
	getApiKey(credentials: OAuthCredentials): string;
}

interface CurrentOAuthProvider {
	login(interaction: {
		signal?: AbortSignal;
		notify(notification: Record<string, unknown>): void;
		prompt(prompt: Record<string, unknown>): Promise<string>;
	}): Promise<OAuthCredentials & { type?: string }>;
	refresh(
		credentials: OAuthCredentials & { type: "oauth" },
		signal?: AbortSignal,
	): Promise<OAuthCredentials & { type?: string }>;
}

/** Adapt a vendored current Pi OAuth flow to Pi's public extension callback API. */
export function createLegacyOAuthProvider(
	name: string,
	provider: CurrentOAuthProvider,
): LegacyOAuthProvider {
	return {
		name,
		async login(callbacks) {
			return provider.login({
				signal: callbacks.signal,
				notify(notification) {
					if (notification.type === "auth_url" && typeof notification.url === "string") {
						callbacks.onAuth({
							url: notification.url,
							instructions:
								typeof notification.instructions === "string" ? notification.instructions : undefined,
						});
						return;
					}
					if (notification.type === "device_code" && typeof notification.userCode === "string") {
						callbacks.onDeviceCode({
							userCode: notification.userCode,
							verificationUri: String(notification.verificationUri),
							intervalSeconds:
								typeof notification.intervalSeconds === "number"
									? notification.intervalSeconds
									: undefined,
							expiresInSeconds:
								typeof notification.expiresInSeconds === "number"
									? notification.expiresInSeconds
									: undefined,
						});
						return;
					}
					if (typeof notification.message === "string") callbacks.onProgress?.(notification.message);
				},
				async prompt(prompt) {
					if (prompt.type === "select" && Array.isArray(prompt.options)) {
						if (!callbacks.onSelect) {
							throw new Error("Pi does not support OAuth login-method selection.");
						}

						const options = prompt.options.flatMap((option) => {
							if (
								typeof option !== "object" ||
								option === null ||
								typeof (option as { id?: unknown }).id !== "string" ||
								typeof (option as { label?: unknown }).label !== "string"
							) {
								return [];
							}
							return [option as { id: string; label: string }];
						});
						const selected = await callbacks.onSelect({
							message: String(prompt.message ?? "Select an OAuth login method"),
							options,
						});
						if (selected === undefined) throw new Error("Login cancelled");
						return selected;
					}

					return callbacks.onPrompt({
						message: String(prompt.message ?? "Continue OAuth login"),
						placeholder: typeof prompt.placeholder === "string" ? prompt.placeholder : undefined,
					});
				},
			});
		},
		async refreshToken(credentials) {
			return provider.refresh({ ...credentials, type: "oauth" });
		},
		getApiKey(credentials) {
			return credentials.access;
		},
	};
}
