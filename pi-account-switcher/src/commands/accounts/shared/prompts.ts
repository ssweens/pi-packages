import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { AccountConfig, ProviderConfig, SecretSource } from "@/types";
import { commonUtil, providerUtil, uiUtil } from "@/utils";
import { ACCOUNTS_PATH } from "@/constants";

export const SECRET_SOURCE_CHOICES = {
  literal: "Paste API key now (stored in config)",
  env: "Read from existing environment variable",
  file: "Read from file",
  command: "Run shell command",
  op: "1Password op reference",
} as const;

const SECRET_SOURCE_CHOICE_LABELS = Object.values(SECRET_SOURCE_CHOICES);

const LABEL_TO_SOURCE_TYPE = new Map(
  (Object.entries(SECRET_SOURCE_CHOICES) as [keyof typeof SECRET_SOURCE_CHOICES, string][]).map(([k, v]) => [v, k]),
);

export class AccountConfigBuilder {
  private readonly prompt: ReturnType<typeof uiUtil.prompt>;
  private config: Partial<AccountConfig> = {};
  private customProvider?: ProviderConfig;

  constructor(
    private readonly ui: ExtensionUIContext,
    private readonly customProviders: ProviderConfig[] = [],
    original?: Partial<AccountConfig>,
  ) {
    this.prompt = uiUtil.prompt(ui);
    if (original) {
      this.config = { ...original };
      if (original.provider) {
        this.customProvider = providerUtil.findProvider(original.provider, customProviders);
      }
    }
  }

  async withProvider(): Promise<this> {
    const choices = providerUtil.providerChoices(this.customProviders);
    const choice = await uiUtil.filteredSelect(this.ui, "Provider", choices);
    if (!choice) return this;

    const raw = choice === "custom" ? await this.prompt("Custom provider", "provider-id").asText() : choice;
    const provider = providerUtil.normalizeProvider(raw ?? "");
    // If provider is empty (user cancelled), return early. collect() will detect missing provider and return undefined.
    if (!provider) return this;

    this.config.provider = provider;
    this.customProvider = providerUtil.findProvider(provider, this.customProviders);

    return this;
  }

  async withLabel(): Promise<this> {
    const hint = this.config.label ?? `${this.config.provider ?? ""} — Work`;
    const label = await this.prompt("Account label", hint).asText();
    if (!label) {
      if (!this.config.label) throw new Error("Account label is required");
      return this;
    }
    this.config.label = label;

    return this;
  }

  async withId(): Promise<this> {
    const suggested = commonUtil.slugify(this.config.label ?? "");
    const hint = this.config.id ?? suggested;
    const id = (await this.prompt("Account id", hint).asText()) || hint;
    if (!id) {
      throw new Error("Account id is required");
    }
    this.config.id = id;

    return this;
  }

  async withModel(): Promise<this> {
    if (!this.customProvider) {
      return this;
    }

    const modelIds = (this.customProvider.models ?? []).map((m) => m.id);
    if (modelIds.length === 0) {
      this.config.model = await this.prompt("Default model for this account (optional)", this.config.model).asText();
      return this;
    }

    const choice = await uiUtil.filteredSelect(this.ui, "Default model for this account", [
      "Use current model",
      ...modelIds,
      "custom",
    ]);
    if (!choice || choice === "Use current model") return this;

    this.config.model = choice === "custom" ? await this.prompt("Model id", modelIds[0]).asText() : choice;

    return this;
  }

  async withCredentials(): Promise<this> {
    const { provider } = this.config;
    if (!provider) return this;

    const hasExistingCredentials =
      !!this.config.env || !!this.config.providerApiKey || !!this.config.usesProviderApiKey || !!this.config.piAuth;

    if (this.customProvider) {
      const apiKey = await this.promptForCustomProviderApiKey(this.customProvider);
      if (apiKey) {
        this.config.providerApiKey = apiKey;
        return this;
      }
      if (!hasExistingCredentials) {
        if (this.customProvider.apiKey) {
          this.config.usesProviderApiKey = true;
          return this;
        }
      } else {
        // Has existing credentials — fall through to let user choose "keep current" or update
      }
    }

    const envKeys = providerUtil.requiredEnvKeysForProvider(provider, this.customProviders);
    const envChoice = await this.ui.select("Credential env var", [
      ...envKeys,
      "custom",
      ...(hasExistingCredentials ? ["keep current"] : []),
    ]);
    if (!envChoice || envChoice === "keep current") return this;

    const envName = envChoice === "custom" ? await this.prompt("Env var name", "PROVIDER_API_KEY").asText() : envChoice;
    if (!envName) throw new Error("Env var name is required");

    const sourceLabel = await this.ui.select("How should Pi load this credential?", SECRET_SOURCE_CHOICE_LABELS);
    if (!sourceLabel) return this;

    const sourceType = LABEL_TO_SOURCE_TYPE.get(sourceLabel);
    if (!sourceType) return this;

    const source = await this.promptForSecretSource(sourceType);
    if (source) {
      this.config.env = { ...this.config.env, [envName]: source };
    }

    return this;
  }

  build(): AccountConfig {
    const { id, label, provider } = this.config;
    if (!id || !label || !provider) throw new Error("Account id, label, and provider are required");

    return {
      id,
      label,
      provider,
      ...(this.config.model ? { model: this.config.model } : {}),
      ...(this.config.env ? { env: this.config.env } : {}),
      ...(this.config.providerApiKey ? { providerApiKey: this.config.providerApiKey } : {}),
      ...(this.config.usesProviderApiKey ? { usesProviderApiKey: true } : {}),
      ...(this.config.piAuth ? { piAuth: this.config.piAuth } : {}),
    };
  }

  /**
   * Collect account configuration interactively.
   * @param isEdit - When true, allows keeping existing credentials without re-entering them.
   *                 Empty input for most fields will preserve the current value.
   */
  async collect(isEdit = false): Promise<AccountConfig | undefined> {
    await this.withProvider();
    if (!this.config.provider) return undefined;

    await this.withLabel();
    await this.withId();
    await this.withModel();
    await this.withCredentials();

    if (
      !isEdit &&
      !this.config.env &&
      !this.config.providerApiKey &&
      !this.config.usesProviderApiKey &&
      !this.config.piAuth
    ) {
      this.ui.notify("No credentials configured. Account not saved.", "info");
      return undefined;
    }

    return this.build();
  }

  private async promptForSecretSource(type: keyof typeof SECRET_SOURCE_CHOICES): Promise<SecretSource | undefined> {
    switch (type) {
      case "literal": {
        const ok = await this.ui.confirm(
          "Store API key in config?",
          `This will write the API key to ${ACCOUNTS_PATH} as plain text. Continue?`,
        );
        if (!ok) return undefined;

        const value = await this.prompt("API key", "sk-...").asText();
        if (!value) throw new Error("API key is required");

        return { type: "literal", value };
      }
      case "env": {
        const name = await this.prompt("Source environment variable", "MY_API_KEY").asText();
        if (!name) throw new Error("Source environment variable is required");

        return { type: "env", name };
      }
      case "file": {
        const path = await this.prompt("Secret file path", "~/.keys/provider-account.txt").asText();
        if (!path) throw new Error("File path is required");

        return { type: "file", path };
      }
      case "command": {
        const command = await this.prompt("Command", "op read op://AI/Account/api-key").asText();
        if (!command) throw new Error("Command is required");

        return { type: "command", command };
      }
      case "op": {
        const reference = await this.prompt("1Password reference", "op://AI/Account/api-key").asText();
        if (!reference) throw new Error("1Password reference is required");

        return { type: "op", reference };
      }
    }
  }

  private async promptForCustomProviderApiKey(provider: ProviderConfig): Promise<SecretSource | undefined> {
    if (!provider.baseUrl && !provider.models?.length && !provider.apiKey) {
      return undefined;
    }

    const hint = provider.apiKey ? "blank = provider apiKey" : "sk-...";
    const value = await this.prompt("Account API key override (blank uses provider apiKey)", hint).asText();
    if (!value) return undefined;

    const ok = await this.ui.confirm(
      "Store API key in account config?",
      `This will write the API key to ${ACCOUNTS_PATH} as plain text. Continue?`,
    );
    return ok ? { type: "literal", value } : undefined;
  }
}
