import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ProviderStore, useProviderStore } from "@/storage";
import type { ProviderConfig, ProviderModelConfig } from "@/types";
import { commonUtil } from "@/utils";

export interface ProviderService {
  load(): Promise<void>;
  getProviders(): ProviderConfig[];
  addProvider(provider: ProviderConfig): Promise<void>;
  editProvider(original: ProviderConfig, updated: ProviderConfig): Promise<void>;
  removeProvider(provider: ProviderConfig): Promise<void>;
  registerProviders(providers: ProviderConfig[]): void;
  registerProvider(provider: ProviderConfig): void;
}

export function useProviderService(pi: ExtensionAPI, path: string): ProviderService {
  return new ProviderServiceImpl(pi, useProviderStore(path));
}

// ===============================================================================================
// Provider Service
// ===============================================================================================

class ProviderServiceImpl implements ProviderService {
  private providers: ProviderConfig[] = [];

  constructor(
    private readonly pi: ExtensionAPI,
    private readonly store: ProviderStore,
  ) {}

  async load(): Promise<void> {
    this.providers = await this.store.load();
    this.registerProviders(this.providers);
  }

  getProviders(): ProviderConfig[] {
    return this.providers;
  }

  async addProvider(provider: ProviderConfig): Promise<void> {
    if (this.providers.some((p) => p.id === provider.id)) {
      throw new Error(`Provider already exists: ${provider.id}`);
    }
    this.registerProvider(provider);
    this.providers.push(provider);
    await this.store.save(this.providers);
  }

  async editProvider(original: ProviderConfig, updated: ProviderConfig): Promise<void> {
    const index = this.providers.findIndex((p) => p.id === original.id);
    if (index === -1) throw new Error(`Provider not found: ${original.id}`);
    if (updated.id !== original.id && this.providers.some((p) => p.id === updated.id)) {
      throw new Error(`Provider already exists: ${updated.id}`);
    }
    this.providers[index] = updated;
    await this.store.save(this.providers);
    this.registerProvider(updated);
  }

  async removeProvider(provider: ProviderConfig): Promise<void> {
    const index = this.providers.findIndex((p) => p.id === provider.id);
    if (index === -1) throw new Error(`Provider not found: ${provider.id}`);
    this.providers.splice(index, 1);
    await this.store.save(this.providers);
  }

  registerProviders(providers: ProviderConfig[]): void {
    providers.forEach((provider) => this.registerProvider(provider));
  }

  registerProvider(provider: ProviderConfig): void {
    const config = this.toPiProvider(provider);
    if (!config) return;
    this.pi.registerProvider(provider.id, config as Parameters<ExtensionAPI["registerProvider"]>[1]);
  }

  private toPiProvider(provider: ProviderConfig): Record<string, unknown> | undefined {
    if (
      !provider.baseUrl &&
      !provider.api &&
      !provider.apiKey &&
      !provider.models &&
      !provider.headers &&
      !provider.authHeader &&
      !provider.compat
    ) {
      return undefined;
    }

    return commonUtil.omitUndefined({
      name: provider.name ?? provider.label,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
      api: provider.api,
      headers: provider.headers,
      authHeader: provider.authHeader,
      models: provider.models?.map((model) => this.toPiModel(provider, model)),
      modelOverrides: provider.modelOverrides,
      compat: provider.compat,
    });
  }

  private toPiModel(provider: ProviderConfig, model: ProviderModelConfig): Record<string, unknown> | undefined {
    return commonUtil.omitUndefined({
      ...model,
      api: model.api ?? provider.api,
      name: model.name ?? model.id,
      reasoning: model.reasoning ?? false,
      input: model.input ?? ["text"],
      contextWindow: model.contextWindow ?? 128000,
      maxTokens: model.maxTokens ?? 16384,
      cost: model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      compat: model.compat ?? provider.compat,
    });
  }
}
