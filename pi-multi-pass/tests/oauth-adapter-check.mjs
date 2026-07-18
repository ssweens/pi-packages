import assert from "node:assert/strict";
import test from "node:test";
import { createLegacyOAuthProvider } from "../extensions/oauth-adapter.ts";

const credentials = { access: "access", refresh: "refresh", expires: 0 };
const loginMethodPrompt = {
  type: "select",
  message: "Select OpenAI Codex login method:",
  options: [
    { id: "browser", label: "Browser login (default)" },
    { id: "device_code", label: "Device code login (headless)" },
  ],
};

function createCallbacks(onSelect) {
  return {
    onAuth() {},
    onDeviceCode() {},
    onPrompt: async () => assert.fail("Text prompt must not handle a select prompt"),
    onSelect,
  };
}

for (const selectedMethod of ["browser", "device_code"]) {
  test(`Codex ${selectedMethod} login selection reaches the OAuth provider`, async () => {
    const provider = createLegacyOAuthProvider("ChatGPT Codex", {
      async login(interaction) {
        assert.equal(await interaction.prompt(loginMethodPrompt), selectedMethod);
        return credentials;
      },
      async refresh(credential) {
        return credential;
      },
    });
    const selectedPrompts = [];

    assert.deepEqual(
      await provider.login(
        createCallbacks(async (prompt) => {
          selectedPrompts.push(prompt);
          return selectedMethod;
        }),
      ),
      credentials,
    );
    assert.deepEqual(selectedPrompts, [
      {
        message: "Select OpenAI Codex login method:",
        options: loginMethodPrompt.options,
      },
    ]);
  });
}

test("Codex login cancellation does not pass an invalid method to OAuth", async () => {
  const provider = createLegacyOAuthProvider("ChatGPT Codex", {
    async login(interaction) {
      await interaction.prompt(loginMethodPrompt);
      assert.fail("OAuth provider must not receive a method after cancellation");
    },
    async refresh(credential) {
      return credential;
    },
  });

  await assert.rejects(provider.login(createCallbacks(async () => undefined)), /Login cancelled/);
});
