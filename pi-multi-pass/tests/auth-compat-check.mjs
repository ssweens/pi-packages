import assert from "node:assert/strict";
import { createAuthStorageFacade } from "../extensions/auth-compat.ts";
import { createLegacyOAuthProvider } from "../extensions/oauth-adapter.ts";

function createModernRegistry(configured) {
	const logoutCalls = [];
	return {
		registry: {
			getProviderAuthStatus(provider) {
				return { configured: configured.has(provider) };
			},
			runtime: {
				async logout(provider) {
					logoutCalls.push(provider);
				},
			},
		},
		logoutCalls,
	};
}

{
	const storedCredential = { type: "oauth", access: "access-token" };
	const { registry, logoutCalls } = createModernRegistry(new Set(["anthropic-2", "api-key"]));
	const facade = createAuthStorageFacade(registry, (provider) =>
		provider === "anthropic-2" ? storedCredential : undefined,
	);

	assert.equal(facade.hasAuth("anthropic-2"), true);
	assert.equal(facade.hasAuth("api-key"), true);
	assert.deepEqual(facade.get("anthropic-2"), storedCredential);
	assert.equal(await facade.logout("anthropic-2"), true);
	assert.deepEqual(logoutCalls, ["anthropic-2"]);
	assert.equal(await facade.logout("api-key"), false);
	assert.deepEqual(logoutCalls, ["anthropic-2"]);
}

{
	const logoutCalls = [];
	const legacyStorage = {
		hasAuth: (provider) => provider === "openai-codex-2",
		get: (provider) => (provider === "openai-codex-2" ? { type: "oauth" } : undefined),
		logout: (provider) => logoutCalls.push(provider),
	};
	const facade = createAuthStorageFacade({ authStorage: legacyStorage }, () => undefined);

	assert.equal(facade.hasAuth("openai-codex-2"), true);
	assert.deepEqual(facade.get("openai-codex-2"), { type: "oauth" });
	assert.equal(await facade.logout("openai-codex-2"), true);
	assert.equal(await facade.logout("anthropic-2"), false);
	assert.deepEqual(logoutCalls, ["openai-codex-2"]);
}

{
	const notifications = [];
	const prompts = [];
	const provider = createLegacyOAuthProvider("Test OAuth", {
		async login(interaction) {
			interaction.notify({ type: "auth_url", url: "https://example.test/auth" });
			interaction.notify({
				type: "device_code",
				userCode: "ABCD-1234",
				verificationUri: "https://example.test/device",
			});
			await interaction.prompt({ message: "Paste code", placeholder: "code" });
			return { type: "oauth", access: "access", refresh: "refresh", expires: 1 };
		},
		async refresh(credentials) {
			assert.equal(credentials.type, "oauth");
			return { ...credentials, access: "refreshed" };
		},
	});
	const callbacks = {
		onAuth: (value) => notifications.push(["auth", value.url]),
		onDeviceCode: (value) => notifications.push(["device", value.userCode]),
		onPrompt: async (value) => {
			prompts.push(value);
			return "code";
		},
	};
	assert.equal((await provider.login(callbacks)).access, "access");
	assert.deepEqual(notifications, [["auth", "https://example.test/auth"], ["device", "ABCD-1234"]]);
	assert.deepEqual(prompts, [{ message: "Paste code", placeholder: "code" }]);
	assert.equal((await provider.refreshToken({ access: "access", refresh: "refresh", expires: 1 })).access, "refreshed");
}

assert.throws(
	() => createAuthStorageFacade({ getProviderAuthStatus: () => ({ configured: true }) }, () => undefined),
	/ModelRuntime logout bridge/,
);

console.log("auth compatibility checks passed");
