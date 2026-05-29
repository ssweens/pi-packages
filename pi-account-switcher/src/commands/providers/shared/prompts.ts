import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import type { ProviderApi, ProviderConfig } from "@/types";
import { PROVIDER_API_TYPES } from "@/constants";
import { providerUtil, uiUtil } from "@/utils";

const DEFAULTS = {
  id: "my-provider",
  baseUrl: "https://api.example.com/v1",
  api: "openai-completions",
  envKey: "PROVIDER_API_KEY",
} as const;

export class ProviderConfigBuilder {
  private readonly prompt: ReturnType<typeof uiUtil.prompt>;
  private readonly defaults: {
    id: string;
    label?: string;
    baseUrl: string;
    api: string;
    apiKey?: string;
    envKeys?: string[];
    aliases: string[];
    models?: ProviderConfig["models"];
    compat?: ProviderConfig["compat"];
    piAuthProvider?: string;
  };

  private config: Partial<ProviderConfig> = {};

  constructor(
    private readonly ui: ExtensionUIContext,
    original?: ProviderConfig,
  ) {
    this.prompt = uiUtil.prompt(ui);
    this.defaults = {
      id: original?.id ?? DEFAULTS.id,
      label: original?.label ?? original?.name,
      baseUrl: original?.baseUrl ?? DEFAULTS.baseUrl,
      api: original?.api ?? DEFAULTS.api,
      apiKey: original?.apiKey,
      envKeys: original?.envKeys,
      aliases: original?.aliases ?? [],
      models: original?.models,
      compat: original?.compat,
      piAuthProvider: original?.piAuthProvider,
    };
  }

  async withId(): Promise<this> {
    const raw = await this.prompt("Provider id", this.defaults.id).asText();
    this.config.id = providerUtil.normalizeProvider(raw || this.defaults.id);
    if (!this.config.id) throw new Error("Provider id is required");
    return this;
  }

  async withLabel(): Promise<this> {
    const id = this.config.id ?? "";
    const hint = this.defaults.label ?? id;
    this.config.label = (await this.prompt("Provider label", hint).asText()) ?? hint;
    return this;
  }

  async withBaseUrl(): Promise<this> {
    this.config.baseUrl =
      (await this.prompt("Base URL (blank for account-only provider)", this.defaults.baseUrl).asText()) ??
      this.defaults.baseUrl;
    return this;
  }

  async withApi(): Promise<this> {
    const current = this.defaults.api ?? DEFAULTS.api;
    const options = (PROVIDER_API_TYPES as readonly string[]).includes(current)
      ? [...PROVIDER_API_TYPES]
      : [current, ...PROVIDER_API_TYPES];
    this.config.api = (await uiUtil.filteredSelect(this.ui, "Pi API type", options)) ?? current;
    return this;
  }

  async withApiKey(): Promise<this> {
    const id = this.config.id ?? "";
    const hint = this.defaults.apiKey ?? `${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
    this.config.apiKey =
      (await this.prompt("Pi apiKey env var/name or raw key", hint).asText()) ?? this.defaults.apiKey;
    return this;
  }

  async withEnvKeys(): Promise<this> {
    const { apiKey } = this.config;
    const defaultKeys = this.defaults.envKeys ?? (apiKey ? [apiKey] : [DEFAULTS.envKey]);
    const csv = await this.prompt("Env key suggestions (comma-separated)", defaultKeys.join(", ")).asCsv();
    this.config.envKeys = csv.length > 0 ? csv : defaultKeys;
    return this;
  }

  async withAliases(): Promise<this> {
    const csv = await this.prompt("Aliases (comma-separated, optional)", this.defaults.aliases.join(", ")).asCsv();
    this.config.aliases = csv.length > 0 ? csv.map(providerUtil.normalizeProvider) : this.defaults.aliases;
    return this;
  }

  async withModels(): Promise<this> {
    const rawModels = await this.prompt(
      "Models JSON array (optional)",
      this.defaults.models ? JSON.stringify(this.defaults.models) : "",
    ).asJsonArray("models");
    if (rawModels?.some((item) => typeof item !== "object" || item === null || Array.isArray(item))) {
      throw new Error("models must be an array of objects");
    }
    this.config.models = (rawModels as ProviderConfig["models"]) ?? this.defaults.models;
    return this;
  }

  async withCompat(): Promise<this> {
    this.config.compat =
      (await this.prompt(
        "Compat JSON object (optional)",
        this.defaults.compat ? JSON.stringify(this.defaults.compat) : "",
      ).asJsonRecord("compat")) ?? this.defaults.compat;
    return this;
  }

  async withPiAuthProvider(): Promise<this> {
    const id = this.config.id ?? this.defaults.id;
    this.config.piAuthProvider = (await this.ui.confirm(
      "Configure Pi OAuth provider id?",
      "Only choose yes if this provider maps to a Pi /login auth entry.",
    ))
      ? ((await this.prompt("Pi auth provider id", this.defaults.piAuthProvider ?? id).asText()) ??
        this.defaults.piAuthProvider)
      : this.defaults.piAuthProvider;
    return this;
  }

  build(): ProviderConfig {
    const { id, label, envKeys, aliases, baseUrl, api, apiKey, models, compat, piAuthProvider } = this.config;

    if (!id) {
      throw new Error("Provider id is required");
    }

    const resolvedLabel = label ?? id;
    const resolvedApi = api || (baseUrl || apiKey || models ? DEFAULTS.api : undefined);
    return {
      id,
      label: resolvedLabel,
      name: resolvedLabel,
      envKeys: envKeys ?? [],
      aliases: aliases ?? [],
      ...(baseUrl && { baseUrl }),
      ...(resolvedApi && { api: resolvedApi }),
      ...(apiKey && { apiKey }),
      ...(models && { models }),
      ...(compat && { compat }),
      ...(piAuthProvider && { piAuthProvider }),
    };
  }

  async collect(): Promise<ProviderConfig> {
    await this.withId();
    await this.withLabel();
    await this.withBaseUrl();
    await this.withApi();
    await this.withApiKey();
    await this.withEnvKeys();
    await this.withAliases();
    await this.withModels();
    await this.withCompat();
    await this.withPiAuthProvider();
    return this.build();
  }
}
